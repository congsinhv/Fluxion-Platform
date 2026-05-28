# Fluxion Checkin Lambda

HTTP-only device gateway for Fluxion, an AWS-native Android MDM platform. Handles device heartbeats (PULL) and command acknowledgments (ACK) via `POST /v1/checkin`. One of 5 self-contained Python 3.12 Lambdas.

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
| `CHECKIN_QUEUE_URL` | Yes | — | SQS checkin queue (applier consumer) |
| `PROCESSOR_QUEUE_URL` | No | — | SQS processor queue (not used by this Lambda; config only) |
| `CHECKIN_PUBLIC_URL` | No | `https://api.mdm.dev/v1/checkin` | Devices' perceived endpoint URL |
| `LOG_LEVEL` | No | `INFO` | Python logging level |
| `AWS_REGION` / `AWS_REGION_OVERRIDE` | No | `ap-southeast-1` | AWS region for boto3 clients |
| `FIREBASE_SECRET_ARN` | No | — | Reserved for future FCM integration |
| `DPC_SHARED_KEY_SECRET_ARN` | No | — | Reserved for future DPC key rotation |

*At least one of `DATABASE_URL` or both `DB_SECRET_ARN` + `DB_ENDPOINT` is required.

## Architecture

Device checkin flow:

```
Device → POST /v1/checkin (bearer api_key)
  ├─ PULL (no command_result): heartbeat + return pending command
  └─ ACK (command_result present): validate + enqueue to applier

Applier (separate Lambda) → consumes checkin queue → writes milestone transitions
```

Full architecture and request flows: see `docs/system-architecture.md`.

## API Endpoints

### POST /v1/checkin

Device heartbeat and command delivery.

**Request (PULL shape):**
```json
{
  "type": "CHECKIN",
  "device_info": {
    "android_version": 14,
    "battery_level": 85
  }
}
```

**Request (ACK shape):**
```json
{
  "type": "CHECKIN",
  "command_result": {
    "command_id": "cmd-12345",
    "status": "SUCCESS",
    "executed_at": "2026-06-07T10:30:00Z",
    "error": {}
  }
}
```

**Response (with pending command):**
```json
{
  "command": {
    "command_id": "cmd-12345",
    "action_type": "ACTIVATE",
    "payload": {
      "notification": {
        "display_mode": "DIALOG",
        "title": "Device Activation",
        "content": "Activate this device now?",
        "header_icon_url": "...",
        "notification_icon_url": "..."
      }
    }
  },
  "next_checkin_in": 60,
  "server_time": "2026-06-07T10:30:00Z"
}
```

**Response (no pending command):**
```json
{
  "command": null,
  "next_checkin_in": 3600,
  "server_time": "2026-06-07T10:30:00Z"
}
```

**Status Codes:**
- `200 OK` — success (always returned on valid request structure)
- `400 Bad Request` — malformed request or unknown command_id
- `401 Unauthorized` — missing Authorization header
- `403 Forbidden` — invalid api_key, IMEI mismatch, or device in RELEASED state
- `500 Internal Server Error` — database or AWS service failure

Error response format:
```json
{
  "error_code": "INVALID_CREDENTIALS",
  "message": "api_key not recognized",
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
  "service": "fluxion-checkin",
  "version": "0.2",
  "ts": "2026-06-07T10:30:00Z"
}
```

### GET /healthz

Alias for `/v1/health`.

## Authentication

Devices authenticate with a bearer api_key prefixed `mdm_live_`:

```bash
Authorization: Bearer mdm_live_<32-char-token>
X-Device-IMEI: 123456789012345  # optional cross-check
```

Only the SHA-256 hash is stored in `devices.api_key_hash`. IMEI mismatch (if header provided) returns `403 INVALID_DEVICE_BINDING`.

## Deploy

From repo root, via CDK:

```bash
cd infra
npx cdk deploy --profile fluxion-dev
```

CDK Docker-bundles this Lambda directory as a self-contained asset.

## Testing

No unit tests. E2E correctness validated by an end-to-end lifecycle test against a deployed stack. Asserts:
- 10-milestone device lifecycle (IDLE → REGISTERED → ENROLLED → ACTIVE → RELEASED)
- Concurrency lock rejection
- ACK idempotency

## Documentation

- `docs/project-overview-pdr.md` — Module purpose and requirements
- `docs/codebase-summary.md` — Per-file breakdown
- `docs/code-standards.md` — Conventions and patterns
- `docs/system-architecture.md` — Architecture and data flow
- `docs/project-roadmap.md` — Future improvements
