# Fluxion Backend — Codebase Summary

## Directory Structure

```
fluxion-platform-backend/
├── docs/                              # Backend-level umbrella documentation
├── CLAUDE.md                          # Guidance for working in the backend
├── README.md                          # Quick facts and directory overview
│
├── fluxion-platform-resolver/         # GraphQL field dispatch
│   ├── handler.py                     # AppSync Lambda handler
│   ├── resolvers/                     # Per-entity module dict (device, milestone, action, etc.)
│   ├── auth.py                        # Cognito identity → user upsert
│   ├── models.py                      # GraphQL type stubs (not used for persistence)
│   └── docs/                          # Resolver-specific module documentation
│
├── fluxion-platform-processor/        # SQS consumer; request originator
│   ├── handler.py                     # SQS event dispatch + lock acquisition
│   ├── fcm_dispatcher.py              # Firebase Cloud Messaging (never raises)
│   └── docs/                          # Processor-specific module documentation
│
├── fluxion-platform-checkin/          # HTTP device gateway
│   ├── handler.py                     # Mangum entrypoint
│   ├── app.py                         # FastAPI application
│   ├── routes/checkin_route.py        # POST /v1/checkin (PULL + ACK)
│   ├── auth.py                        # Bearer api_key validation
│   └── docs/                          # Checkin-specific module documentation
│
├── fluxion-platform-enroll/           # HTTP enrollment endpoint
│   ├── handler.py                     # Mangum entrypoint
│   ├── app.py                         # FastAPI application
│   ├── routes/enroll.py               # POST /v1/enroll
│   ├── auth.py                        # Api_key issuance
│   └── docs/                          # Enroll-specific module documentation
│
└── fluxion-platform-applier/          # SQS consumer; sole transition writer
    ├── handler.py                     # SQS event dispatch
    ├── sqs_consumer.py                # State transition logic
    └── docs/                          # Applier-specific module documentation
```

## Shared Files (Intentionally Duplicated)

Every Lambda directory contains **copies** of these files (no shared package):

| File | Purpose | Duplication Reason |
|------|---------|-------------------|
| `config.py` | Env vars, lazy AWS clients, root logger config | CDK bundles each dir independently |
| `constants.py` | Immutable values: action classification, queue names, intervals | Each Lambda must be self-contained |
| `db.py` | psycopg wrapper: single module-global connection, dict_row, autocommit=True | No external dependencies |
| `errors.py` | Typed AppError subclasses with UPPER_SNAKE codes | Each Lambda maps to own error handler |
| `sqs_client.py` | Lazy SQS client, enqueue helper | Reduces code duplication within a dir |

When you edit one copy, mirror the change across all five sibling directories.

## Per-Lambda Architecture

### Resolver (`fluxion-platform-resolver/`)

**Role**: GraphQL field dispatch for admin console queries and mutations.

**Key modules**:
- `handler.py` — routes GraphQL fieldName to resolver module via `QUERY_HANDLERS`/`MUTATION_HANDLERS` dicts aggregated in `resolvers/__init__.py`.
- `resolvers/` — per-entity modules (device.py, milestone.py, action.py, state.py, message_template.py, service.py, tac.py, device_upload.py, serializers.py), each exporting `QUERY_HANDLERS`/`MUTATION_HANDLERS`.
- `auth.py` — Cognito identity extraction; admin user upsert to `users` table.

**Request flow**:
1. AppSync invokes Resolver Lambda with GraphQL context (parentValue, args, identity).
2. Handler routes by fieldName to appropriate resolver module.
3. Resolver executes query or queues mutation (enqueue only for write mutations; no direct state writes).
4. GraphQL errors raised as AppError → exception handler serializes to `{errorType, errorMessage, extensions.code}`.

**Key behavior**:
- `uploadImei` — synchronous: Device + UPLOAD-APPLIED milestone written inline (no SQS).
- `dispatchAction` — validates action is allowed for device state, then enqueues to `fluxion-action-processor` queue (state flip is async).

**Documentation**: Per-Lambda docs in `resolvers/docs/`. No CLAUDE.md yet (consider adding).

### Processor (`fluxion-platform-processor/`)

**Role**: SQS consumer for `fluxion-action-processor` queue. Sole request-originator.

**Key modules**:
- `handler.py` — consumes SQS batch, for each message: acquires device lock (SELECT FOR UPDATE + WHERE assigned_action_id IS NULL), writes REQUESTED milestone, routes to FCM or re-enqueue.
- `fcm_dispatcher.py` — Firebase Cloud Messaging wake push; **never raises** (failure is a no-op; device polls eventually).

**Concurrency model**:
- Acquired lock: device row locked, `assigned_action_id IS NULL` (first action) or equals message `action_id` (redelivery).
- Silent drop: `assigned_action_id` is a different action (device busy).
- Side effects (FCM, re-enqueue) run **after** DB commit.

