import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";
import { Construct } from "constructs";

export interface LambdasProps {
  readonly processorQueue: sqs.IQueue;
  readonly checkinQueue: sqs.IQueue;
  readonly dbSecret: secretsmanager.ISecret;
  readonly firebaseSecret: secretsmanager.ISecret;
  readonly dpcSharedKeySecret: secretsmanager.ISecret;
  readonly dbEndpoint: string;
}

const BACKEND_REL = path.join("..", "..", "..", "apps", "fluxion-platform-backend");

function pythonBundling(): cdk.BundlingOptions {
  return {
    image: lambda.Runtime.PYTHON_3_12.bundlingImage,
    command: [
      "bash",
      "-c",
      [
        "pip install --no-cache-dir -r /asset-input/requirements.txt -t /asset-output",
        "cp -r /asset-input/. /asset-output/",
        "find /asset-output -name '__pycache__' -type d -exec rm -rf {} + || true",
        "find /asset-output -name '*.pyc' -delete || true",
      ].join(" && "),
    ],
  };
}

export class LambdasConstruct extends Construct {
  readonly resolverFn: lambda.Function;
  readonly processorFn: lambda.Function;
  readonly checkinFn: lambda.Function;
  readonly enrollFn: lambda.Function;
  readonly applierFn: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdasProps) {
    super(scope, id);

    const backendRoot = path.join(__dirname, BACKEND_REL);

    const sharedEnv: Record<string, string> = {
      DB_ENDPOINT: props.dbEndpoint,
      DB_SECRET_ARN: props.dbSecret.secretArn,
      FIREBASE_SECRET_ARN: props.firebaseSecret.secretArn,
      DPC_SHARED_KEY_SECRET_ARN: props.dpcSharedKeySecret.secretArn,
      PROCESSOR_QUEUE_URL: props.processorQueue.queueUrl,
      CHECKIN_QUEUE_URL: props.checkinQueue.queueUrl,
      AWS_REGION_OVERRIDE: cdk.Stack.of(this).region,
      LOG_LEVEL: "INFO",
    };

    // Explicit log group per function. Replaces the deprecated `logRetention`
    // prop (which provisioned a custom resource + helper Lambda). CDK-generated
    // names sidestep collisions with any pre-existing /aws/lambda/* groups.
    // DESTROY removal keeps a teardown clean — this is a non-prod demo stack.
    const logGroupFor = (name: string) =>
      new logs.LogGroup(this, `${name}LogGroup`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    const baseProps: Omit<lambda.FunctionProps, "code" | "handler"> = {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: sharedEnv,
    };

    this.resolverFn = new lambda.Function(this, "ResolverFn", {
      ...baseProps,
      logGroup: logGroupFor("Resolver"),
      functionName: "fluxion-resolver",
      code: lambda.Code.fromAsset(path.join(backendRoot, "fluxion-platform-resolver"), {
        bundling: pythonBundling(),
      }),
      handler: "handler.lambda_handler",
    });

    this.processorFn = new lambda.Function(this, "ProcessorFn", {
      ...baseProps,
      logGroup: logGroupFor("Processor"),
      functionName: "fluxion-processor",
      code: lambda.Code.fromAsset(path.join(backendRoot, "fluxion-platform-processor"), {
        bundling: pythonBundling(),
      }),
      handler: "handler.lambda_handler",
    });

    this.checkinFn = new lambda.Function(this, "CheckinFn", {
      ...baseProps,
      logGroup: logGroupFor("Checkin"),
      functionName: "fluxion-checkin",
      code: lambda.Code.fromAsset(path.join(backendRoot, "fluxion-platform-checkin"), {
        bundling: pythonBundling(),
      }),
      handler: "handler.lambda_handler",
    });

    // Enroll Lambda — HTTP-only (FastAPI+Mangum) device-lifecycle entry point.
    // Owns POST /v1/enroll; the ENROLL transition runs async via the pipeline.
    this.enrollFn = new lambda.Function(this, "EnrollFn", {
      ...baseProps,
      logGroup: logGroupFor("Enroll"),
      functionName: "fluxion-enroll",
      code: lambda.Code.fromAsset(path.join(backendRoot, "fluxion-platform-enroll"), {
        bundling: pythonBundling(),
      }),
      handler: "handler.lambda_handler",
    });

    // Applier Lambda — SQS-only. Sole consumer of the checkin queue; the single
    // transition writer (server-applied REGISTER/ENROLL + device acks). Split out
    // of the dual-mode checkin Lambda so the device-facing HTTP gateway and the
    // internal applier scale + deploy independently.
    this.applierFn = new lambda.Function(this, "ApplierFn", {
      ...baseProps,
      logGroup: logGroupFor("Applier"),
      functionName: "fluxion-applier",
      code: lambda.Code.fromAsset(path.join(backendRoot, "fluxion-platform-applier"), {
        bundling: pythonBundling(),
      }),
      handler: "handler.lambda_handler",
    });

    // Grants
    props.dbSecret.grantRead(this.resolverFn);
    props.dbSecret.grantRead(this.processorFn);
    props.dbSecret.grantRead(this.checkinFn);
    props.dbSecret.grantRead(this.enrollFn);
    props.dbSecret.grantRead(this.applierFn);
    props.firebaseSecret.grantRead(this.processorFn);
    props.dpcSharedKeySecret.grantRead(this.checkinFn);
    // resolver + checkin + enroll enqueue into processor queue;
    // applier enqueues the auto-chained ACTIVATE after ENROLL APPLIED
    props.processorQueue.grantSendMessages(this.resolverFn);
    props.processorQueue.grantSendMessages(this.checkinFn);
    props.processorQueue.grantSendMessages(this.enrollFn);
    props.processorQueue.grantSendMessages(this.applierFn);
    // processor enqueues into checkin queue for system-path APPLIED writes;
    // checkin (HTTP) enqueues device acks into the same queue for the applier
    props.checkinQueue.grantSendMessages(this.processorFn);
    props.checkinQueue.grantSendMessages(this.checkinFn);
    // Consume grants — the applier is the sole consumer of the checkin queue
    props.processorQueue.grantConsumeMessages(this.processorFn);
    props.checkinQueue.grantConsumeMessages(this.applierFn);

    // SQS event sources — one per Lambda, NO body filter needed
    this.processorFn.addEventSource(
      new eventSources.SqsEventSource(props.processorQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );
    this.applierFn.addEventSource(
      new eventSources.SqsEventSource(props.checkinQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    new cdk.CfnOutput(this, "ResolverFnArn", {
      value: this.resolverFn.functionArn,
      exportName: "FluxionResolverFnArn",
    });
    new cdk.CfnOutput(this, "ProcessorFnArn", {
      value: this.processorFn.functionArn,
      exportName: "FluxionProcessorFnArn",
    });
    new cdk.CfnOutput(this, "CheckinFnArn", {
      value: this.checkinFn.functionArn,
      exportName: "FluxionCheckinFnArn",
    });
    new cdk.CfnOutput(this, "EnrollFnArn", {
      value: this.enrollFn.functionArn,
      exportName: "FluxionEnrollFnArn",
    });
    new cdk.CfnOutput(this, "ApplierFnArn", {
      value: this.applierFn.functionArn,
      exportName: "FluxionApplierFnArn",
    });
  }
}
