# Fluxion Enroll Lambda

HTTP-only device enrollment gateway for Fluxion, an AWS-native Android MDM platform. Issues per-device api_keys and enqueues the ENROLL action to the processor pipeline. One of 5 self-contained Python 3.12 Lambdas.

## Quick Start

### Local Setup

```bash
# From repo root
npm run db:up          # Start local PostgreSQL
npm run db:migrate     # Run migrations + seed states/actions/templates
```

### Lint & Format

```bash
# From repo root
npm run lint           # ruff check
npm run lint:fix       # ruff check --fix
npm run fmt            # ruff format
npm run fmt:check      # Check formatting without changing
```

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | No* | — | PostgreSQL connection string (takes precedence) |
| `DB_SECRET_ARN` | No* | — | Secrets Manager ARN for DB credentials (AWS prod) |
| `DB_ENDPOINT` | No* | — | RDS endpoint hostname (required with DB_SECRET_ARN) |
| `PROCESSOR_QUEUE_URL` | Yes | — | SQS processor queue for ENROLL enqueue |
| `CHECKIN_PUBLIC_URL` | No | `https://api.mdm.dev/v1/checkin` | Endpoint returned to device |
| `LOG_LEVEL` | No | `INFO` | Python logging level |
| `AWS_REGION` / `AWS_REGION_OVERRIDE` | No | `ap-southeast-1` | AWS region for boto3 clients |
| `FIREBASE_SECRET_ARN` | No | — | Reserved for future FCM integration |
| `DPC_SHARED_KEY_SECRET_ARN` | No | — | Reserved for future DPC key rotation |

*At least one of `DATABASE_URL` or both `DB_SECRET_ARN` + `DB_ENDPOINT` is required.

## API Endpoints

### POST /v1/enroll

Device enrollment: validate REGISTERED state, issue api_key, enqueue processor.

**Request:**
```json
{
  "imei": "123456789012345",
  "device_info": {
    "android_version": 14,
    "battery_level": 85
  },
  "fcm_token": "fcm_token_here"
}
```

**Response (201):**
```json
{
  "device_id": "device-uuid",
  "api_key": "mdm_live_<32-char-token>",
  "checkin_endpoint": "https://api.mdm.dev/v1/checkin",
  "checkin_interval": 3600,
  "server_time": "2026-06-07T10:30:00Z"
}
```

**Error Codes:**
- `400 INVALID_IMEI_FORMAT` — IMEI not 15 digits
- `400 MISSING_FIELD` — device_info not a dict
- `404 DEVICE_NOT_FOUND` — IMEI not registered
- `409 INVALID_STATE` — device not in REGISTERED state

**Status Codes:**
- `200 OK` — success
- `400 Bad Request` — validation error
- `404 Not Found` — device not found
- `409 Conflict` — invalid device state
- `500 Internal Server Error` — database or AWS failure

Error response format:
```json
{
  "error_code": "INVALID_STATE",
  "message": "Device must be REGISTERED to enroll",
  "retry_strategy": {
    "retryable": false,
    "backoff_seconds": null,
    "max_attempts": null
  }
}
```

### GET /v1/health

Health check.

```bash
curl https://api.mdm.dev/v1/health
```

```json
{
  "status": "ok",
  "service": "fluxion-enroll",
  "version": "0.1",
  "ts": "2026-06-07T10:30:00Z"
}
```

### GET /healthz

Alias for `/v1/health`.

## Key Behaviors

**Scope:** This handler validates the device is REGISTERED, issues the per-device api_key (storing only SHA-256 hash), and enqueues ENROLL to the processor. It does NOT write milestones, flip device state, set the single-flight lock, or chain ACTIVATE. The processor originates the request and routes to the checkin queue, whose sole consumer is the applier Lambda — the single transition writer.

**Re-enrollment:** Not supported. An already ENROLLED/ACTIVE device returns 409 INVALID_STATE. Safe because DPC policy hard-disables app uninstall and factory-reset on EULA accept, so devices never lose their local api_key.

**Pipeline:** After successful POST, ENROLL flows through the SQS pipeline: processor (REQUESTED milestone + single-flight lock) → applier (APPLIED milestone + REGISTERED→ENROLLED state flip) → applier auto-chains ACTIVATE back into the processor queue.

## Deploy

From monorepo root, via CDK:

```bash
npm run infra:deploy
```

CDK Docker-bundles this Lambda directory as a self-contained asset (see `infra/lib/constructs/lambdas-construct.ts`).

## Testing

No unit tests. E2E correctness validated by an end-to-end lifecycle test against a deployed stack.

## Documentation

- `docs/project-overview-pdr.md` — Module purpose and requirements
- `docs/codebase-summary.md` — Per-file breakdown
- `docs/code-standards.md` — Conventions and patterns
- `docs/system-architecture.md` — Architecture and request flows
- `docs/project-roadmap.md` — Future improvements

See also: `../README.md` (backend) and `../../README.md` (monorepo root).