**Key behavior**:
- SYSTEM_ACTIONS (REGISTER, ENROLL) → re-enqueue to `fluxion-action-checkin` queue (Applier writes APPLIED).
- DEVICE_BOUND_ACTIONS (ACTIVATE, LOCK, UNLOCK, NOTIFY, RELEASE) → FCM wake push (device acks via `/v1/checkin`).

**Documentation**: `processor/CLAUDE.md`, per-Lambda docs in `processor/docs/`.

### Checkin (`fluxion-platform-checkin/`)

**Role**: HTTP-only device gateway. Device heartbeat + command pull + ack validation.

**Key modules**:
- `handler.py` — Mangum entrypoint (AWS Lambda Function URL or API Gateway HTTP).
- `app.py` — FastAPI application with exception handlers.
- `routes/checkin_route.py` — POST /v1/checkin; branches on presence of `command_result` in body.
- `auth.py` — Bearer api_key validation (SHA-256 hash compare); optional `X-Device-IMEI` cross-check.

**Request flow**:
- **PULL** (no `command_result`): Heartbeat (update `last_checkin_at`), return pending command from latest REQUESTED milestone (never SYSTEM_ACTIONS).
- **ACK** (`command_result` present): Validate synchronously (bad ack → 4xx), enqueue to `fluxion-action-checkin` queue (Applier writes APPLIED/FAILED).

**Key behavior**:
- No inline state writes; only the Applier Lambda writes transitions.
- ACK idempotency: deduplicate by `command_id` (scoped to REQUESTED), not action_id.
- RELEASED devices: 403 Forbidden.

**Documentation**: `checkin/CLAUDE.md`, per-Lambda docs in `checkin/docs/`.

### Enroll (`fluxion-platform-enroll/`)

**Role**: HTTP-only device enrollment. IMEI validation, api_key issuance.

**Key modules**:
- `handler.py` — Mangum entrypoint.
- `app.py` — FastAPI application.
- `routes/enroll.py` — POST /v1/enroll; validates IMEI (15 digits), device REGISTERED state, generates api_key, enqueues ENROLL.
- `auth.py` — Api_key generation (mdm_live_ prefix + 32 random bytes); SHA-256 hash storage.

**Request flow**:
1. Validate IMEI (15 digits) and device exists + is in REGISTERED state.
2. Generate api_key (mdm_live_ prefix), compute SHA-256 hash.
3. Update device fields (api_key_hash, provisioned_at) under FOR UPDATE.
4. After commit: enqueue ENROLL to Processor queue.
5. Return api_key to device (synchronously); state flip is async.

**Key behavior**:
- Re-enroll of ENROLLED/ACTIVE device → 409 Conflict (safe because DPC disables factory reset).
- ENROLL is a SYSTEM_ACTION (server-applied, no FCM, no device ack).
- Processor handles ENROLL → Applier applies (REGISTERED → ENROLLED), then auto-chains ACTIVATE.

**Documentation**: `enroll/CLAUDE.md`, per-Lambda docs in `enroll/docs/`.

### Applier (`fluxion-platform-applier/`)

**Role**: SQS consumer for `fluxion-action-checkin` queue. Sole transition writer.

**Key modules**:
- `handler.py` — SQS event dispatch; message routing.
- `sqs_consumer.py` — State transition logic: write APPLIED/FAILED, flip state, clear lock, auto-chain.

**Concurrency model**:
- All checks inside one transaction (SELECT FOR UPDATE).
- Device-ack idempotency: keyed by `command_id` (scoped to REQUESTED), not action_id (device-bound actions repeat).
- Redelivery handling: if APPLIED already exists, clear lock and still attempt auto-chain (self-heal).

**Key behavior**:
- **Device-ack** (result present): Write APPLIED/FAILED (applied_by=DEVICE).
- **Server-applied** (result absent, REGISTER/ENROLL): Write APPLIED (applied_by=SYSTEM), then auto-chain ENROLL → ACTIVATE.
- Auto-chain: runs after commit, guarded by "chain already started" milestone check.

**Documentation**: `applier/CLAUDE.md`, per-Lambda docs in `applier/docs/`.

## Code Patterns (Uniform Across All Five)

### Database Access (`db.py`)

```python
# Single module-global connection
conn = psycopg.connect(...)
conn.autocommit = True
conn.row_factory = dict_row

# Multi-statement writes
with conn.transaction():
    # multiple statements

# All params via %(name)s, never interpolated
cur.execute("UPDATE devices SET current_state_id = %(state_id)s WHERE id = %(device_id)s", {...})
```

### Configuration (`config.py`)

```python
# Importing configures root logger (side effect)
from config import logger

# Env vars read at import time
DATABASE_URL = os.getenv("DATABASE_URL") or _get_from_secrets_manager()

# Lazy AWS clients
def sqs():
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client("sqs", region_name="ap-southeast-1")
    return _sqs_client
```

### Constants (`constants.py`)

