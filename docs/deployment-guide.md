# Fluxion Platform — Deployment Guide

Complete runbook for deploying Fluxion to AWS and verifying the deployment.

---

## Prerequisites

### System Requirements
- **Node.js** ≥ 20 + npm
- **Python** 3.12
- **Docker** (for local PostgreSQL development)
- **AWS CLI** configured with credentials
- **AWS Account** with access to `ap-southeast-1` (Singapore)

### AWS Configuration

**Set up AWS profile:**
```bash
aws configure --profile fluxion-dev
# Enter: Access Key ID, Secret Access Key, default region (ap-southeast-1), format (json)
```

**Verify profile:**
```bash
aws sts get-caller-identity --profile fluxion-dev
```

---

## Local Development Setup

### 1. Install Dependencies

```bash
cd /Users/synhvo/RSU/Fluxion-Platform
npm install
```

This installs:
- Frontend workspace dependencies (`apps/fluxion-platform-frontend/`)
- Infra workspace dependencies (`infra/`)
- Root-level scripts dependencies (alembic, boto3, etc.)

### 2. Start Local PostgreSQL

```bash
npm run db:up
```

Starts a Docker container running PostgreSQL 15:
- Host: `localhost:5432`
- Database: `fluxion`
- User: `fluxion`
- Password: `fluxion`
- URL: `postgresql+psycopg://fluxion:fluxion@localhost:5432/fluxion`

**Verify:**
```bash
psql -h localhost -U fluxion -d fluxion -c "SELECT version();"
```

### 3. Run Database Migrations

```bash
npm run db:migrate
```

This runs Alembic migrations (`scripts/db/migrations/`) in order:
1. `0001_init_schema.py` — Creates 9 tables, pgcrypto, pg_trgm, set_updated_at trigger
2. `0002_seed_services.py` — Inserts INVENTORY and DEVICE_FINANCING services
3. `0003_seed_states.py` — Inserts 6 states (IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED)
4. `0004_seed_message_templates.py` — Inserts 3 default message templates
5. `0005_seed_actions.py` — Inserts 10 actions (UPLOAD, REGISTER, ENROLL, ACTIVATE, LOCK, UNLOCK, NOTIFY_*, RELEASE_*)
6. `0006_fix_actor.py` — Audit corrections

**Verify:**
```bash
psql -h localhost -U fluxion -d fluxion -c "SELECT COUNT(*) FROM devices;"
# Should return 0 (empty, ready for test data)
```

### 4. Frontend Local Development

```bash
cd apps/fluxion-platform-frontend
cp .env.example .env
npm run codegen     # Generate GraphQL types (required before dev server starts)
npm run dev         # Start Vite dev server at http://localhost:5173
```

**Note:** Frontend requires AppSync endpoint and Cognito pool ID in `.env` (comes from deployed stack outputs). For local-only dev without backend, codegen will fail.

### 5. Backend Local Testing

Backend Lambdas require deployment to AWS for testing (they depend on SQS, Secrets Manager, etc.). No local development server is provided.

---

## AWS Deployment

### 1. Bootstrap CDK (First Deploy Only)

CDK needs to set up an S3 bucket and IAM roles for asset staging. Run once per AWS account/region:

```bash
cd infra
npx cdk bootstrap --profile fluxion-dev
```

### 2. Deploy Infrastructure

```bash
cd infra
npm install                     # Ensure CDK dependencies are current
npx cdk deploy --profile fluxion-dev
```

**What gets deployed:**
- Cognito user pool (`fluxion-admin-pool`)
- AppSync GraphQL API (`fluxion-admin-api`)
- API Gateway HTTP API (routes `/v1/enroll`, `/v1/checkin`, `/v1/health`)
- 5 Lambda functions (resolver, processor, checkin, enroll, applier)
- RDS PostgreSQL 15 instance (`fluxion-db`)
- 2 SQS queues + shared DLQ
- Secrets Manager entries
- Security groups, IAM roles, CloudWatch log groups

**Output:** CDK prints stack outputs (endpoint URLs, pool IDs, etc.) to stdout. Save these.

### 3. Populate Secrets Manager

