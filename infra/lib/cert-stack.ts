import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

import { DOMAIN_NAME, HOSTED_ZONE_ID } from "./domain-config";

/**
 * CloudFront and AppSync custom domains both require their ACM certificate
 * to live in us-east-1, regardless of where the rest of the stack runs.
 * This stack holds that single wildcard cert; FluxionStack consumes it via
 * CDK cross-region references.
 */
export class FluxionCertStack extends cdk.Stack {
  readonly wildcardCert: acm.ICertificate;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: DOMAIN_NAME,
    });

    this.wildcardCert = new acm.Certificate(this, "WildcardCert", {
      domainName: DOMAIN_NAME,
      subjectAlternativeNames: [`*.${DOMAIN_NAME}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new cdk.CfnOutput(this, "WildcardCertArn", {
      value: this.wildcardCert.certificateArn,
      exportName: "FluxionWildcardCertArn",
    });
  }
}