```python
# Immutable values only — no env, no clients, no I/O
SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})
DEVICE_BOUND_ACTIONS = frozenset({"ACTIVATE", "LOCK", "UNLOCK", ...})
AUTO_CHAIN_AFTER_APPLIED = {"ENROLL": "ACTIVATE"}
API_KEY_PREFIX = "mdm_live_"
IMEI_LENGTH = 15
```

### Errors (`errors.py`)

```python
class AppError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message

# Raise in handler
raise AppError("INVALID_IMEI", "IMEI must be 15 digits")

# HTTP handlers map to JSON
{"error_code": "INVALID_IMEI", "message": "...", "retry_strategy": {...}}
```

### SQS Client (`sqs_client.py`)

```python
def enqueue_action(target_service: str, action: dict) -> None:
    body = json.dumps({
        "target_service": target_service,
        **action
    })
    sqs().send_message(
        QueueUrl=_queue_url(target_service),
        MessageBody=body,
        ...
    )
```

## Naming Conventions

| Style | Usage | Examples |
|-------|-------|----------|
| **kebab-case** | Directory + top-level files | `fluxion-platform-resolver/`, `config.py`, `sqs_client.py` |
| **snake_case** | Files inside Python packages | `resolvers/device.py`, `routes/checkin_route.py` |
| **UPPER_SNAKE** | Error codes, constants | `INVALID_IMEI`, `SYSTEM_ACTIONS`, `TARGET_PROCESSOR` |
| **camelCase** | GraphQL fields + device API fields | `lastCheckinAt`, `commandResult`, `assignedActionId` |

## Logging Format

```
<service>.<event> key1=value1 key2=value2

# Examples
processor.action_request action_id=abc123 device_id=456 state=IDLE
applier.state_transition device_id=456 from_state=REGISTERED to_state=ENROLLED
checkin_sqs.device_ack device_id=456 command_id=xyz command_result=SUCCESS
```

Applier keeps historical `checkin_sqs.` prefix for log continuity (was part of checkin, now split out).

## Database Schema (Key Tables)

| Table | Purpose | Key columns |
|-------|---------|------------|
| `devices` | Device inventory | id, imei, current_state_id, assigned_action_id, api_key_hash |
| `milestones` | Action audit trail | device_id, action_id, command_id, type (REQUESTED/APPLIED/FAILED), status, actor, created_at |
| `states` | State machine config | id, name (IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED) |
| `actions` | Action config | id, name, from_state_id, target_state_id, actor_type |
| `message_templates` | Notification templates | state_id, message_type, template_text |

Full schema managed by Alembic migrations in repo root `scripts/db/migrations/`.

## External Dependencies

| Package | Use | Why |
|---------|-----|-----|
| `psycopg` | PostgreSQL driver | Modern, type-safe async optional |
| `boto3` | AWS SDK | Lambda + SQS + Secrets Manager integration |
| `fastapi` | HTTP framework | Async, dependency injection (Checkin + Enroll) |
| `mangum` | ASGI-to-Lambda adapter | FastAPI on AWS Lambda |
| `pydantic` | Data validation | Request/response schemas (optional, not heavily used) |
| `firebase-admin` | FCM dispatch | Push notifications (Processor) |

All declared in per-Lambda `requirements.txt` (no shared Pipfile).

## Tooling & Commands

All commands run from **monorepo root** (`/Users/synhvo/RSU/Fluxion-Platform`), not the backend directory:

```bash
npm run lint                # ruff check apps scripts
npm run lint:fix            # ruff check --fix
npm run fmt                 # ruff format
npm run fmt:check           # format check only
npm run db:up               # docker compose up -d postgres
npm run db:migrate          # alembic upgrade head (seeds states/actions/templates)
npm run infra:deploy        # CDK deploy --profile fluxion-dev
```

Ruff config (root `pyproject.toml`): py312, line-length 100, rules E/F/I/UP/B (E501 ignored).

**No Python unit-test suite.** Correctness validated by an end-to-end lifecycle test against a deployed stack.

## Testing Strategy

| Test Level | Tool | Scope |
|----------|------|-------|
| **Compile check** | `python3 -m py_compile` | Syntax errors only |
| **Lint** | `ruff check` | Style, imports, unused vars |
| **E2E** | End-to-end lifecycle test | Deployed stack: 10-milestone lifecycle, lock rejection, idempotent acks |

The E2E test is the source of truth for correctness. It polls eventual consistency rather than assuming synchronous transitions.

## Known Limitations

1. **No Python unit tests** — E2E is the primary validation method.
2. **Resolver lacks CLAUDE.md** — Per-Lambda guidance documents exist for Processor, Checkin, Enroll, Applier but not Resolver.
3. **No GraphQL subscriptions** — Admin console polls every 10 seconds (read-only, no mutations).
4. **Single-region deployment** — All five Lambdas and the database live in `ap-southeast-1` (Singapore).
5. **Stale inline comments** — Some per-Lambda docs and code comments reference the old 4-Lambda design; ignore in favor of CLAUDE.md and filesystem truth.
