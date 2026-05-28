# Fluxion Enroll — Codebase Summary

**Total LOC:** ~785 across 10 Python modules.

## Module Breakdown

| File | LOC | Purpose |
|------|-----|---------|
| `handler.py` | 24 | Lambda entry; wraps FastAPI app with Mangum for AWS API Gateway |
| `app.py` | 37 | FastAPI app (title=Fluxion Enroll, v0.1); exception handler for AppError; routes to /v1/health, /healthz, POST /v1/enroll |
| `routes/enroll.py` | 88 | Core handler: validate IMEI + device_info, lock device by IMEI, check REGISTERED state, issue api_key, update device, enqueue ENROLL |
| `config.py` | 58 | Env vars (DB_*, PROCESSOR_QUEUE_URL, etc.), lazy AWS clients (secretsmanager, sqs), root logger setup |
| `db.py` | 345 | Database wrapper (psycopg, dict_row, autocommit=True, thread-lock guarded reconnect). Methods: state/action/template lookups, device lock/update, milestone finders (unused by enroll) |
| `auth.py` | 70 | Api_key helpers: generate_device_api_key (mdm_live_ prefix, 32-char token, SHA-256 hash), validate_device_bearer (used by checkin), get_dpc_shared_key |
| `errors.py` | 54 | Typed AppError hierarchy (NotFound 404, Conflict 409, BadRequest 400, Forbidden 403, Unauthorized 401, InternalError 500); to_dict includes retry_strategy |
| `constants.py` | 51 | Action classification (SYSTEM_ACTIONS, DEVICE_BOUND_ACTIONS, AUTO_CHAIN_AFTER_APPLIED), SQS routing labels (TARGET_PROCESSOR, TARGET_CHECKIN), IMEI_LENGTH=15, API_KEY_PREFIX=mdm_live_ |
| `sqs_client.py` | 53 | enqueue_action(target, device_id, action_id, **kwargs) helper; picks queue URL, logs MessageId |
| `requirements.txt` | 6 | Dependencies: fastapi, mangum, pydantic, psycopg, boto3 |

## Dependency Flow

```
handler.py
  ├─ imports config (side effect: root logger)
  ├─ imports app.py
       ├─ imports FastAPI
       ├─ imports AppError from errors.py
       └─ imports routes/enroll.py handler
            ├─ imports config
            ├─ imports generate_device_api_key from auth.py
            ├─ imports constants (CHECKIN_INTERVAL_IDLE, IMEI_LENGTH, TARGET_PROCESSOR)
            ├─ imports Database from db.py
            │    ├─ imports config (for secretsmanager, logger)
            │    ├─ imports psycopg
            │    └─ GLOBAL _conn, _lock (thread-safe reconnect)
            ├─ imports errors (BadRequest, NotFound, Conflict)
            └─ imports enqueue_action from sqs_client.py
                 ├─ imports config (sqs client)
                 └─ imports constants (TARGET_PROCESSOR, TARGET_CHECKIN)

config.py (imported first by handler)
  ├─ sets root logger at module load
  ├─ reads env vars (DB_*, PROCESSOR_QUEUE_URL, LOG_LEVEL, AWS_REGION)
  └─ lazy AWS clients (secretsmanager, sqs)

auth.py
  ├─ imports config
  ├─ imports constants (API_KEY_PREFIX, API_KEY_TOKEN_LEN)
  ├─ imports Database
  └─ imports errors (Unauthorized, Forbidden)
```

## Key Data Structures

**Device Record (from db.lock_device_by_imei):**
```python
{
  'id': UUID,
  'imei': str,
  'tac_id': UUID,
  'service_id': UUID,
  'current_state_id': UUID,
  'assigned_action_id': UUID | None,
  'api_key_hash': str | None,
  'fcm_token': str | None,
  'info': dict | None,
  'first_checkin_at': datetime | None,
  'last_checkin_at': datetime | None,
}
```

**Enroll Request Body:**
```python
{
  'imei': str,                           # required, 15 digits
  'device_info': dict,                   # required, not None
  'fcm_token': str | None,               # optional
}
```

**Enroll Response:**
```python
{
  'device_id': str (UUID stringified),
  'api_key': str,                        # mdm_live_<32-char>, plaintext (only time)
  'checkin_endpoint': str,               # from config.CHECKIN_PUBLIC_URL
  'checkin_interval': int,               # 3600 (CHECKIN_INTERVAL_IDLE)
  'server_time': str,                    # ISO 8601 with Z suffix
}
```

**SQS Message Body (to processor):**
```python
{
  'target_service': 'processor',
  'device_id': str (UUID stringified),
  'action_id': str (UUID of ENROLL action),
  'command_id': None,
  'template_id': None,
  'requested_by_id': None,
  'extras': {'branch': 'enroll'},
}
```

## Shared Files (Copy-Pasted Across 5 Lambdas)

The following files are intentionally copied across `fluxion-platform-{resolver,processor,checkin,enroll,applier}` directories to avoid a shared package dependency:

- `config.py` — env vars, AWS clients, logger
- `constants.py` — action/state classifications, SQS routing, key formats
- `db.py` — database wrapper
- `errors.py` — AppError hierarchy
- `sqs_client.py` — enqueue_action helper
- `auth.py` — api_key generation/validation (resolver, checkin, enroll)

**Change Propagation:** Updates to these files should be copied to sibling Lambda directories. See `../README.md` (backend) for rationale (CDK Docker bundling treats each Lambda as independent asset).

## Conventions

**Code Style:**
- Python 3.12, Ruff with line-length=100, double quotes, rules E/F/I/UP/B
- `from __future__ import annotations` in every file
- Module docstring explaining purpose on first line
- snake_case inside Python packages; kebab-case for dirs/top-level files
- Named SQL binding via `%(name)s`, never f-string interpolation
- Column whitelists for dynamic UPDATEs (db.update_device_fields)

**Error Handling:**
- Typed AppError subclasses with UPPER_SNAKE error codes
- to_dict() includes retry_strategy (retryable if http_status >= 500)
- Exception handler in app.py returns JSON response

**Imports:**
- config imported first in handler.py for side effect (root logger)
- Lazy AWS clients via config.secretsmanager(), config.sqs()
- Thread-lock guarded reconnect in db._get_conn()

## Testing

- No unit tests (e2e via an end-to-end lifecycle test at repo root)
- Enroll tested as part of device lifecycle (REGISTERED → ENROLLED → ACTIVE)
- Concurrency lock rejection tested in lifecycle script

## Performance Characteristics

**Per-request work:**
- 1 database lookup (lock_device_by_imei, FOR UPDATE)
- 1 transaction commit (update_device_fields)
- 1 SQS SendMessage (enqueue_action)
- 1 SHA-256 hash (generate api_key)

**Bottleneck:** Database lock contention on high-concurrency enrollments. Single FOR UPDATE serializes concurrent enrollments for same device (safe; prevents race on api_key_hash/state check).

## TODOs & Known Issues

None documented. Module is v0.1, minimal scope (single endpoint), no known bugs or tech debt.
