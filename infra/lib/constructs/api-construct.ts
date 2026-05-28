import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

export interface ApiProps {
  readonly userPool: cognito.IUserPool;
  readonly resolverFn: lambda.IFunction;
  readonly checkinFn: lambda.IFunction;
  readonly enrollFn: lambda.IFunction;
}

const QUERY_FIELDS = [
  "listDevices",
  "device",
  "listMilestones",
  "listMessageTemplates",
  "listTacs",
  "listDeviceUploads",
  "configMetadata",
];

const MUTATION_FIELDS = [
  "uploadImei",
  "dispatchAction",
  "createMessageTemplate",
  "updateMessageTemplate",
  "deleteMessageTemplate",
  "createTac",
  "updateTac",
  "deleteTac",
];

export class ApiConstruct extends Construct {
  readonly graphqlApi: appsync.GraphqlApi;
  readonly httpApi: apigwv2.HttpApi;
  readonly checkinPublicUrl: string;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const schemaPath = path.join(__dirname, "..", "..", "schema", "appsync.graphql");

    this.graphqlApi = new appsync.GraphqlApi(this, "AdminApi", {
      name: "fluxion-admin-api",
      definition: appsync.Definition.fromFile(schemaPath),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: props.userPool,
            defaultAction: appsync.UserPoolDefaultAction.ALLOW,
          },
        },
        // IAM lets the backend publisher Lambdas (resolver/processor/applier)
        // call the internal broadcast mutations that trigger @aws_subscribe.
        additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
      },
      xrayEnabled: false,
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      },
    });

    const lambdaDs = this.graphqlApi.addLambdaDataSource("ResolverDs", props.resolverFn);

    for (const field of QUERY_FIELDS) {
      lambdaDs.createResolver(`Q_${field}`, { typeName: "Query", fieldName: field });
    }
    for (const field of MUTATION_FIELDS) {
      lambdaDs.createResolver(`M_${field}`, { typeName: "Mutation", fieldName: field });
    }

    // Broadcast mutations: a NONE data source with a JS passthrough resolver
    // echoes the input back as the field result. No Lambda invoke per publish;
    // the echoed payload is what @aws_subscribe delivers to subscribers.
    // Subscription fields themselves need no resolver — AppSync wires them from
    // the @aws_subscribe directive in the SDL.
    const publishDs = this.graphqlApi.addNoneDataSource("PublishDs");
    const passthroughCode = appsync.Code.fromInline(
      [
        "export function request(ctx) { return { payload: ctx.args.input }; }",
        "export function response(ctx) { return ctx.result; }",
      ].join("\n")
    );
    for (const field of ["publishDeviceChange", "publishDeviceUploadChange"]) {
      publishDs.createResolver(`M_${field}`, {
        typeName: "Mutation",
        fieldName: field,
        runtime: appsync.FunctionRuntime.JS_1_0_0,
        code: passthroughCode,
      });
    }

    this.httpApi = new apigwv2.HttpApi(this, "DpcApi", {
      apiName: "fluxion-dpc-api",
      description: "DPC REST endpoints (enroll, checkin)",
    });

    const checkinIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "CheckinIntegration",
      props.checkinFn
    );
    const enrollIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      "EnrollIntegration",
      props.enrollFn
    );
    this.httpApi.addRoutes({
      path: "/v1/enroll",
      methods: [apigwv2.HttpMethod.POST],
      integration: enrollIntegration,
    });
    this.httpApi.addRoutes({
      path: "/v1/checkin",
      methods: [apigwv2.HttpMethod.POST],
      integration: checkinIntegration,
    });
    this.httpApi.addRoutes({
      path: "/v1/health",
      methods: [apigwv2.HttpMethod.GET],
      integration: checkinIntegration,
    });
    this.httpApi.addRoutes({
      path: "/healthz",
      methods: [apigwv2.HttpMethod.GET],
      integration: checkinIntegration,
    });

    this.checkinPublicUrl = `${this.httpApi.apiEndpoint}/v1/checkin`;

    new cdk.CfnOutput(this, "GraphqlUrl", {
      value: this.graphqlApi.graphqlUrl,
      exportName: "FluxionGraphqlUrl",
    });
    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: this.httpApi.apiEndpoint,
      exportName: "FluxionHttpApiUrl",
    });
    new cdk.CfnOutput(this, "CheckinPublicUrl", {
      value: this.checkinPublicUrl,
      exportName: "FluxionCheckinPublicUrl",
    });
  }
}
