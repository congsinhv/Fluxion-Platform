import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class SecretsConstruct extends Construct {
  readonly firebaseSecret: secretsmanager.Secret;
  readonly dpcSharedKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.firebaseSecret = new secretsmanager.Secret(this, "FirebaseServiceAccount", {
      secretName: "fluxion/firebase-service-account",
      description: "Firebase service account JSON for FCM dispatch (Phase 2.4)",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.dpcSharedKeySecret = new secretsmanager.Secret(this, "DpcSharedKey", {
      secretName: "fluxion/dpc-shared-api-key",
      description: "Shared HMAC key for DPC enroll endpoint",
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, "FirebaseSecretArn", {
      value: this.firebaseSecret.secretArn,
      exportName: "FluxionFirebaseSecretArn",
    });
    new cdk.CfnOutput(this, "DpcSharedKeySecretArn", {
      value: this.dpcSharedKeySecret.secretArn,
      exportName: "FluxionDpcSharedKeySecretArn",
    });
  }
}
