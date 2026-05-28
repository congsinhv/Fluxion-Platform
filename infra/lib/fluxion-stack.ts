import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { DatabaseConstruct } from "./constructs/database-construct";
import { AuthConstruct } from "./constructs/auth-construct";
import { MessagingConstruct } from "./constructs/messaging-construct";
import { SecretsConstruct } from "./constructs/secrets-construct";
import { LambdasConstruct } from "./constructs/lambdas-construct";
import { ApiConstruct } from "./constructs/api-construct";
import { FrontendConstruct } from "./constructs/frontend-construct";
import { AssetsConstruct } from "./constructs/assets-construct";
import { DomainConstruct } from "./constructs/domain-construct";
import { ADMIN_CONSOLE_DOMAIN, DOMAIN_NAME } from "./domain-config";

export interface FluxionStackProps extends cdk.StackProps {
  /** Wildcard cert from the us-east-1 cert stack (CloudFront + AppSync). */
  readonly usEast1Cert: acm.ICertificate;
}

export class FluxionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FluxionStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    const auth = new AuthConstruct(this, "Auth");
    const secrets = new SecretsConstruct(this, "Secrets");
    const messaging = new MessagingConstruct(this, "Messaging");
    const database = new DatabaseConstruct(this, "Database", { vpc });

    const lambdas = new LambdasConstruct(this, "Lambdas", {
      processorQueue: messaging.processorQueue,
      checkinQueue: messaging.checkinQueue,
      dbSecret: database.secret,
      firebaseSecret: secrets.firebaseSecret,
      dpcSharedKeySecret: secrets.dpcSharedKeySecret,
      dbEndpoint: database.instance.dbInstanceEndpointAddress,
    });

    const api = new ApiConstruct(this, "Api", {
      userPool: auth.userPool,
      resolverFn: lambdas.resolverFn,
      checkinFn: lambdas.checkinFn,
      enrollFn: lambdas.enrollFn,
    });

    const frontend = new FrontendConstruct(this, "Frontend", {
      domainNames: [DOMAIN_NAME, ADMIN_CONSOLE_DOMAIN],
      certificate: props.usEast1Cert,
    });

    // Public-read bucket hosting the DPC client's per-state header icons.
    new AssetsConstruct(this, "Assets");

    const domain = new DomainConstruct(this, "Domain", {
      usEast1Cert: props.usEast1Cert,
      graphqlApi: api.graphqlApi,
      httpApi: api.httpApi,
      distribution: frontend.distribution,
    });

    // enroll returns the checkin endpoint to the device in its response;
    // hand out the custom-domain URL so devices keep a stable endpoint.
    const checkinPublicUrl = `${domain.deviceApiCustomUrl}/v1/checkin`;
    lambdas.checkinFn.addEnvironment("CHECKIN_PUBLIC_URL", checkinPublicUrl);
    lambdas.enrollFn.addEnvironment("CHECKIN_PUBLIC_URL", checkinPublicUrl);

    // Real-time push: the transition writers broadcast change-events to AppSync
    // (SigV4/IAM) after commit, triggering @aws_subscribe. Resolver also publishes
    // for uploadImei (new device + upload). Grant IAM on the publish mutations and
    // hand each the GraphQL endpoint.
    api.graphqlApi.grantMutation(lambdas.resolverFn, "publishDeviceChange", "publishDeviceUploadChange");
    api.graphqlApi.grantMutation(lambdas.processorFn, "publishDeviceChange");
    api.graphqlApi.grantMutation(lambdas.applierFn, "publishDeviceChange");
    for (const fn of [lambdas.resolverFn, lambdas.processorFn, lambdas.applierFn]) {
      fn.addEnvironment("APPSYNC_ENDPOINT", api.graphqlApi.graphqlUrl);
    }

    new cdk.CfnOutput(this, "Region", { value: this.region });
  }
}