```bash
aws secretsmanager put-secret-value \
  --secret-id fluxion/firebase-service-account \
  --secret-string '{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}' \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

**Where to get the JSON:** Firebase project → Project Settings → Service Accounts → Generate new private key (JSON).

### 4. Create Cognito Admin User

> Note: operational scripts (E2E lifecycle test, admin-user provisioning, device cleanup) are kept local and are not part of the public repository.

This script:
1. Reads `infra/cdk-outputs.json` (written by CDK deploy)
2. Uses Cognito Admin API to create a user in `fluxion-admin-pool`
3. Sets initial password to a random string (user must change on first login)
4. Prints credentials

**Manual alternative (if script fails):**
```bash
aws cognito-idp admin-create-user \
  --user-pool-id ap-southeast-1_xxxxxxxxx \
  --username operator@example.com \
  --message-action SUPPRESS \
  --temporary-password TempPassword123! \
  --region ap-southeast-1 \
  --profile fluxion-dev

aws cognito-idp admin-set-user-password \
  --user-pool-id ap-southeast-1_xxxxxxxxx \
  --username operator@example.com \
  --password FinalPassword123! \
  --permanent \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

### 5. Update Frontend Environment

Copy CDK stack outputs to frontend `.env`:

```bash
# Extract from CDK deploy output or run:
aws cloudformation describe-stacks \
  --stack-name FluxionStack \
  --region ap-southeast-1 \
  --profile fluxion-dev \
  --query 'Stacks[0].Outputs'
```

Update `apps/fluxion-platform-frontend/.env` (variable names match `src/env.ts`):
```
VITE_AWS_REGION=ap-southeast-1
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_xxxxxxxxx
VITE_COGNITO_USER_POOL_CLIENT_ID=...
VITE_APPSYNC_URL=https://xxxxxxxxx.appsync-api.ap-southeast-1.amazonaws.com/graphql
```

Auth uses `amazon-cognito-identity-js` (direct SRP) — no hosted UI domain or
callback/redirect URI is required.

### 5b. Deploy Admin Console (S3 + CloudFront)

The admin console is hosted from the same `FluxionStack` (`FrontendConstruct`):
a private S3 bucket served through CloudFront with Origin Access Control, with
403/404 mapped back to `index.html` for SPA routing.

`cdk deploy` packages whatever is in `apps/fluxion-platform-frontend/dist/`,
so **build the frontend first**:

```bash
# 1. Ensure .env is populated (step 5) — values are baked into the bundle at build time
npm --workspace apps/fluxion-platform-frontend run codegen
npm --workspace apps/fluxion-platform-frontend run build

# 2. Deploy (uploads dist/ + invalidates CloudFront cache)
cd infra && npx cdk deploy --profile fluxion-dev
```

The console URL is in stack outputs as `FluxionAdminConsoleUrl`
(export `FluxionAdminConsoleUrl`), e.g. `https://<id>.cloudfront.net`.

> Rollback: redeploy with a previous build of `dist/`, or `cdk deploy` after
> `git checkout` of the desired frontend revision.

### 5c. Custom Domains (optional)

To serve the platform from your own domain, set the domain config via the
gitignored `infra/.deploy.env` (copy from `infra/.deploy.env.example`):

```
FLUXION_DOMAIN=your-domain.example
FLUXION_HOSTED_ZONE_ID=<route53-hosted-zone-id>
```

Register the domain, create a Route 53 hosted zone, delegate the registrar's
nameservers to that zone, then deploy. Subdomains created:

| Host | Target | Notes |
|---|---|---|
| apex + `app.` | CloudFront (admin console) | |
| `api.` | AppSync GraphQL (`/graphql`) | frontend `VITE_APPSYNC_URL` + CSP `connect-src` use this |
| `device.` | API Gateway HTTP (DPC) | `CHECKIN_PUBLIC_URL` + client `DPC_BASE_URL` use this |

RDS keeps its native endpoint (no public alias — its TLS cert only covers
`*.rds.amazonaws.com`).

Certificates (ACM, DNS-validated, auto-renewing):
- `FluxionCertStack` (**us-east-1** — required by CloudFront/AppSync) holds the
  wildcard cert, passed to `FluxionStack` via CDK cross-region references.
  us-east-1 must be CDK-bootstrapped once: `npx cdk bootstrap aws://ACCOUNT/us-east-1`.
- A second regional wildcard cert lives in `DomainConstruct` for API Gateway.

Deploy both stacks together: `npx cdk deploy --all --profile fluxion-dev`.
The default AWS URLs (`*.cloudfront.net`, `*.appsync-api`, `*.execute-api`)
remain valid alongside the custom domains.

### 6. Update Android Client Configuration

