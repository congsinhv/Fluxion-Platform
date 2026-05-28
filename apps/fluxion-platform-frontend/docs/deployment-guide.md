# Deployment Guide

## Quick Start

```bash
# 1. Install dependencies
npm install --workspace apps/fluxion-platform-frontend

# 2. Get env vars from CDK outputs
cd apps/fluxion-platform-frontend
cp .env.example .env
# Edit .env with values from ../../infra/cdk-outputs.json

# 3. Generate GraphQL types
npm run codegen

# 4. Build & verify
npm run typecheck
npm run lint
npm run test
npm run build

# 5. Static output in dist/ (no hosting infra yet — see Hosting Status)
```

---

## Environment Setup

### Prerequisites
- Node.js 18+ (verified with npm 9+).
- AWS CLI configured (for accessing cdk-outputs.json).
- CDK stack deployed (provides infrastructure endpoints).

### Environment Variables
All required; missing vars cause build failure:

| Var | Source | Example |
|-----|--------|---------|
| VITE_AWS_REGION | cdk-outputs.json | ap-southeast-1 |
| VITE_COGNITO_USER_POOL_ID | cdk-outputs.json | ap-southeast-1_xxxxx |
| VITE_COGNITO_USER_POOL_CLIENT_ID | Cognito console or cdk-outputs.json | xxxxx |
| VITE_APPSYNC_URL | cdk-outputs.json | https://xxxxx.appsync-api.ap-southeast-1.amazonaws.com/graphql |

**Fetching from CDK:**
```bash
# After running `cdk deploy` in the infra workspace
cat ../../infra/cdk-outputs.json | jq '.Outputs'

# Extract values:
# - CognitoUserPoolId
# - CognitoUserPoolClientId
# - AppSyncUrl
# - AwsRegion
```

**Example .env:**
```
VITE_AWS_REGION=ap-southeast-1
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_abcde12345
VITE_COGNITO_USER_POOL_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
VITE_APPSYNC_URL=https://abc123def456.appsync-api.ap-southeast-1.amazonaws.com/graphql
```

### Configuration Files
**Automatically Detected (no env vars needed):**
- `package.json` — workspace config, scripts.
- `vite.config.ts` — build, HMR, CSP plugin.
- `tailwind.config.ts` — design system tokens.
- `tsconfig.json` — TypeScript strict mode.
- `vitest.config.ts` — test environment (jsdom).

---

## Development Workflow

### Local Dev Server
```bash
npm run dev
# Starts Vite dev server on http://localhost:5173
# With:
#   - Hot Module Replacement (HMR)
#   - Relaxed CSP (allows inline scripts for HMR)
#   - React Fast Refresh (hot reload components)
```

**Troubleshooting Dev Server:**
- **Port conflict:** Vite tries ports 5173, 5174, ... until available.
- **CSP errors (HMR not working):** Ensure vite.config.ts relaxCspInDev plugin is active (applied on "serve" mode).
- **Cognito login fails:** Check VITE_COGNITO_USER_POOL_ID matches dev pool in AWS.

### Codegen Workflow
```bash
# One-time regenerate
npm run codegen

# Watch mode (auto-regenerate on .graphql changes)
npm run codegen:watch

# What it does:
# 1. Reads SDL from ../../infra/schema/appsync.graphql
# 2. Reads local operations from src/graphql/*.graphql
# 3. Outputs typed-document-nodes to src/graphql/generated/ (gitignored)
# 4. Never commit generated/ — codegen on install or pre-build
```

**If codegen fails:**
- SDL file missing? → Check ../../infra/schema/appsync.graphql exists.
- Schema changed? → Re-run codegen.
- TypeScript errors in generated code? → Check GraphQL operation syntax (SDL must match).

### Type Checking
```bash
npm run typecheck
# Runs tsc --noEmit (no output, just validation)
# Must pass before build
```

### Linting
```bash
npm run lint
# ESLint with --max-warnings 0 (zero-warning policy)
# Must pass before commit
```

### Testing
```bash
npm run test
# vitest run (jsdom environment)
# Coverage: unit tests for domain logic + critical component renders

npm run test -- --watch
# Watch mode (re-run on file changes)

npm run test -- --ui
# Browser-based test explorer
```

---

## Production Build

### Build Command
```bash
npm run build
# Steps:
# 1. tsc -b (TypeScript compilation)
# 2. vite build (output to dist/)
# 3. Output: dist/index.html + dist/assets/*.js + dist/assets/*.css
```

**Verification Before Build:**
```bash
# Must all pass:
npm run typecheck
npm run lint
npm run test
```

### Build Output
```
dist/
├── index.html                   # Entry point (strict CSP)
├── assets/
│   ├── index-xxxxx.js          # Main bundle (minified, tree-shaken)
│   ├── react-xxxxx.js          # React vendor chunk
│   ├── vendor-xxxxx.js         # Node modules vendor chunk
│   └── index.css               # Tailwind + component styles (minified)
└── [logo.svg, other assets]    # Public directory files
```

**Size Targets (Not Enforced, But Good to Know):**
- index JS bundle: < 200 KB (gzipped).
- CSS bundle: < 50 KB (gzipped).
- Total: < 300 KB (gzipped).

