# Fluxion Platform — Deployment Guide

## Prerequisites

### AWS Account & Credentials
- AWS account with `ap-southeast-1` region access.
- IAM user with AdministratorAccess or equivalent (CDK requires broad permissions).
- AWS CLI configured: `aws configure --profile fluxion-dev` (or use `~/.aws/credentials`).

### Local Tools
- Node.js 18+ (npm workspaces).
- Python 3.12 (backend Lambdas).
- Kotlin 1.9 + Gradle 8+ (Android DPC).
- Docker (local PostgreSQL).
- Git + GitHub CLI (`gh` for PRs, optional).

### Firebase Setup
- Firebase project created (for FCM).
- Service account JSON downloaded (`google-services.json` for Android).
- Firebase admin SDK initialized (Backend uses `firebase-admin` Python package).

### Cognito Setup
- Amazon Cognito user pool created in `ap-southeast-1` (or CDK will create it).
- If manual: create identity pool linked to user pool for API access.

## Deployment Steps

### Step 1: Prepare Local Environment

```bash
cd /Users/synhvo/RSU/Fluxion-Platform

# Clone or navigate to repo
git clone https://github.com/.../Fluxion-Platform.git

# Install dependencies
npm install

# Start local PostgreSQL (Docker)
npm run db:up

# Run Alembic migrations (seeds state machine)
npm run db:migrate

# Verify local DB
psql postgresql+psycopg://fluxion:fluxion@localhost:5432/fluxion -c "SELECT count(*) FROM devices;"
# Should return: 0 (empty devices table, ready for data)
```

### Step 2: Deploy AWS Infrastructure (CDK)

```bash
cd /Users/synhvo/RSU/Fluxion-Platform

# Synthesize CDK stack (validate template)
npm run infra:synth

# Review changes
npm run infra:diff

# Deploy to AWS (requires fluxion-dev profile)
npm run infra:deploy --profile fluxion-dev

# Wait ~10–15 minutes for stack creation
# Stack outputs will be printed at the end (AppSync endpoint, Cognito pool, RDS endpoint, etc.)
```

**CDK Stack Components Created:**
- VPC with public/private subnets (or use default VPC).
- RDS PostgreSQL 15 instance (multi-AZ, encrypted).
- AppSync GraphQL API (with Cognito auth).
- 5 Lambda functions (resolver, enroll, processor, checkin, applier) with 15-min timeout.
- SQS queues: `fluxion-action-processor`, `fluxion-action-checkin` + shared DLQ.
- IAM roles + policies for Lambda-to-RDS, Lambda-to-SQS, Lambda-to-Firebase.
- Secrets Manager: `fluxion/firebase-service-account` (empty initially).
- CloudWatch log groups for all Lambdas.

### Step 3: Post-Deploy Configuration

#### A. Populate Firebase Service Account Secret

```bash
# Download Firebase service account JSON from Firebase Console
# Path: Firebase Project Settings → Service Accounts → Generate New Private Key

# Create/update Secrets Manager secret
aws secretsmanager put-secret-value \
  --secret-id "fluxion/firebase-service-account" \
  --secret-string file://path/to/google-services.json \
  --profile fluxion-dev
```

#### B. Migrate Deployed RDS Database

```bash
# Get RDS endpoint from CDK outputs
RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name FluxionStack \
  --query 'Stacks[0].Outputs[?OutputKey==`RDSEndpoint`].OutputValue' \
  --output text \
  --profile fluxion-dev)

# Export environment variable for Alembic
export DATABASE_URL="postgresql://fluxion:fluxion@${RDS_ENDPOINT}:5432/fluxion"

# Run migrations
alembic upgrade head

# Verify (should see states, actions, transitions in DB)
psql $DATABASE_URL -c "SELECT count(*) FROM states;"
```

#### C. Create Initial Admin User

> Note: operational scripts (E2E lifecycle test, admin-user provisioning, device cleanup) are kept local and are not part of the public repository.

Use the admin-user provisioning script to create a Cognito user. The user will be prompted to change password on first login.

### Step 4: Configure Frontend

```bash
cd apps/fluxion-platform-frontend

# Copy example env
cp .env.example .env

# Populate from CDK outputs
# Edit .env with values:
# VITE_COGNITO_REGION=ap-southeast-1
# VITE_COGNITO_USER_POOL_ID=<from CDK>
# VITE_COGNITO_CLIENT_ID=<from CDK>
# VITE_COGNITO_IDENTITY_POOL_ID=<from CDK>
# VITE_APPSYNC_ENDPOINT=<from CDK>
# VITE_APPSYNC_REGION=ap-southeast-1

# Run GraphQL code generation (required before building)
npm run codegen

# Verify build
npm run build

# Start dev server (for local testing)
npm run dev
```

**Frontend Environment Variables:**
```bash
VITE_COGNITO_REGION=ap-southeast-1
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_abc123def
VITE_COGNITO_CLIENT_ID=abc123def456ghi789
VITE_COGNITO_IDENTITY_POOL_ID=ap-southeast-1:abc123-def456
VITE_APPSYNC_ENDPOINT=https://abc123.appsync-api.ap-southeast-1.amazonaws.com/graphql
VITE_APPSYNC_REGION=ap-southeast-1
```

