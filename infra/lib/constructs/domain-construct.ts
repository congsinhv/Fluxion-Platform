import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

import {
  ADMIN_CONSOLE_DOMAIN,
  DEVICE_API_DOMAIN,
  DOMAIN_NAME,
  GRAPHQL_DOMAIN,
  HOSTED_ZONE_ID,
} from "../domain-config";

export interface DomainProps {
  /** Wildcard cert in us-east-1 (CloudFront + AppSync requirement). */
  readonly usEast1Cert: acm.ICertificate;
  readonly graphqlApi: appsync.GraphqlApi;
  readonly httpApi: apigwv2.HttpApi;
  readonly distribution: cloudfront.Distribution;
}

/**
 * Binds the registered domain to the three public entry points:
 *   app.    -> CloudFront (admin console; apex also aliases here)
 *   api.    -> AppSync GraphQL
 *   device. -> API Gateway HTTP (DPC enroll/checkin)
 * RDS deliberately gets no public alias — its TLS cert only covers
 * *.rds.amazonaws.com and the endpoint is not user-facing.
 */
export class DomainConstruct extends Construct {
  /** GraphQL endpoint on the custom domain. */
  readonly graphqlCustomUrl: string;
  /** Device API base URL on the custom domain. */
  readonly deviceApiCustomUrl: string;

  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: DOMAIN_NAME,
    });

    // --- Admin console: apex + app. -> CloudFront ---
    const cdnTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(props.distribution),
    );
    new route53.ARecord(this, "ApexRecord", { zone, target: cdnTarget });
    new route53.ARecord(this, "AppRecord", {
      zone,
      recordName: ADMIN_CONSOLE_DOMAIN,
      target: cdnTarget,
    });

    // --- GraphQL: api. -> AppSync custom domain (L1 only; no L2 yet) ---
    const appsyncDomain = new appsync.CfnDomainName(this, "GraphqlDomain", {
      domainName: GRAPHQL_DOMAIN,
      certificateArn: props.usEast1Cert.certificateArn,
    });
    const appsyncAssoc = new appsync.CfnDomainNameApiAssociation(this, "GraphqlDomainAssoc", {
      apiId: props.graphqlApi.apiId,
      domainName: appsyncDomain.attrDomainName,
    });
    appsyncAssoc.addDependency(appsyncDomain);
    new route53.CnameRecord(this, "GraphqlRecord", {
      zone,
      recordName: GRAPHQL_DOMAIN,
      domainName: appsyncDomain.attrAppSyncDomainName,
    });
    this.graphqlCustomUrl = `https://${GRAPHQL_DOMAIN}/graphql`;

    // --- Device API: device. -> API Gateway HTTP custom domain ---
    // Regional endpoint, so the cert lives in the stack's own region.
    const regionalCert = new acm.Certificate(this, "RegionalCert", {
      domainName: `*.${DOMAIN_NAME}`,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    const deviceDomain = new apigwv2.DomainName(this, "DeviceDomain", {
      domainName: DEVICE_API_DOMAIN,
      certificate: regionalCert,
    });
    new apigwv2.ApiMapping(this, "DeviceMapping", {
      api: props.httpApi,
      domainName: deviceDomain,
    });
    new route53.ARecord(this, "DeviceRecord", {
      zone,
      recordName: DEVICE_API_DOMAIN,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayv2DomainProperties(
          deviceDomain.regionalDomainName,
          deviceDomain.regionalHostedZoneId,
        ),
      ),
    });
    this.deviceApiCustomUrl = `https://${DEVICE_API_DOMAIN}`;

    new cdk.CfnOutput(this, "GraphqlCustomUrl", {
      value: this.graphqlCustomUrl,
      exportName: "FluxionGraphqlCustomUrl",
    });
    new cdk.CfnOutput(this, "DeviceApiCustomUrl", {
      value: this.deviceApiCustomUrl,
      exportName: "FluxionDeviceApiCustomUrl",
    });
  }
}