Copy deployment credentials to `apps/fluxion-platform-client/local.properties`:

```properties
sdk.dir=/path/to/android-sdk
DPC_BASE_URL=https://xxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/
DPC_INTERNAL_API_KEY=...
```

**Where to get `DPC_INTERNAL_API_KEY`:** Retrieve from Secrets Manager:
```bash
aws secretsmanager get-secret-value \
  --secret-id fluxion/dpc-shared-api-key \
  --region ap-southeast-1 \
  --profile fluxion-dev \
  --query 'SecretString' \
  --output text
```

---

## Post-Deployment Verification

### 1. Health Check Endpoint

```bash
curl -X GET \
  "https://xxxxxxxxx.execute-api.ap-southeast-1.amazonaws.com/v1/health" \
  -H "x-api-key: xxxxxxx"
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-06-07T12:00:00Z"
}
```

### 2. Cognito Authentication

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <COGNITO_CLIENT_ID> \
  --auth-parameters USERNAME=operator@example.com,PASSWORD=<PASSWORD> \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

Expected response includes `AuthenticationResult` with `IdToken`, `AccessToken`, `RefreshToken`.

### 3. AppSync GraphQL Query

```bash
COGNITO_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <COGNITO_CLIENT_ID> \
  --auth-parameters USERNAME=operator@example.com,PASSWORD=<PASSWORD> \
  --region ap-southeast-1 \
  --profile fluxion-dev \
  --query 'AuthenticationResult.IdToken' \
  --output text)

curl -X POST \
  "https://xxxxxxxxx.appsync-api.ap-southeast-1.amazonaws.com/graphql" \
  -H "Authorization: $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { listDevices(first: 10) { items { id currentState { name } } } }"}'
```

Expected response:
```json
{
  "data": {
    "listDevices": {
      "items": []
    }
  }
}
```

### 4. Full E2E Lifecycle Test

An end-to-end lifecycle test validates the canonical 10-milestone lifecycle:
1. UPLOAD device IMEI
2. REGISTER device (system action)
3. ENROLL device
4. ACTIVATE device (auto-chained)
5. LOCK device
6. UNLOCK device
7. NOTIFY device
8. RELEASE device
9. Verify concurrency lock (parallel dispatch rejected)
10. Verify idempotent ACKs (duplicate checkin ack ignored)

**If test fails:** Check CloudWatch logs for Lambda errors:
```bash
aws logs tail /aws/lambda/fluxion-resolver --follow --region ap-southeast-1 --profile fluxion-dev
aws logs tail /aws/lambda/fluxion-processor --follow --region ap-southeast-1 --profile fluxion-dev
aws logs tail /aws/lambda/fluxion-applier --follow --region ap-southeast-1 --profile fluxion-dev
```

---

## Admin Console Access

1. Navigate to `http://localhost:5173` (dev) or `https://yourdomain.com` (prod)
2. Click **Login**
3. Enter Cognito credentials (created in step 4 above)
4. You're authenticated; should see empty device list

**First-time actions:**
- Upload IMEI via CSV in the **Uploads** tab
- View devices in the **Devices** tab
- Dispatch actions (LOCK, UNLOCK, etc.) from the device detail page
- Monitor milestones in the **Activity** timeline

---

## Database Cleanup (Dev)

To reset local database:

```bash
npm run db:down
npm run db:up
npm run db:migrate
```

To clean up devices in deployed database, use the device-cleanup utility (dry-run by default).
This hard-deletes all devices in IDLE or RELEASED state (safe for demo cleanup).

---

## Android Emulator Setup

### Prerequisites
- Android Studio installed
- Android SDK ≥ 34

### Create Emulator with Google APIs

```bash
# List available system images
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --list

# Download Google APIs image (required for FCM)
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "system-images;android-34;google_apis;arm64-v8a"

# Create emulator
$ANDROID_HOME/tools/bin/avdmanager create avd \
  --name fluxion-dpc \
  --package "system-images;android-34;google_apis;arm64-v8a"
```

### Build and Install APK