### Step 5: Configure Android Client

```bash
cd apps/fluxion-platform-client

# Copy example local properties
cp local.properties.example local.properties

# Populate:
# DPC_BASE_URL=https://<enroll/checkin Lambda URL from CDK>
# DPC_INTERNAL_API_KEY=<static key from CDK outputs or BuildConfig>

# Download google-services.json from Firebase Console
# Path: Project Settings → google-services.json (for Android)
# Place in: app/google-services.json (gitignored)

# Build APK
./gradlew :app:assembleDebug

# Install to emulator or connected device
./gradlew :app:installDebug

# Set as Device Owner + grant permissions
./scripts/adb-enroll.sh
```

**Android Build Configuration:**
```properties
# local.properties
sdk.dir=/path/to/Android/sdk
DPC_BASE_URL=https://abc123.execute-api.ap-southeast-1.amazonaws.com
DPC_INTERNAL_API_KEY=static_key_12345abcde
```

**Emulator Requirements:**
- Google APIs image (NOT Google Play, NOT AOSP).
- Example: `Android 14 (API 34)` with Google Play Services.
- Reason: FCM (Firebase) requires Play Services; Google Play app prevents Device Owner setup.

### Step 6: E2E Validation

Run an end-to-end lifecycle test against the deployed stack. This validates the full 10-milestone onboarding sequence:
- UPLOAD, REGISTER, ENROLL, ACTIVATE (auto-chained), LOCK milestones
- Concurrency lock enforcement
- Idempotent ACK handling

### Step 7: Manual Mobile Testing (Optional but Recommended)

1. **Enroll a test device:**
   - Open Android app on emulator.
   - Accept EULA.
   - App calls POST /v1/enroll (uses BuildConfig key for auth).
   - Device transitions: IDLE → REGISTERED → ENROLLED → ACTIVE.

2. **Check admin console:**
   - Open `http://<frontend-url>/devices`.
   - Device should appear in list with state = ACTIVE.
   - Milestone timeline shows 4 milestones (UPLOAD, REGISTER, ENROLL, ACTIVATE).

3. **Dispatch LOCK command:**
   - Click device row.
   - Click "LOCK" action.
   - Device receives FCM wake → executes LOCK → ACKs.
   - State flips to LOCKED (visible on next 10s poll).
   - Milestone timeline shows LOCK REQUESTED + APPLIED.

4. **Dispatch UNLOCK:**
   - Click "UNLOCK".
   - Device executes → ACKs.
   - State flips to ACTIVE.

5. **Dispatch RELEASE:**
   - Click "RELEASE".
   - Device relinquishes Device Owner ownership.
   - Device clears storage, returns to EULA screen.
   - State = RELEASED (terminal).

## Deployment Verification Checklist

| Check | Command / Validation | Expected |
|-------|---|---|
| AWS credentials | `aws sts get-caller-identity --profile fluxion-dev` | Returns ARN of user |
| CDK deployed | `aws cloudformation list-stacks --profile fluxion-dev \| grep FluxionStack` | FluxionStack in CREATE_COMPLETE or UPDATE_COMPLETE |
| RDS running | `psql $DATABASE_URL -c "SELECT now();"` | Timestamp returned |
| Alembic migrated | `psql $DATABASE_URL -c "SELECT count(*) FROM states;"` | count > 0 (seeded states) |
| Firebase secret | `aws secretsmanager get-secret-value --secret-id fluxion/firebase-service-account --profile fluxion-dev` | JSON service account returned |
| Frontend builds | `cd apps/fluxion-platform-frontend && npm run build` | dist/ folder created, no errors |
| Android builds | `cd apps/fluxion-platform-client && ./gradlew :app:assembleDebug` | app-debug.apk created |
| E2E test passes | End-to-end lifecycle test | All 10 milestones verified |

## Troubleshooting

### CDK Deployment Fails
**Symptoms:** `User is not authorized to perform sts:AssumeRole`

**Solution:**
```bash
# Verify IAM user has AdministratorAccess
aws iam get-user-policy --user-name <user> --policy-name AdministratorAccess --profile fluxion-dev

# If missing, attach policy via AWS Console or CLI
aws iam attach-user-policy \
  --user-name <user> \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess \
  --profile fluxion-dev
```

### Alembic Migration Fails
**Symptoms:** `FATAL: password authentication failed`

**Solution:**
```bash
# Verify RDS security group allows inbound PostgreSQL (5432) from your IP
aws ec2 describe-security-groups --group-ids <sg-id> --profile fluxion-dev

# Check RDS endpoint is reachable
psql -h <rds-endpoint> -U fluxion -d fluxion -c "SELECT 1;"
```

### Firebase Secret Not Found
**Symptoms:** Lambda logs show `SecretNotFound` or `InvalidSecretValue`

**Solution:**
```bash
# Verify secret exists
aws secretsmanager describe-secret --secret-id fluxion/firebase-service-account --profile fluxion-dev

# Re-create if missing
aws secretsmanager create-secret \
  --name fluxion/firebase-service-account \
  --secret-string file://google-services.json \
  --profile fluxion-dev
```

