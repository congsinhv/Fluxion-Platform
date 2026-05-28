# Fluxion Backend — Code Standards & Best Practices

## Overview

This document defines the coding conventions, architectural patterns, and quality expectations for the Fluxion backend (five Python 3.12 Lambdas). All standards are enforced by ruff linting and verified by E2E testing.

## Toolchain

### Linting & Formatting

**Tool**: [Ruff](https://docs.astral.sh/ruff/) (Python linter + formatter)

**Config** (root `pyproject.toml`):
```toml
[tool.ruff]
line-length = 100
target-version = "py312"
lint.select = ["E", "F", "I", "UP", "B"]
lint.ignore = ["E501"]  # Line too long (handled by formatter)
```

**Commands** (run from monorepo root):
```bash
npm run lint            # ruff check (report violations)
npm run lint:fix        # ruff check --fix (auto-fix)
npm run fmt             # ruff format (auto-format)
npm run fmt:check       # ruff format --check (report only)
```

**Pre-commit**: All commits must pass linting. Tests are allowed to fail temporarily (for local debugging), but linting violations must be fixed before push.

### Python Version

**Python 3.12** — all Lambda code must be compatible. Use modern syntax (`match`, PEP 701 fstring syntax, structural pattern matching where applicable).

## File Organization

### Directory Structure

```
fluxion-platform-{resolver,processor,checkin,enroll,applier}/
├── handler.py                       # Entrypoint (required)
├── {app.py, sqs_consumer.py}       # Lambda-specific logic (as needed)
├── routes/                          # HTTP endpoints (FastAPI Lambdas)
├── resolvers/                       # GraphQL resolvers (Resolver only)
├── auth.py                          # Auth logic (if Lambda has auth)
├── fcm_dispatcher.py                # FCM dispatch (Processor only)
├── config.py                        # [SHARED COPY] env + clients + logger
├── constants.py                     # [SHARED COPY] immutable values
├── db.py                            # [SHARED COPY] DB wrapper
├── errors.py                        # [SHARED COPY] error types
├── sqs_client.py                    # [SHARED COPY] SQS helper
├── requirements.txt                 # Dependencies (per-Lambda)
├── docs/                            # Per-Lambda module documentation
└── Makefile (or no build file)      # CDK handles bundling
```

### File Naming

| Category | Style | Examples |
|----------|-------|----------|
| **Directories** | kebab-case | `fluxion-platform-resolver`, `routes/`, `resolvers/` |
| **Top-level Python files** | kebab-case (legacy from repo convention) | `handler.py`, `config.py`, `sqs_client.py` |
| **Files in packages** | snake_case | `resolvers/device.py`, `routes/checkin_route.py` |
| **Classes** | PascalCase | `AppError`, `CheckinRoute`, `DeviceResolver` |
| **Functions/variables** | snake_case | `enqueue_action()`, `device_id`, `max_retries` |
| **Constants** | UPPER_SNAKE | `SYSTEM_ACTIONS`, `API_KEY_PREFIX`, `IMEI_LENGTH` |
| **GraphQL fields** | camelCase (in schema) | `lastCheckinAt`, `commandResult`, `assignedActionId` |

## Code Patterns

### Database Access

#### Single Module-Global Connection

```python
# db.py
import psycopg
from psycopg.rows import dict_row

conn = None

def get_connection():
    global conn
    if conn is None:
        url = os.getenv("DATABASE_URL") or _get_from_secrets_manager()
        conn = psycopg.connect(url, row_factory=dict_row)
        conn.autocommit = True  # Explicit commit required for multi-statement
    return conn

# Usage in any module
from db import get_connection
cur = get_connection().cursor()
```

#### Parameter Binding (Never Interpolate)

**CORRECT**:
```python
cur.execute(
    "UPDATE devices SET current_state_id = %(state_id)s WHERE id = %(device_id)s",
    {"state_id": new_state_id, "device_id": device_id}
)
```

**WRONG** (SQL injection risk):
```python
# ❌ Never do this
cur.execute(f"UPDATE devices SET current_state_id = {new_state_id} WHERE id = {device_id}")
```

#### Multi-Statement Transactions

```python
from db import get_connection

with get_connection().transaction():
    # Multiple statements here
    cur.execute("INSERT INTO milestones (...) VALUES (...)", {...})
    cur.execute("UPDATE devices SET assigned_action_id = %s WHERE id = %s", [...])
    # Auto-commit on exit; rollback on exception
```

#### Row Factory

All queries use `dict_row` factory. Access columns by key:

```python
cur.execute("SELECT id, name, current_state_id FROM devices WHERE id = %s", [device_id])
row = cur.fetchone()
print(row["name"])  # ✓
print(row[1])       # ✗ (avoid index access)
```

### Configuration & Secrets

#### Env Vars & Lazy AWS Clients

```python
# config.py
import os
import boto3
from config import logger  # Import first to configure root logger

# Read env at import time
DATABASE_URL = os.getenv("DATABASE_URL")
API_KEY_PREFIX = os.getenv("API_KEY_PREFIX", "mdm_live_")

_secretsmanager_client = None

def secretsmanager():
    """Lazy, thread-safe AWS Secrets Manager client."""
    global _secretsmanager_client
    if _secretsmanager_client is None:
        _secretsmanager_client = boto3.client("secretsmanager", region_name="ap-southeast-1")
    return _secretsmanager_client

def _get_db_url():
    """Fall back from DATABASE_URL env to Secrets Manager."""
    if DATABASE_URL:
        return DATABASE_URL
    # Deployed: use Secrets Manager
    secret_id = os.getenv("DB_SECRET_ARN")
    endpoint = os.getenv("DB_ENDPOINT")
    response = secretsmanager().get_secret_value(SecretId=secret_id)
    secret = json.loads(response["SecretString"])
    return f"postgresql://user:pass@{endpoint}:5432/fluxion"
```

#### Root Logger Configuration

Importing `config.py` configures the root logger (side effect). Always import first:

```python
from config import logger  # ✓ Setup happens here

def my_function():
    logger.info("event_name", extra={"key": "value"})
```

### Error Handling

#### Typed Error Classes

```python
# errors.py
class AppError(Exception):
    """Base error class with code + message."""
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message

class BadRequest(AppError):
    def __init__(self, message: str):
        super().__init__("BAD_REQUEST", message)

class NotFound(AppError):
    def __init__(self, message: str):
        super().__init__("NOT_FOUND", message)

class Conflict(AppError):
    def __init__(self, message: str):
        super().__init__("CONFLICT", message)
```

#### Raising & Mapping

```python
# resolver/handler.py (GraphQL)
def upload_imei(imei: str) -> dict:
    if not imei.isdigit() or len(imei) != 15:
        raise AppError("INVALID_IMEI", "IMEI must be 15 digits")
    # ...

# Exception handler serializes to GraphQL error
{"errorType": "AppError", "errorMessage": "IMEI must be 15 digits", "extensions": {"code": "INVALID_IMEI"}}
```

```python
# checkin/app.py (HTTP)
@app.exception_handler(AppError)
async def app_error_handler(request, exc):
    return JSONResponse(
        status_code=_status_code(exc.code),
        content={
            "error_code": exc.code,
            "message": exc.message,
            "retry_strategy": _retry_strategy(exc.code)
        }
    )

def _status_code(code: str) -> int:
    """Map error codes to HTTP status."""
    if code in ("INVALID_IMEI", "INVALID_API_KEY"):
        return 400  # Bad Request
    if code == "NOT_FOUND":
        return 404
    if code == "CONFLICT":
        return 409
    return 500  # Internal Server Error

def _retry_strategy(code: str) -> dict:
    """Retryable only for 5xx."""
    if code.startswith("INTERNAL"):
        return {"retry": True, "backoff_ms": 1000}
    return {"retry": False}
```

### SQS Messaging

#### Message Format

```python
# sqs_client.py
def enqueue_action(target_service: str, payload: dict) -> None:
    """Enqueue an action to the appropriate SQS queue."""
    message_body = {
        "target_service": target_service,  # "processor" or "checkin"
        **payload  # Spread action details (action_id, device_id, etc.)
    }
    
    sqs().send_message(
        QueueUrl=_queue_url(target_service),
        MessageBody=json.dumps(message_body),
        MessageAttributes={}  # ESM filtering not used (separate queues instead)
    )

def _queue_url(target_service: str) -> str:
    """Map target_service to queue URL."""
    if target_service == "processor":
        return os.getenv("PROCESSOR_QUEUE_URL")
    elif target_service == "checkin":
        return os.getenv("CHECKIN_QUEUE_URL")
    raise ValueError(f"Unknown target_service: {target_service}")
```

#### SQS Handler Pattern

```python
# processor/handler.py
def lambda_handler(event, context):
    batch_item_failures = []
    
    for record in event.get("Records", []):
        try:
            message_body = json.loads(record["body"])
            _process_one(message_body)
        except Exception as e:
            logger.exception("process_error", extra={"message_id": record["messageId"]})
            batch_item_failures.append({
                "itemId": record["messageId"],
                "reason": "InvalidPayload"
            })
    
    return {"batchItemFailures": batch_item_failures}

def _process_one(message: dict) -> None:
    """Process a single SQS message."""
    action_id = message["action_id"]
    device_id = message["device_id"]
    # ... business logic
```

### Logging

#### Format: `<service>.<event> key=value`

```python
from config import logger

# Good
logger.info("action_request", extra={"action_id": "abc", "device_id": 123, "state": "IDLE"})
# Output: processor.action_request action_id=abc device_id=123 state=IDLE

# Good
logger.warning("fcm_push_failed", extra={"device_id": 123, "error": "InvalidToken"})
# Output: processor.fcm_push_failed device_id=123 error=InvalidToken

# Avoid
logger.info(f"Processing action {action_id} for device {device_id}")  # Unstructured
```

#### Log Levels

| Level | When | Example |
|-------|------|---------|
| **INFO** | Normal operation events | action_request, state_transition, ack_received |
| **WARNING** | Unexpected but recoverable | fcm_push_failed, device_released_unexpected |
| **ERROR** | Error that stops processing | db_connection_failed, invalid_message |
| **DEBUG** | Development troubleshooting | query_result, lock_acquired (disabled in prod) |

#### Applier Log Prefix

Applier keeps the historical `checkin_sqs.` prefix (was part of checkin, now split out):

```python
# applier/sqs_consumer.py
logger.info("checkin_sqs.device_ack", extra={"device_id": 123, "command_id": "xyz", "result": "SUCCESS"})
```

### Concurrency & Locks

#### SELECT FOR UPDATE Pattern

```python
# Acquire lock + guarantee read consistency
with db.conn.transaction():
    cur = db.conn.cursor()
    cur.execute(
        """
        SELECT id, current_state_id, assigned_action_id FROM devices
        WHERE id = %(device_id)s
        FOR UPDATE
        """,
        {"device_id": device_id}
    )
    row = cur.fetchone()
    if row is None:
        raise NotFound(f"Device {device_id} not found")
    
    # Check single-flight lock
    if row["assigned_action_id"] is None:
        # Acquire lock
        cur.execute(
            "UPDATE devices SET assigned_action_id = %(action_id)s WHERE id = %(device_id)s",
            {"action_id": action_id, "device_id": device_id}
        )
    elif row["assigned_action_id"] == action_id:
        # Redelivery: already locked by this action
        pass
    else:
        # Device busy: silent drop
        return
    
    # Proceed with business logic
    cur.execute("INSERT INTO milestones (...) VALUES (...)", {...})
    
    # Commit happens on context exit
```

#### Side Effects After Commit

**All SQS enqueues and FCM pushes must run AFTER the database transaction commits:**

```python
# processor/handler.py
def _process_one(message: dict) -> None:
    with db.conn.transaction():
        # Acquire lock, write REQUESTED
        cur = db.conn.cursor()
        cur.execute(...)  # state writes
        # Commit happens on context exit
    
    # Side effects AFTER commit
    if is_device_bound_action:
        fcm_dispatcher.dispatch(device_id, action)  # May fail, doesn't fail the message
    elif is_system_action:
        sqs_client.enqueue_action("checkin", {...})  # Requeue for Applier
```

### Type Hints (Optional but Encouraged)

Use type hints where they aid readability, especially for public functions:

```python
from typing import Optional, List

def find_device(device_id: int) -> Optional[dict]:
    """Find device by ID. Returns dict row or None."""
    cur = db.conn.cursor()
    cur.execute("SELECT * FROM devices WHERE id = %s", [device_id])
    return cur.fetchone()

def enqueue_action(target_service: str, payload: dict) -> None:
    """Enqueue action to SQS."""
    ...
```

## Architectural Constraints

### 1. No Shared Package

**Rule**: Never extract a `shared/` package. Duplication across Lambda dirs is **intentional and required**.

**Why**:
- CDK bundles each Lambda directory as one self-contained Docker asset.
- A shared package requires extra Docker mount, extra pip step, expensive asset hash recomputation.
- Cost of duplication << cost of complex build infrastructure.

**When you edit a shared file**:
- Shared files: `config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py`.
- Mirror the change across all five sibling copies (`../fluxion-platform-{resolver,processor,checkin,enroll,applier}/`).

### 2. Sole Transition Writer

**Rule**: Only the Applier Lambda writes APPLIED/FAILED milestones and flips `devices.current_state_id`.

**Why**: Prevents race conditions between milestone write, state flip, and lock release.

**What other Lambdas can do**:
- Resolver: write UPLOAD-APPLIED inline (synchronous, exception if fails).
- Processor: write REQUESTED milestone + acquire lock.
- Checkin: no state writes; validate ack + enqueue only.
- Enroll: update device fields (api_key_hash, provisioned_at); no state write.
- Applier: **sole writer** of APPLIED/FAILED + state flip + lock release.

### 3. Two SQS Queues (Never One)

**Rule**: Two physical queues: `fluxion-action-processor` (Processor consumes) and `fluxion-action-checkin` (Applier consumes).

**Why**: AWS EventSource Mapping (ESM) filtering on a shared queue races. Non-matching ESM deletes the message before matching ESM can poll.

**Example failure on shared queue**:
```
Processor Message (target_service=processor)
    ↓
ESM filter on checkin side: no match → mark processed → delete
    ↓
Applier never sees it (lost)
```

### 4. Single-Flight Lock Per Device

**Rule**: `devices.assigned_action_id` is set with `WHERE assigned_action_id IS NULL`. Only one action in-flight per device.

**Lock acquisition** (Processor):
```sql
UPDATE devices 
SET assigned_action_id = %(action_id)s 
WHERE id = %(device_id)s AND assigned_action_id IS NULL
```

**Lock release** (Applier):
```sql
UPDATE devices 
SET assigned_action_id = NULL 
WHERE id = %(device_id)s
```

### 5. Idempotent Acks (Command_id Scoping)

**Rule**: Device acks are deduplicated by `command_id` (scoped to the REQUESTED milestone), NOT action_id.

**Why**: Device-bound actions (LOCK, UNLOCK) reuse the same action_id across cycles. A stale SQS redelivery of an ack from an earlier cycle must not interfere with the live cycle's lock.

**Example**:
```
Cycle 1: LOCK (action_id=5) → command_id=cmd_1 → device acks cmd_1 → APPLIED
Cycle 2: UNLOCK (action_id=5) → command_id=cmd_2 → device acks cmd_2 → APPLIED
Stale redelivery of ack(cmd_1) must be no-op (not re-apply, not touch cmd_2's lock)
```

## Testing

### No Unit Tests

There is no Python unit-test suite. Correctness is validated by E2E tests.

### E2E Test

An end-to-end lifecycle test runs against a **deployed** stack and verifies:
1. **10-milestone lifecycle** — UPLOAD → REGISTER → ENROLL → ACTIVATE → LOCK → UNLOCK → RELEASE.
2. **Lock rejection under concurrency** — Concurrent requests on same device reject gracefully.
3. **Idempotent acks** — Redelivered acks don't create duplicate milestones.

> Note: operational scripts (E2E lifecycle test, admin-user provisioning, device cleanup) are kept local and are not part of the public repository.

### Compile Check

Quick syntax validation (run locally before commit):
```bash
python3 -m py_compile handler.py db.py config.py
```

## Code Review Checklist

- [ ] Linting passes: `npm run lint` has no violations.
- [ ] No SQL injection: all params via `%(name)s`, never f-strings or concatenation.
- [ ] Single-flight lock respected: Processor acquires, Applier releases (other Lambdas don't touch).
- [ ] Side effects after commit: SQS enqueue + FCM happen only after transaction closes.
- [ ] Shared files mirrored: if editing config.py, check all five copies.
- [ ] Error handling: AppError raised + mapped to response (GraphQL/HTTP).
- [ ] Logging structured: `<service>.<event> key=value` format.
- [ ] No hardcoded secrets: all env vars or Secrets Manager.

## Refactoring Guidelines

### When to Split a File

- **Limit**: ~200 lines of code per file (soft guideline; handler.py may exceed).
- **Split by domain**: resolver/device.py (Device queries/mutations), resolver/action.py (Action queries/mutations).
- **Test**: ensure E2E still passes after refactoring.

### When NOT to Extract a Shared Package

- No shared package, ever. Duplication is acceptable and intentional.
- If code is duplicated across multiple Lambdas, that's by design.

### Deprecation

If removing or renaming a module/function:
1. Update CLAUDE.md + per-Lambda docs.
2. Verify no external consumers (grep across Lambdas).
3. Remove completely (don't leave TODO comments).

## Security

### Secrets Handling

- **Never log secrets**: DB password, api_key, Firebase key must never appear in logs.
- **Env vars**: Use `os.getenv()`, not `open(".env")`.
- **Secrets Manager**: For deployed environments, fetch via `secretsmanager()` client.
- **Error responses**: Never expose internal error details in HTTP responses (log them, return generic 500).

### Input Validation

All external inputs must be validated:
- GraphQL args: validate in resolver before DB query.
- HTTP params: validate in FastAPI route handler.
- SQS messages: validate JSON structure before processing.

### IMEI & API Key

- **IMEI**: Must be exactly 15 digits (numeric). Validated in Enroll Lambda.
- **API Key**: Generated with `mdm_live_` prefix + 32 random bytes. Only SHA-256 hash stored, never plaintext.

## Performance

### Connection Pooling

Single module-global connection (psycopg) handles concurrency via psycopg's internal threading. No explicit connection pool needed for Lambda (stateless, isolated execution).

### Query Optimization

- Use indexed lookups: `device_id`, `created_at`.
- Avoid N+1 queries: fetch related data in one query when possible.
- Milestones are append-only; queries are simple range selects.

### Batch Processing

SQS batch size: typically 10–50 messages per Lambda invocation. Process each independently; partial batch failures (return `batchItemFailures`) allow retry of failed messages.

## Documentation Standards

### Code Comments

- Explain the **why**, not the what. Code is the "what"; comments are the "why".
- Comments must be self-contained (never reference plan/phase numbers).
- Update comments when code changes.

**Good**:
```python
# Device-bound actions repeat across the lifecycle (LOCK → UNLOCK → LOCK reuses action_id).
# Deduplicate by command_id (scoped to REQUESTED), not action_id.
```

**Bad**:
```python
# Per F13, use command_id for idempotency
```

### Module Docstrings

Every file and function should have a docstring:

```python
"""Fluxion Applier — SQS consumer for state transitions.

This is the sole writer of APPLIED/FAILED milestones and device state flips.
See CLAUDE.md for concurrency invariants.
"""

def apply_milestone(device_id: int, action_id: str, result: str) -> None:
    """Write APPLIED/FAILED milestone and flip device state.
    
    Args:
        device_id: Device ID.
        action_id: Action ID from REQUESTED milestone.
        result: "SUCCESS" or error message.
    
    Raises:
        AppError: If device not found or lock not held.
    """
```

## CI/CD Integration

### GitHub Actions (if used)

Pre-commit checks should run:
1. `npm run lint` — Ruff linting.
2. `npm run fmt:check` — Format check.
3. No Python unit tests (E2E is post-deploy).

Push should not be blocked by E2E (too slow); run E2E post-deployment only.
