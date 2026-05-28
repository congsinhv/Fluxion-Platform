# Codebase Summary

**Module Size:** 859 LOC across 10 Python files + requirements.txt  
**Language:** Python 3.12  
**Framework:** FastAPI + Mangum  
**Dependencies:** psycopg, boto3, pydantic v2

## File Inventory

| File | LOC | Purpose |
|------|-----|---------|
| `handler.py` | 28 | Lambda entry; HTTP-only via Mangum |
| `app.py` | 41 | FastAPI app + exception handler |
| `routes/checkin_route.py` | 154 | PULL/ACK branching logic |
| `auth.py` | 70 | Bearer token auth + api_key hashing |
| `db.py` | 345 | Thin psycopg wrapper (states, actions, devices, milestones) |
| `config.py` | 58 | Env vars, logger setup, lazy boto3 clients |
| `constants.py` | 51 | Action/state classifications, SQS labels, tuning |
| `errors.py` | 54 | Typed AppError subclasses |
| `sqs_client.py` | 53 | SQS enqueue helper |
| `routes/__init__.py` | 2 | Package marker |

## Request Flow

### PULL (Heartbeat) — No command_result
```
POST /v1/checkin { type: CHECKIN, device_info?: {...} }
↓
validate_device_bearer(auth_header, imei_header)
  → SHA-256 hash lookup in devices.api_key_hash
  → Optional IMEI cross-check
↓
device.current_state_id == RELEASED? → 403 DEVICE_RELEASED
↓
Update device: last_checkin_at, optional info
↓
Fetch pending command from latest REQUESTED milestone
  → Query: device.assigned_action_id
  → Skip SYSTEM_ACTIONS (REGISTER, ENROLL)
  → Resolve notification template (from milestone or action default)
↓
return {command, next_checkin_in: 60 or 3600, server_time}
```

### ACK (Command Acknowledgment) — With command_result
```
POST /v1/checkin { type: CHECKIN, command_result: {...} }
↓
validate_device_bearer(auth_header, imei_header)
↓
device.current_state_id == RELEASED? → 403 DEVICE_RELEASED
↓
Update device: last_checkin_at, optional info
↓
Validate ack: status ∈ {SUCCESS, FAILED}, command_id present
↓
Find REQUESTED milestone by command_id
  → Not found? → 400 UNKNOWN_COMMAND_ID
↓
REQUESTED-scoped idempotency check:
  → Query for APPLIED/FAILED milestone *after* REQUESTED.created_at
  → If exists: log idempotent, return heartbeat (no enqueue)
↓
Commit transaction
↓
(After commit) Enqueue ack to checkin queue
  → target_service=checkin, device_id, action_id, command_id, result
  → Applier consumes: writes APPLIED/FAILED, flips state, clears lock
↓
return {command: null, next_checkin_in: 3600, server_time}
```

## Key Data Structures

### Device Row
```sql
devices (
  id UUID,
  imei VARCHAR,
  current_state_id UUID,      -- FK states.id
  assigned_action_id UUID,    -- FK actions.id or NULL (single-flight lock)
  api_key_hash VARCHAR,       -- SHA-256 of mdm_live_<token>
  service_id UUID,            -- AUTO-synced from states.service_id on state change
  info JSONB,                 -- device_info from PULL requests
  last_checkin_at TIMESTAMP,
  first_checkin_at TIMESTAMP,
  ...
)
```

### Milestone Row
```sql
milestones (
  id UUID,
  device_id UUID,             -- FK devices.id
  action_id UUID,             -- FK actions.id
  event_type VARCHAR,         -- REQUESTED | APPLIED | FAILED
  from_state_id UUID,         -- FK states.id
  to_state_id UUID,           -- FK states.id
  template_id UUID,           -- FK message_templates.id (optional)
  requested_by_id UUID,       -- User who triggered (admin or system)
  payload JSONB,              -- {command_id, status, executed_at, error}
  created_at TIMESTAMP,
  ...
)
```