```bash
cd apps/fluxion-platform-client
cp local.properties.example local.properties
# Edit local.properties with SDK path and DPC_BASE_URL

./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

### Provision as Device Owner

```bash
scripts/adb-enroll.sh
# Or manually:
adb shell dpm set-device-owner com.example.fluxion.dpc/.receiver.AdminReceiver
```

### Verify Enrollment

1. Open admin console (http://localhost:5173)
2. Upload IMEI from emulator (from `adb shell settings get secure android_id`)
3. Click **Enroll**
4. Emulator receives FCM wake push (check device notifications)
5. Emulator POSTs to `/v1/checkin`
6. See device state in admin console

---

## Troubleshooting

### Frontend Can't Connect to AppSync

**Symptom:** GraphQL queries fail with 403 Unauthorized

**Causes:**
- `.env` has wrong `VITE_GRAPHQL_ENDPOINT`
- Cognito token expired (localStorage JWT)
- Cognito pool misconfigured

**Fix:**
1. Verify `VITE_GRAPHQL_ENDPOINT` matches CDK output
2. Clear localStorage, re-login
3. Check Cognito pool exists: `aws cognito-idp describe-user-pool --user-pool-id <ID>`

### Lambda Timeouts

**Symptom:** SQS messages go to DLQ; Lambda logs show "Task timed out after 30.00 seconds"

**Causes:**
- Database connection pooling exhausted
- Network connectivity issue to RDS
- Lambda cold start on first invocation

**Fix:**
1. Check RDS security group allows Lambda access (usually automatic via CDK)
2. Increase Lambda timeout from 30s to 60s (in `infra/lib/fluxion-stack.ts`, redeploy)
3. Check database load: `aws rds describe-db-instances --db-instance-identifier fluxion-db --region ap-southeast-1`

### Device Can't Connect to `/v1/enroll`

**Symptom:** Android logcat shows "Connection refused" or "SSL error"

**Causes:**
- `DPC_BASE_URL` in `local.properties` is wrong
- API Gateway endpoint not deployed
- Security group blocks HTTPS

**Fix:**
1. Verify `DPC_BASE_URL` is the HTTP API Gateway endpoint from CDK output
2. Verify endpoint is live: `curl https://.../v1/health`
3. Check API Gateway is in CDK deploy output

### Milestone Count Wrong (Not 10)

**Symptom:** Lifecycle test shows 7 milestones instead of 10

**Causes:**
- Migration `0005_seed_actions.py` didn't run (missing NOTIFY or RELEASE action)
- Device re-enroll created duplicate state transitions

**Fix:**
1. Check migration history: `psql -h localhost -U fluxion -d fluxion -c "SELECT * FROM alembic_version;"`
2. If missing, rerun migrations: `npm run db:migrate`
3. Clear test devices: use the device-cleanup utility

---

## Monitoring & Logs

### CloudWatch Logs

```bash
# Tail resolver Lambda logs
aws logs tail /aws/lambda/fluxion-resolver \
  --follow \
  --format short \
  --region ap-southeast-1 \
  --profile fluxion-dev

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/fluxion-applier \
  --filter-pattern "ERROR" \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

### SQS DLQ Inspection

```bash
aws sqs receive-message \
  --queue-url https://sqs.ap-southeast-1.amazonaws.com/ACCOUNT_ID/fluxion-action-dispatch-dlq \
  --max-number-of-messages 10 \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

### Database Query

```bash
psql -h <RDS_ENDPOINT> -U fluxion -d fluxion -c \
  "SELECT device_id, current_state_id, assigned_action_id, created_at FROM devices ORDER BY created_at DESC LIMIT 5;"
```

---

## Disaster Recovery

### Revert to Previous Infrastructure

```bash
# List stack changesets
aws cloudformation list-change-sets \
  --stack-name FluxionStack \
  --region ap-southeast-1 \
  --profile fluxion-dev

# Create rollback changeset (if previous deploy exists)
aws cloudformation create-change-set \
  --stack-name FluxionStack \
  --change-set-name rollback-to-previous \
  --change-set-type CREATE \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

### Full Stack Deletion

**WARNING: Destructive operation. Deletes all resources.**

```bash
# Backup database first
npm run db:backup

# Delete stack
aws cloudformation delete-stack \
  --stack-name FluxionStack \
  --region ap-southeast-1 \
  --profile fluxion-dev

# Monitor deletion
aws cloudformation wait stack-delete-complete \
  --stack-name FluxionStack \
  --region ap-southeast-1 \
  --profile fluxion-dev
```

---

## Related Documentation

- **`docs/system-architecture.md`** — Component topology and flows
- **`docs/code-standards.md`** — Development standards and conventions
- **`docs/project-overview-pdr.md`** — Platform scope and requirements
- **Per-app docs** — See `apps/{app}/README.md` for app-specific details