### CSP Strategy
**Production CSP (index.html):**
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.appsync-api.ap-southeast-1.amazonaws.com https://cognito-idp.ap-southeast-1.amazonaws.com; img-src 'self' data:; font-src 'self' data:;" />
```

- **script-src 'self':** Only scripts from same origin (no inline, no eval).
- **style-src 'self' 'unsafe-inline':** Inline styles allowed (Tailwind inlines critical CSS).
- **connect-src:** Allow AppSync + Cognito HTTP calls.
- **img-src 'self' data:**:** Inline images (SVG from data: URIs).
- **font-src 'self' data:**:** Inline fonts (web fonts embedded).

**Dev CSP (vite serve):**
Relaxed by relaxCspInDev plugin (allows unsafe-inline + unsafe-eval for HMR).

---

## Hosting Status

**No frontend hosting infrastructure is provisioned.** The CDK stack (`infra/`) creates Cognito, RDS, AppSync, API Gateway, Lambda, SQS, and Secrets Manager — there is no S3 bucket or CloudFront distribution for the console. In the MVP the console runs via `npm run dev` (or `npm run preview` against a production build) on the operator's machine, talking to the deployed AWS backend.

`npm run build` produces a fully static `dist/` (strict CSP already in `index.html`), so any static host can serve it later. Production hosting is post-MVP work; when added, it should live in the `infra/` workspace.

### Backend Stack Deploy (prerequisite for any frontend use)
```bash
cd infra
npm install
npx cdk bootstrap --profile fluxion-dev
npx cdk deploy   --profile fluxion-dev
```
Then copy stack outputs from `infra/cdk-outputs.json` into this app's `.env`.

---

## Cognito Configuration

### User Pool (Created by CDK)
The console signs in directly via `amazon-cognito-identity-js` (SRP auth against the user pool client) — no Cognito Hosted UI, so no callback/sign-out URLs or OAuth flows to configure. Pool ID and client ID come from `infra/cdk-outputs.json` into `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_USER_POOL_CLIENT_ID`.

### Admin User Setup

> Note: the admin-user provisioning script is kept local and is not part of the
> public repository. It creates a Cognito user in the pool, with the password
> set at creation time.

Manual equivalent with the AWS CLI:
```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> --username <email> --message-action SUPPRESS \
  --temporary-password '<temp>' --region ap-southeast-1 --profile fluxion-dev
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id> --username <email> \
  --password '<final>' --permanent --region ap-southeast-1 --profile fluxion-dev
```

Passwords are chosen at creation time and never committed to this repo.

---

## Monitoring & Logging

### Frontend Logs
- **Apollo GraphQL errors:** Logged to browser console (prefixed `[gql]`).
- **Auth errors:** Logged on Cognito operation failure.
- **Build warnings:** None (zero-warning policy enforced by lint).

### AWS CloudWatch
**Optional monitoring setup (not in MVP):**
- Cognito sign-in failures (CloudTrail events).
- AppSync query latency (CloudWatch metrics).

### Browser DevTools
- **Network tab:** View API calls to AppSync + Cognito.
- **Application tab:** Inspect localStorage (fluxion.jwt key).
- **Console:** Watch for [gql] errors and auth issues.

---

## Rollback Plan

Version control only (no hosted deployment to roll back in MVP):
```bash
git checkout main  # or last known-good commit
npm run codegen && npm run build
```

---

## Troubleshooting

### Issue: Build Fails on Missing Env Var
**Solution:**
```bash
cp .env.example .env
# Edit .env with values from cdk-outputs.json
# Re-run build
```

### Issue: "global is not defined" (Cognito SDK)
**Status:** Fixed in vite.config.ts (global = globalThis).
**Verification:** Should not occur in current codebase.

### Issue: CSP Blocks Script in Production
**Solution:**
- Check script-src in index.html matches actual script origins.
- Inline scripts must be removed (Vite handles this automatically in prod build).
- External scripts: add to connect-src CSP (if needed).

### Issue: Login Fails with "Invalid Client"
**Solution:**
- Verify VITE_COGNITO_USER_POOL_CLIENT_ID matches Cognito console.
- Verify callback URL in Cognito app client settings matches deployed domain.

### Issue: Polling Not Working (Always Stale Data)
**Solution:**
- Verify `fetchPolicy: "cache-and-network"` in query config.
- Do NOT use `nextFetchPolicy: "cache-first"` — kills polling.
- Check Apollo DevTools browser extension to confirm pollInterval is active.

### Issue: TypeScript Errors After Updating GraphQL Schema
**Solution:**
```bash
npm run codegen
npm run typecheck
```

---

## Performance Tips

### Build Size Optimization
- Tree-shaking: Vite automatically removes unused code (production build).
- Code splitting: Routes can be lazy-loaded (optional; not needed for small app).
- CSS purging: Tailwind removes unused styles.

### Runtime Performance
- Polling interval: 10s (conservative; increase if API quota allows).
- Cache-and-network: Returns instantly from cache, then refreshes in background.
- Pagination: Relay-style (stable across updates).

### Network Optimization
- Image optimization: SVG inline (small), defer PNGs if added.
- Compression/CDN concerns deferred until hosting infra exists (post-MVP).

---

## CI/CD Integration (Future)

No CI pipeline exists yet. A future check workflow would run (Node >= 20 per root `package.json` engines):
```bash
npm install --workspace apps/fluxion-platform-frontend
npm run codegen
npm run typecheck && npm run lint && npm run test
npm run build
```

---

## Checklist Before Production Deploy

- [ ] All env vars from cdk-outputs.json copied to .env.
- [ ] `npm run typecheck` passes (zero TypeScript errors).
- [ ] `npm run lint` passes (zero ESLint warnings).
- [ ] `npm run test` passes (all tests green).
- [ ] `npm run build` succeeds (dist/ created).
- [ ] Cognito user pool ID verified (matches VITE_COGNITO_USER_POOL_ID).
- [ ] AppSync endpoint reachable (VITE_APPSYNC_URL is live).
- [ ] CSP header in index.html is strict (script-src 'self').
- [ ] Hosting infra provisioned in `infra/` (post-MVP — does not exist yet).

---

## Last Updated

2026-06-07