### Frontend Codegen Fails
**Symptoms:** `error: Cannot find module 'generated/graphql'`

**Solution:**
```bash
cd apps/fluxion-platform-frontend

# Ensure .env is populated
cat .env | grep VITE_

# Re-run codegen
npm run codegen

# If still failing, check schema fetch
npm run codegen -- --debug
```

### Android Emulator Device Owner Setup Fails
**Symptoms:** `Error: Failed to set device owner`

**Solution:**
```bash
# Verify emulator is Google APIs image
adb shell getprop ro.product.model | grep -i google

# If not Google APIs, recreate AVD with Google APIs
# Or use physical test device (must be Developer Mode enabled + ADB authorized)

# Clear any previous Device Admin
adb shell dpm remove-active-admin com.fluxion.client/.platform.dpc.FluxionDeviceAdminReceiver

# Re-run enroll script
./scripts/adb-enroll.sh
```

### E2E Lifecycle Test Polls Forever
**Symptoms:** Script hangs on "Waiting for ACTIVATE APPLIED"

**Solution:**
```bash
# Check applier Lambda logs
aws logs tail /aws/lambda/fluxion-platform-applier --follow --profile fluxion-dev

# Check SQS queue (may be stuck)
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-southeast-1.amazonaws.com/..../fluxion-action-checkin \
  --attribute-names All \
  --profile fluxion-dev

# If messages stuck, check DLQ
aws sqs receive-messages \
  --queue-url https://sqs.ap-southeast-1.amazonaws.com/..../fluxion-dlq \
  --max-number-of-messages 10 \
  --profile fluxion-dev
```

## Rollback / Cleanup

### Destroy Infrastructure
```bash
# WARNING: This deletes all resources (RDS, AppSync, Lambdas, etc.)
aws cloudformation delete-stack \
  --stack-name FluxionStack \
  --profile fluxion-dev

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name FluxionStack \
  --profile fluxion-dev
```

### Restore from RDS Snapshot
```bash
# List snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier fluxion \
  --profile fluxion-dev

# Restore from specific snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier fluxion-restored \
  --db-snapshot-identifier <snapshot-id> \
  --profile fluxion-dev
```

## Performance Tuning (Optional)

### Lambda Configuration
All Lambdas use **15-minute timeout** (maximum for SQS) to allow for queue visibility timeout + processing delays.

```bash
# Check current timeout
aws lambda get-function-configuration \
  --function-name fluxion-platform-applier \
  --profile fluxion-dev | jq '.Timeout'
```

### RDS Configuration
- **Instance type:** `db.t4g.micro` (free tier) or `db.t4g.small` (production).
- **Storage:** 20 GB SSD (auto-scaling enabled).
- **Backup:** 7-day retention.
- **Multi-AZ:** Enabled for production.

```bash
# Modify instance class
aws rds modify-db-instance \
  --db-instance-identifier fluxion \
  --db-instance-class db.t4g.small \
  --apply-immediately \
  --profile fluxion-dev
```

### SQS Configuration
- **Visibility timeout:** 30 seconds (set equal to Lambda timeout's max SQS-message lifetime).
- **Message retention:** 14 days (default).
- **Batch size:** 10 (default, can tune for throughput).

```bash
# Check current attributes
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-southeast-1.amazonaws.com/.../fluxion-action-processor \
  --attribute-names All \
  --profile fluxion-dev
```

## Monitoring & Logging

### CloudWatch Logs
```bash
# Tail resolver Lambda logs
aws logs tail /aws/lambda/fluxion-platform-resolver --follow --profile fluxion-dev

# Tail processor Lambda logs
aws logs tail /aws/lambda/fluxion-platform-processor --follow --profile fluxion-dev

# Tail applier Lambda logs (critical for state transitions)
aws logs tail /aws/lambda/fluxion-platform-applier --follow --profile fluxion-dev

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/fluxion-platform-applier \
  --filter-pattern "ERROR" \
  --profile fluxion-dev
```

### CloudWatch Metrics
```bash
# Get Lambda invocation count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=fluxion-platform-applier \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-07T23:59:59Z \
  --period 3600 \
  --statistics Sum \
  --profile fluxion-dev
```

## Security Best Practices

- **VPC:** Lambdas in private subnets; RDS in private subnets only.
- **Encryption:** RDS encrypted at rest; Secrets Manager for Firebase service account.
- **IAM:** Least privilege — Lambdas have role policies limited to required services (RDS, SQS, Secrets Manager).
- **API Gateway / AppSync:** Cognito auth required; no public unauthenticated endpoints.
- **Frontend:** Strict Content Security Policy (`script-src 'self'` only).
- **Secrets:** Never commit `.env`, `google-services.json`, or `local.properties`.

## Maintenance Schedule

| Task | Frequency | Owner |
|---|---|---|
| Check CloudWatch alarms | Daily | Ops |
| Rotate Firebase service account key | Quarterly | Security |
| RDS backup verification | Weekly | DBA |
| Update Lambda dependencies | Monthly | Ops |
| Security patch review | On release | Security |