### SQS Message Body (ACK Enqueue)
```json
{
  "target_service": "checkin",
  "device_id": "uuid-string",
  "action_id": "uuid-string",
  "command_id": "cmd-xxx",
  "template_id": null,
  "requested_by_id": null,
  "extras": {
    "result": {
      "status": "SUCCESS|FAILED",
      "executed_at": "2026-06-07T...",
      "error": {}
    }
  }
}
```

## Critical Functions

### `handle_checkin(body, auth_header, imei_header)` → dict
- Entry point for POST /v1/checkin
- Branches on `command_result` presence
- Wraps all logic in `db.conn.transaction()`
- Enqueues ack *after* transaction commits

### `validate_device_bearer(db, auth_header, imei_header)` → dict
- Bearer token extraction and SHA-256 validation
- IMEI header cross-check (if provided)
- Returns device row or raises 401/403

### `_validate_ack(db, device, result)` → dict | None
- Checks `status` ∈ {SUCCESS, FAILED}
- Finds REQUESTED milestone by command_id
- REQUESTED-scoped idempotency check
- Returns enqueue params or None (idempotent case)

### `_pull_pending_command(db, device)` → dict | None
- Fetches latest REQUESTED milestone for device.assigned_action_id
- Filters out SYSTEM_ACTIONS
- Resolves notification template
- Returns command dict or None

### `Database.update_device_fields(device_id, **fields)` → None
- Whitelist-based column updates (no injection risk)
- Auto-syncs `service_id` from new state if `current_state_id` changes
- All params bound via `%(name)s`

## Configuration

**Env Vars (config.py):**
- `DATABASE_URL` or (`DB_SECRET_ARN` + `DB_ENDPOINT`) — DB credentials
- `CHECKIN_QUEUE_URL`, `PROCESSOR_QUEUE_URL` — SQS endpoints
- `LOG_LEVEL` — Python logging level (default INFO)
- `AWS_REGION_OVERRIDE`, `AWS_REGION` — AWS region (default ap-southeast-1)

**Constants (constants.py):**
- `SYSTEM_ACTIONS` = {REGISTER, ENROLL} — server-applied, not device-facing
- `DEVICE_BOUND_ACTIONS` = {ACTIVATE, LOCK, UNLOCK, NOTIFY_*, RELEASE_*}
- `CHECKIN_INTERVAL_IDLE` = 3600s, `CHECKIN_INTERVAL_PENDING` = 60s
- `API_KEY_PREFIX` = "mdm_live_", `API_KEY_TOKEN_LEN` = 32

## Error Handling

All endpoint errors are typed `AppError` subclasses:
- `Unauthorized(code, msg)` → 401
- `Forbidden(code, msg)` → 403
- `BadRequest(code, msg)` → 400
- `NotFound(code, msg)` → 404
- `Conflict(code, msg)` → 409
- `InternalError(msg)` → 500

Response includes `retry_strategy` block (retryable only ≥500).

## Testing

**No unit tests.** E2E validation via an end-to-end lifecycle test against deployed stack:
- 10-milestone device lifecycle assertion
- Concurrency lock rejection
- ACK idempotency

Run against a deployed stack in AWS (the E2E lifecycle test is kept local).

## Naming Conventions

- **Top-level files:** kebab-case (handler.py, sqs_client.py)
- **Packages:** snake_case (routes/)
- **Timestamps:** ISO-8601 UTC with `Z` suffix (`.replace("+00:00", "Z")`)
- **Error codes:** SCREAMING_SNAKE_CASE (INVALID_CREDENTIALS, DEVICE_RELEASED)
- **API key format:** mdm_live_<32 random chars>, only hash stored

## Security

- **Auth:** Bearer token (SHA-256 hash lookup)
- **Injection:** All SQL params via `%(name)s` binding
- **Rate limiting:** Not implemented (API Gateway policy)
- **Secrets:** DB credentials from Secrets Manager (not in code)
- **Device binding:** IMEI header optional cross-check
