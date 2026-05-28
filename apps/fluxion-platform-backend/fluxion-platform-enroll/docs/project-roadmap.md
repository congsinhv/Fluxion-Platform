# Fluxion Enroll — Project Roadmap

## Current Status

**Version:** 0.1 (initial implementation, per `app.py` FastAPI version)
**Scope:** Single business endpoint (POST /v1/enroll) + health checks.

## Implemented (v0.1)

- [x] POST /v1/enroll endpoint (device enrollment)
- [x] IMEI validation (15-digit format)
- [x] Device state guard (REGISTERED-only)
- [x] Per-device api_key generation (`mdm_live_` prefix, 32-char token)
- [x] SHA-256 api_key hashing (plaintext returned once, hash stored)
- [x] Device metadata persistence (fcm_token, device_info, timestamps)
- [x] ENROLL action enqueue to processor pipeline
- [x] Structured error responses (error_code, retry_strategy)
- [x] Health check endpoints (/v1/health, /healthz)

## Known Limitations

### 1. No Re-enrollment Support
**Status:** By design — won't fix under current DPC policy.
**Reason:** DPC policy hard-disables app uninstall + factory-reset after EULA accept; device never loses its local api_key.
**Impact:** Enrolled device calling POST /v1/enroll again receives 409 INVALID_STATE.
**Change trigger:** If DPC restrictions change, the safety assumption breaks — requires design review (see system-architecture.md → Re-enrollment Policy).

### 2. No Unit Tests
**Status:** Gap. No pytest suite exists for any backend Lambda.
**Mitigation:** an end-to-end lifecycle test exercises the device lifecycle end-to-end against a deployed stack, including enroll.

### 3. No API Key Rotation or Recovery
**Status:** Not implemented.
**Reason:** Plaintext api_key returned exactly once; server stores only the SHA-256 hash. No recovery path if a device loses its key — which the DPC restrictions are designed to prevent.

## Potential Future Work

Unscheduled — no committed dates or priorities. Candidates if the module evolves:

- **Unit test suite** — pytest with mocked `Database` + `config.sqs()`; small surface, cheap to cover all 4 error codes + happy path.
- **Structured logging / metrics** — current logging is plain-text; JSON logs + CloudWatch custom metrics would improve observability.
- **Re-enrollment endpoint** — only if DPC policy changes (see Limitation 1).
- **API key rotation** — would require dual-key validation window + device coordination via FCM; significant cross-Lambda design work.

## Maintenance

- **Dependencies** (`requirements.txt`): fastapi <0.120, mangum <0.20, pydantic <3, psycopg <4, boto3 <2 — bump within ranges as patches land.
- **Shared-file propagation:** changes to `config.py`/`constants.py`/`db.py`/`errors.py`/`sqs_client.py`/`auth.py` may need copying to sibling Lambda dirs (see codebase-summary.md → Shared Files).
- **No enroll-specific DB migrations** — module reads/writes tables owned by the shared schema (`scripts/db/migrations/`).

## Links & Related Work

- **Module README:** ../README.md
- **Code Standards:** code-standards.md
- **System Architecture:** system-architecture.md
- **Codebase Summary:** codebase-summary.md
- **E2E Test:** an end-to-end lifecycle test
- **Sibling Lambdas:** ../../fluxion-platform-{processor,applier,checkin,resolver}/
- **CDK Definition:** ../../../../infra/lib/constructs/lambdas-construct.ts
