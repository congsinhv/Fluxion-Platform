import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

// Public-read S3 bucket for branded assets the DPC client fetches over the open
// internet — currently the per-state header icons rendered on the device status
// screens (HeroBox). Name is deterministic (account-scoped) so the
// header_icon_url values seeded into the DB stay stable across deploys.
//
// Icons in infra/assets/state-icons/ are uploaded on deploy via BucketDeployment;
// public object URL = {baseUrl}/state-icons/<state>.png.
export class AssetsConstruct extends Construct {
  readonly bucket: s3.Bucket;
  readonly baseUrl: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    this.bucket = new s3.Bucket(this, "PublicAssets", {
      bucketName: `fluxion-public-assets-${stack.account}`,
      // Branded icons are intentionally world-readable (no auth on the device
      // status screens), so the default block-all is relaxed for this bucket.
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, "DeployStateIcons", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "..", "assets", "state-icons"))],
      destinationBucket: this.bucket,
      destinationKeyPrefix: "state-icons",
    });

    this.baseUrl = `https://${this.bucket.bucketName}.s3.${stack.region}.amazonaws.com`;
    new cdk.CfnOutput(this, "AssetsBaseUrl", { value: this.baseUrl, exportName: "FluxionAssetsBaseUrl" });
  }
}
