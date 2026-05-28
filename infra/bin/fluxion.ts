#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FluxionStack } from "../lib/fluxion-stack";
import { FluxionCertStack } from "../lib/cert-stack";
import { loadDeployEnv } from "../lib/load-deploy-env";

loadDeployEnv();

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1";

// CloudFront/AppSync certs must live in us-east-1; cross-region references
// wire the cert ARN into the main stack.
const certStack = new FluxionCertStack(app, "FluxionCertStack", {
  env: { account, region: "us-east-1" },
  description: "Fluxion — us-east-1 wildcard certificate for CloudFront/AppSync",
  crossRegionReferences: true,
});

new FluxionStack(app, "FluxionStack", {
  env: { account, region },
  description: "Fluxion MDM platform — Phase 1 foundation",
  crossRegionReferences: true,
  usEast1Cert: certStack.wildcardCert,
});
