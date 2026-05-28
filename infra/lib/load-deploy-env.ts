import * as fs from "fs";
import * as path from "path";

// Loads the gitignored infra/.deploy.env (simple KEY=VALUE lines) into
// process.env so deploy-time config (account, domain, hosted zone) stays
// local and out of the public repo. Existing env vars win; missing file is
// fine (placeholders in domain-config keep `cdk synth` working for clones).
export function loadDeployEnv(): void {
  const file = path.join(__dirname, "..", ".deploy.env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
