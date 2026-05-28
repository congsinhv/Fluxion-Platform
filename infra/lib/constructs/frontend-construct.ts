import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

// Built by `npm --workspace apps/fluxion-platform-frontend run build` before `cdk deploy`.
const FRONTEND_DIST_REL = path.join(
  "..",
  "..",
  "..",
  "apps",
  "fluxion-platform-frontend",
  "dist",
);

export interface FrontendProps {
  /** Custom domains served by the distribution (cert must cover them, us-east-1). */
  readonly domainNames?: string[];
  readonly certificate?: acm.ICertificate;
}

/**
 * Static hosting for the admin console: private S3 bucket served through
 * CloudFront with Origin Access Control. SPA routing is handled by mapping
 * 403/404 responses back to index.html (client-side react-router takes over).
 */
export class FrontendConstruct extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendProps = {}) {
    super(scope, id);

    const bucket = new s3.Bucket(this, "AdminConsoleBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, "AdminConsoleCdn", {
      comment: "Fluxion admin console",
      domainNames: props.domainNames,
      certificate: props.certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      // S3 origin returns 403 for unknown keys; both must fall back to the SPA shell.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    new s3deploy.BucketDeployment(this, "AdminConsoleDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, FRONTEND_DIST_REL))],
      destinationBucket: bucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });

    new cdk.CfnOutput(this, "AdminConsoleUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: "FluxionAdminConsoleUrl",
    });
  }
}
