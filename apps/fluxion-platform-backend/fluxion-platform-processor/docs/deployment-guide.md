# Deployment Guide — Processor Lambda

CDK deployment, environment configuration, secrets wiring, and SQS queue topology.

## Prerequisites

- **AWS account:** fluxion-dev (profile configured in `~/.aws/config`)
- **Region:** ap-southeast-1 (Singapore)
- **CDK:** Installed globally or via `npm install -g aws-cdk`
- **Node.js:** 18+ (for CDK)
- **PostgreSQL:** 15+ (local dev) or RDS (prod)
- **Monorepo root:** Latest main branch

## Quick start

### Deploy from CDK

```bash
# From monorepo root
cd infra

# Review changes
npx cdk diff --profile fluxion-dev

# Deploy (interactive)
npx cdk deploy --profile fluxion-dev

# Wait for stack to complete (~10 min)
# CloudFormation outputs show:
# - ProcessorLambdaArn
# - ProcessorQueueUrl
# - CheckinQueueUrl
```

### Verify deployment

```bash
# Check Lambda is ready
aws lambda get-function \
  --function-name fluxion-processor-lambda \
  --profile fluxion-dev

# Check SQS queues exist
aws sqs list-queues --profile fluxion-dev

# Check secrets in Secrets Manager
aws secretsmanager list-secrets \
  --filters Key=name,Values=fluxion \
  --profile fluxion-dev
```

### Run lifecycle test

```bash
# From monorepo root
npm run test:processor

# Expected output:
# - Device REGISTER → REGISTERED
# - Device ENROLL → ENROLLED
# - Device ACTIVATE → ACTIVE
# - All milestones recorded in PostgreSQL
```

## Environment variables

Set via CDK Lambda function configuration (not hardcoded).

### Database

| Var | Required | Value | Source |
|-----|----------|-------|--------|
| `DATABASE_URL` | No | `postgresql://user:pass@localhost:5432/fluxion` | Local dev only |
| `DB_ENDPOINT` | Prod | `fluxion.xxxxxx.ap-southeast-1.rds.amazonaws.com` | RDS endpoint |
| `DB_SECRET_ARN` | Prod | `arn:aws:secretsmanager:ap-southeast-1:xxx:secret:fluxion/db` | Secrets Manager |

**Precedence:**
1. If `DATABASE_URL` is set → use it (local dev)
2. Else if `DB_SECRET_ARN` + `DB_ENDPOINT` → fetch from Secrets Manager (prod)
3. Else → error at runtime

### Firebase

| Var | Required | Value |
|-----|----------|-------|
| `FIREBASE_SECRET_ARN` | No | `arn:aws:secretsmanager:ap-southeast-1:xxx:secret:fluxion/firebase-service-account` |

**Behavior:**
- If unset → permanent mock mode (dispatch returns `{ok: true, mocked: true}`)
- If set but fetch fails (transient) → retry next call
- If set but empty/malformed → permanent mock mode, log warning

### SQS

| Var | Required | Value |
|-----|----------|-------|
| `PROCESSOR_QUEUE_URL` | Yes | `https://sqs.ap-southeast-1.amazonaws.com/xxx/fluxion-action-processor` |
| `CHECKIN_QUEUE_URL` | Yes | `https://sqs.ap-southeast-1.amazonaws.com/xxx/fluxion-action-checkin` |
| `CHECKIN_PUBLIC_URL` | No | `https://api.mdm.dev/v1/checkin` (default) |

### Logging

| Var | Required | Default |
|-----|----------|---------|
| `LOG_LEVEL` | No | INFO |
| `AWS_REGION` | No | ap-southeast-1 |
| `AWS_REGION_OVERRIDE` | No | unset (use `AWS_REGION` if set) |

## Secrets Management

### Database secret

**Name:** `fluxion/db`  
**Type:** RDS database credentials (auto-rotated by RDS)

**JSON structure:**
```json
{
  "username": "fluxion",
  "password": "xxxxx",
  "dbname": "fluxion",
  "engine": "postgres",
  "host": "fluxion.xxxxxx.ap-southeast-1.rds.amazonaws.com",
  "port": 5432
}
```

**Usage in code:**
```python
raw = config.secretsmanager().get_secret_value(SecretId=config.DB_SECRET_ARN)["SecretString"]
s = json.loads(raw)
url = f"postgresql://{s['username']}:{s['password']}@{config.DB_ENDPOINT}:5432/{s.get('dbname', 'fluxion')}"
```

### Firebase secret

**Name:** `fluxion/firebase-service-account`  
**Type:** Firebase Admin SDK service account JSON

**JSON structure:**
```json
{
  "type": "service_account",
  "project_id": "fluxion-xxx",
  "private_key_id": "xxx",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxx@fluxion-xxx.iam.gserviceaccount.com",
  "client_id": "xxx",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "xxx"
}
```

