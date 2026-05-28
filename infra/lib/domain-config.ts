// Custom domain configuration. Real values come from the gitignored
// infra/.deploy.env (loaded by load-deploy-env.ts) so they stay out of the
// public repo; the placeholder fallback lets `cdk synth` run on a fresh clone.
import { loadDeployEnv } from "./load-deploy-env";

// These consts are read at module-load time, which (via the stacks' imports)
// happens before bin/fluxion.ts can call loadDeployEnv itself. Load the env
// here so the real domain is in place no matter who imports this module first.
loadDeployEnv();

export const DOMAIN_NAME = process.env.FLUXION_DOMAIN ?? "example.invalid";
export const HOSTED_ZONE_ID = process.env.FLUXION_HOSTED_ZONE_ID ?? "";

export const ADMIN_CONSOLE_DOMAIN = `app.${DOMAIN_NAME}`;
export const GRAPHQL_DOMAIN = `api.${DOMAIN_NAME}`;
export const DEVICE_API_DOMAIN = `device.${DOMAIN_NAME}`;
