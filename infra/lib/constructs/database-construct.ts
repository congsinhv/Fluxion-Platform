import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

export interface DatabaseProps {
  readonly vpc: ec2.IVpc;
}

export class DatabaseConstruct extends Construct {
  readonly instance: rds.DatabaseInstance;
  readonly secret: cdk.aws_secretsmanager.ISecret;
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, "RdsSg", {
      vpc: props.vpc,
      description: "Fluxion RDS - dev allow 5432 from anywhere, rotate post-MVP",
      allowAllOutbound: false,
    });
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Postgres 5432 dev only restrict in prod"
    );

    this.instance = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO
      ),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [this.securityGroup],
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      databaseName: "fluxion",
      credentials: rds.Credentials.fromGeneratedSecret("fluxion", {
        secretName: "fluxion/rds-credentials",
      }),
      publiclyAccessible: true,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(1),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      parameterGroup: new rds.ParameterGroup(this, "PgParams", {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_15,
        }),
        parameters: { "rds.force_ssl": "0" },
      }),
    });

    this.secret = this.instance.secret!;

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.instance.dbInstanceEndpointAddress,
      exportName: "FluxionDbEndpoint",
    });
    new cdk.CfnOutput(this, "DbSecretArn", {
      value: this.secret.secretArn,
      exportName: "FluxionDbSecretArn",
    });
  }
}