**Fetch and init:**
```python
raw = config.secretsmanager().get_secret_value(SecretId=config.FIREBASE_SECRET_ARN)["SecretString"]
cred_data = json.loads(raw)
cred = credentials.Certificate(cred_data)
firebase_admin.initialize_app(cred)
```

**Local development:** Leave `FIREBASE_SECRET_ARN` unset → permanent mock mode.

### Rotating secrets

**RDS auto-rotation:**
- AWS handles rotation automatically (typically every 30 days)
- No code changes needed; psycopg reconnects on broken connection

**Firebase credentials:**
- Manual rotation via GCP Console
- Update secret in Secrets Manager
- Next Lambda call will fetch updated credentials
- Previous credentials revoked

## SQS queue wiring

### Queue creation (CDK)

```typescript
// infra/lib/processor-stack.ts
const processorQueue = new sqs.Queue(this, "ProcessorQueue", {
  queueName: "fluxion-action-processor",
  visibilityTimeout: cdk.Duration.seconds(60),
  retentionPeriod: cdk.Duration.days(14),
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,
  },
});
```

### Event source mapping

```typescript
const processorLambda = new lambda.Function(this, "ProcessorLambda", {
  code: lambda.Code.fromAsset("../fluxion-platform-processor"),
  handler: "handler.lambda_handler",
  runtime: lambda.Runtime.PYTHON_3_12,
  environment: {
    PROCESSOR_QUEUE_URL: processorQueue.queueUrl,
    CHECKIN_QUEUE_URL: checkinQueue.queueUrl,
    // ... other env vars
  },
});

processorLambda.addEventSourceMapping("ProcessorQueueMapping", {
  eventSourceId: processorQueue.queueArn,
  batchSize: 10,
  maxBatchingWindowInSeconds: 5,
  reportBatchItemFailures: true,
});
```

### Queue permissions

CDK automatically grants:
- `sqs:ReceiveMessage` on processor queue (Lambda consumer)
- `sqs:SendMessage` on checkin queue (Lambda producer)
- `sqs:SendMessage` on DLQ (automatic on failure)

### Message format

**Processor queue message:**
```json
{
  "target_service": "processor",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "action_id": "660e8400-e29b-41d4-a716-446655440000",
  "command_id": "cmd_xxxxx",
  "template_id": "770e8400-e29b-41d4-a716-446655440000",
  "requested_by_id": "880e8400-e29b-41d4-a716-446655440000",
  "extras": {
    "metadata": {"reason": "admin requested"},
    "branch": "admin|device"
  }
}
```

**Checkin queue message (produced by processor):**
```json
{
  "target_service": "checkin",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "action_id": "660e8400-e29b-41d4-a716-446655440000",
  "command_id": "cmd_xxxxx",
  "template_id": "770e8400-e29b-41d4-a716-446655440000",
  "requested_by_id": "880e8400-e29b-41d4-a716-446655440000",
  "extras": {
    "branch": "system"
  }
}
```

## Database setup

### Create database (local)

```bash
# From monorepo root
npm run db:up

# Creates PostgreSQL:
# - Host: localhost
# - Port: 5432
# - User: fluxion
# - Password: fluxion
# - Database: fluxion
```

### Run migrations (Alembic)

```bash
# From monorepo root
npm run db:migrate

# Creates tables:
# - devices (id, imei, tac_id, service_id, current_state_id, assigned_action_id, fcm_token, ...)
# - actions (id, type, name, actor, default_template_id, target_state_id, ...)
# - message_templates (id, title, content, type, header_icon_url, ...)
# - milestones (id, device_id, action_id, event_type, payload, created_at, ...)
# - ...
```

### Seed data (optional)

```bash
# From monorepo root
npm run db:seed

# Inserts:
# - Actions: REGISTER, ENROLL, ACTIVATE, LOCK, UNLOCK, NOTIFY_FROM_ACTIVE, NOTIFY_FROM_LOCKED, RELEASE_FROM_ACTIVE, RELEASE_FROM_LOCKED
# - Message templates: sample notifications
# - Device states: UNREGISTERED, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED
```

### Prod RDS (AWS)

**RDS instance (created by CDK):**
```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier fluxion-db \
  --profile fluxion-dev
```

**Migrate on first deploy:**
```bash
# Temporarily connect from local (requires RDS public accessibility or VPN)
export DATABASE_URL="postgresql://fluxion:PASSWORD@fluxion.xxxxxx.ap-southeast-1.rds.amazonaws.com:5432/fluxion"
npm run db:migrate
```

**Or use Lambda layer:**
- Create Lambda layer with alembic + migrations
- Invoke layer before first processor Lambda invocation
- RDS private (no public access) — safer

## Local development

### Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Create PostgreSQL container (if using Docker)
docker run --name fluxion-postgres \
  -e POSTGRES_USER=fluxion \
  -e POSTGRES_PASSWORD=fluxion \
  -e POSTGRES_DB=fluxion \
  -p 5432:5432 \
  postgres:15

# Or via Homebrew (macOS)
brew install postgresql@15
brew services start postgresql@15
createuser fluxion
createdb -U fluxion fluxion
```

### Environment variables

```bash
# .env.local (not committed)
export DATABASE_URL="postgresql://fluxion:fluxion@localhost:5432/fluxion"
export LOG_LEVEL="DEBUG"
export PROCESSOR_QUEUE_URL="http://localhost:9324/000000000000/fluxion-action-processor"  # LocalStack
export CHECKIN_QUEUE_URL="http://localhost:9324/000000000000/fluxion-action-checkin"

# Unset to use mock mode
unset FIREBASE_SECRET_ARN
unset DB_SECRET_ARN DB_ENDPOINT
```

### Test locally

```bash
# Unit test (none for this module)
# Integration test (via LocalStack SQS)

# Quick manual test
python -c "
import handler
event = {
    'Records': [{
        'messageId': 'msg-123',
        'body': '{\"target_service\": \"processor\", \"device_id\": \"dev-1\", \"action_id\": \"act-1\", \"command_id\": \"cmd-1\"}',
    }]
}
result = handler.lambda_handler(event, None)
print(result)
"
```

## Troubleshooting

### Database connection failed

```
RuntimeError: DB_SECRET_ARN and DB_ENDPOINT required when DATABASE_URL is unset
```

**Fix:** Set one of:
- `DATABASE_URL` (local dev)
- `DB_SECRET_ARN` + `DB_ENDPOINT` (prod)

### Secrets Manager permission denied

```
botocore.exceptions.ClientError: An error occurred (AccessDenied) when calling the GetSecretValue operation
```

**Fix:** Lambda IAM role must have `secretsmanager:GetSecretValue` on the secret ARN:

```yaml
# CDK role policy
statement:
  - Effect: Allow
    Action: secretsmanager:GetSecretValue
    Resource:
      - arn:aws:secretsmanager:ap-southeast-1:xxx:secret:fluxion/*
```

### Firebase permanent mock mode

```
processor.fcm device=xxx action=ACTIVATE ok=true mocked=true msg=mock
```

**Expected if:** `FIREBASE_SECRET_ARN` is unset or secret is empty/malformed.

**To enable real FCM:**
1. Create/update `fluxion/firebase-service-account` secret in Secrets Manager
2. Set `FIREBASE_SECRET_ARN` env var in Lambda
3. Redeploy: `cdk deploy`

### Message stuck in queue

```
# Check SQS DLQ
aws sqs receive-message \
  --queue-url <DLQ_URL> \
  --profile fluxion-dev

# If message there, check CloudWatch Logs:
# /aws/lambda/fluxion-processor-lambda
```

### Concurrency limit reached

```
ResourceConflictException: The resource you requested already exists.
```

**Fix:** Increase Lambda reserved concurrency in CDK:

```typescript
processorLambda.reservedConcurrentExecutions = 200;
```

## Monitoring & logs

### CloudWatch Logs

```bash
# View processor Lambda logs
aws logs tail /aws/lambda/fluxion-processor-lambda \
  --follow \
  --profile fluxion-dev

# Filter by error
aws logs filter-log-events \
  --log-group-name /aws/lambda/fluxion-processor-lambda \
  --filter-pattern "processor.failure" \
  --profile fluxion-dev
```

### CloudWatch Metrics

```bash
# Lambda invocation count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=fluxion-processor-lambda \
  --start-time 2026-06-07T00:00:00Z \
  --end-time 2026-06-07T23:59:59Z \
  --period 3600 \
  --statistics Sum \
  --profile fluxion-dev
```

### Alarms

**CDK creates alarms for:**
- Lambda errors (> 1% of invocations)
- SQS DLQ messages (> 0)
- RDS CPU (> 80%)

## Rollback

### If deployment fails

```bash
# View stack history
aws cloudformation describe-stack-events \
  --stack-name fluxion-stack \
  --profile fluxion-dev

# Rollback to previous version
aws cloudformation cancel-update-stack \
  --stack-name fluxion-stack \
  --profile fluxion-dev
```

### If code introduces bugs

```bash
# Revert git
git revert <commit>

# Redeploy
cd infra && npx cdk deploy --profile fluxion-dev
```

## Post-deployment checklist

- [ ] `cdk deploy` completed without errors
- [ ] SQS queues created: `fluxion-action-processor`, `fluxion-action-checkin`, DLQ
- [ ] Secrets Manager has `fluxion/db` and `fluxion/firebase-service-account`
- [ ] Database migrated: `npm run db:migrate`
- [ ] Database seeded: `npm run db:seed`
- [ ] Lifecycle test passed: `npm run test:processor`
- [ ] CloudWatch alarms are healthy
- [ ] No messages in DLQ
- [ ] Processor Lambda cold start <10s

