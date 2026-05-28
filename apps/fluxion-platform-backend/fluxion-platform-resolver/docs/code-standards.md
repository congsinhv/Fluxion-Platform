# Code Standards: fluxion-platform-resolver

## Module Organization

### Self-Contained Lambda

The resolver is one of five independent Lambdas in the platform backend. Each Lambda duplicates core files:
- `config.py` — env vars, lazy boto3 clients, logger setup
- `constants.py` — immutable values (action classification, queue labels, intervals)
- `db.py`, `errors.py`, `sqs_client.py` — shared infra layer

**Why duplicated, not shared?** CDK Docker bundling treats each Lambda directory as one atomic asset. A shared `shared/` package would require:
- Second Docker volume mount
- Extra pip install step
- `assetHashType: OUTPUT` for CDK to recompute hashes on shared changes

Duplicates trade DRY for **build simplicity** and **independent deploys** (touch one Lambda, only that Lambda rebundles).

**When copying:** Mirror changes to all 5 Lambdas (resolver, processor, checkin, enroll, applier). Diff sibling copies to detect drift when touching shared files.

### File Naming

Top-level: kebab-case (Python import constraint: `-` in filenames breaks `from foo-bar import x`)
- `fluxion-platform-resolver/` (directory)
- Inside packages (`resolvers/`): snake_case (Python identifiers)
  - `resolvers/device.py`, `resolvers/message_template.py`, etc.

## Handler Pattern

Every resolver module (device.py, tac.py, etc.) exports two dicts:

```python
QUERY_HANDLERS: dict = {
    "fieldName1": handler_fn1,
    "fieldName2": handler_fn2,
    ...
}

MUTATION_HANDLERS: dict = {
    "mutationName1": mutation_fn1,
    ...
}
```

These are aggregated in `resolvers/__init__.py` and merged in `handler.py:17`.

### Handler Signature

```python
def handler_name(db: Database, args: dict, identity: dict) -> dict | bool | None:
    """Resolve fieldName.
    
    Args:
        db: Live Database connection from global pool.
        args: GraphQL arguments (camelCase keys from schema).
        identity: AppSync identity context (Cognito sub+email from claims).
    
    Returns:
        GraphQL-shaped dict, bool (for soft deletes), or None.
    
    Raises:
        AppError subclasses: UNAUTHENTICATED, INVALID_*, NOT_FOUND, etc.
    """
```

- Return GraphQL-shaped dict (camelCase keys)
- Raise `AppError` subclasses for known errors
- Let unexpected exceptions bubble (handler.py catches as INTERNAL_ERROR)

## Error Handling

### Error Hierarchy

```python
from errors import (
    AppError,
    NotFound,          # 404
    Conflict,          # 409
    BadRequest,        # 400
    Forbidden,         # 403
    Unauthorized,      # 401
    InternalError,     # 500
)
```

### Error Codes

Use UPPER_SNAKE format. Codes must be stable — they appear in GraphQL responses.

**Common codes:**

| Code | Class | Use Case |
|------|-------|----------|
| `INVALID_IMEI_FORMAT` | BadRequest | IMEI not 15 digits |
| `INVALID_TAC` | BadRequest | TAC not 8 digits |
| `INVALID_STATE` | Conflict | Action not valid from device's current state |
| `INVALID_ACTION` | BadRequest | Action type unknown |
| `DEVICE_NOT_FOUND` | NotFound | Device by id or imei missing |
| `DEVICE_BUSY` | Conflict | Device already has assigned_action_id set |
| `TEMPLATE_REQUIRED` | BadRequest | Action requires templateId but none provided |
| `UNAUTHENTICATED` | Unauthorized | Cognito identity missing or invalid |
| `NOT_FOUND` | NotFound | Generic resource missing (TAC, template, etc.) |
| `INVALID_SERVICE` | BadRequest | Service type not found in config |

### Pattern: _require_user

Every mutation calls `_require_user(db, identity)`:

```python
def _require_user(db: Database, identity: dict) -> dict:
    user = get_user_from_identity(db, identity)
    if not user:
        raise BadRequest(
            "USER_NOT_FOUND",
            "Admin user not found in database",
        )
    return user
```

- Read-only lookup of the users row by Cognito sub (row provisioned by `scripts/create-admin-user.sh`)
- Returns user row
- Raises USER_NOT_FOUND if identity missing or the user has no database row

This is called once per mutation; queries do NOT require auth (admin API is behind Cognito gateway).

## Database Access Patterns

### Connection Management

Single global connection in db.py module scope:

```python
_conn: psycopg.Connection | None = None
_lock = threading.Lock()

def _get_conn() -> psycopg.Connection:
    global _conn
    if _conn is not None and not _conn.closed and not _conn.broken:
        return _conn
    with _lock:
        if _conn is None or _conn.closed or _conn.broken:
            _conn = psycopg.connect(..., row_factory=dict_row, autocommit=True)
    return _conn
```

- Lazy init on first Database() instantiation
- Thread-safe: `threading.Lock` guards reconnection
- Checks: closed, broken (stale connections)
- reconnects if needed

### SQL Patterns

**Bind all values with %(name)s:**

```python
# ✅ Good
query = "SELECT * FROM devices WHERE imei = %(imei)s AND deleted_at IS NULL"
self._fetch_one(query, {"imei": imei})

# ❌ Bad (SQL injection risk)
query = f"SELECT * FROM devices WHERE imei = '{imei}' AND deleted_at IS NULL"
```

**Type casting in SQL:**

```python
# Optional NULL check
query = """
    SELECT * FROM devices
    WHERE (%(service_type)s::text IS NULL OR service_id = %(service_id)s)
"""
```

### Transaction Pattern

```python
with db.conn.transaction():
    db.create_device(...)
    db.insert_milestone(...)
    # Auto-rolls back on exception within block
```

psycopg3 context manager: `autocommit=False` inside block, re-enables on exit.

### SELECT FOR UPDATE (Processor Uses, Not Resolver)

The resolver does **not** lock devices. The processor does:

```python
# Processor (not in this module)
with db.conn.transaction():
    device = db.lock_device_by_id(device_id)  # SELECT FOR UPDATE
    if device["assigned_action_id"] is not None:
        # Another processor beat us; no-op
        return
    db.set_device_assigned_action(device_id, action_id)
```

The resolver's busy-check (assigned_action_id IS NULL) is best-effort to fail fast; the processor serializes under the lock.

## Serialization

### Row → GraphQL Mapping

All mappers in `serializers.py`:

```python
def device(row: dict) -> dict | None:
    """Convert DB row to GraphQL Device shape."""
    if not row or row.get("id") is None:
        return None
    return {
        "id": _as_str(row["id"]),           # UUID → str
        "imei": row["imei"],
        "service": service(row["service"]),  # Nested service
        "currentState": state(row["current_state"]),
        "createdAt": _as_str(row["created_at"]),  # datetime → ISO Z
    }
```

**Rules:**
- Snake_case DB keys → camelCase GraphQL (except "id")
- UUID → str
- datetime → ISO 8601 with Z suffix (no +00:00)
- Null/None → null
- Nested objects: recursively map

### Cursor Encoding (Pagination)

Cursor = base64 of (id, createdAt):

```python
def encode_cursor(id_val: uuid.UUID | str, created_at: datetime) -> str:
    """Encode id + createdAt to base64 cursor string."""
    encoded = json.dumps([str(id_val), created_at.isoformat()])
    return base64.b64encode(encoded.encode()).decode()

def decode_cursor(cursor: str | None) -> dict | None:
    """Decode cursor string to {id, createdAt} dict."""
    if not cursor:
        return None
    decoded = base64.b64decode(cursor.decode()).decode()
    parts = json.loads(decoded)
    return {"id": parts[0], "createdAt": parts[1]}
```

### Relay Connection Envelope

```python
def connection(edges: list, total: int, has_next: bool) -> dict:
    """Wrap edges in Relay-style connection object."""
    return {
        "edges": edges,  # [{"cursor": "...", "node": {...}}]
        "pageInfo": {
            "totalCount": total,
            "hasNextPage": has_next,
        }
    }
```

## Pagination

**Default & Max Limits:**

```python
_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200

def _limit(args: dict) -> int:
    n = args.get("first") or _DEFAULT_LIMIT
    return min(int(n), _MAX_LIMIT)
```

**Pattern:**

1. Fetch `limit+1` rows (detect overflow)
2. Separate count query for total
3. Encode cursor from last fetched row's id + createdAt
4. Return connection with `hasNext = len(rows) > limit`

```python
rows = db.list_devices(..., limit=limit+1)
total = db.count_devices(...)
has_next = len(rows) > limit
rows = rows[:limit]
edges = [
    {
        "cursor": ser.encode_cursor(r["id"], r["created_at"]),
        "node": ser.device(r)
    }
    for r in rows
]
return ser.connection(edges, total, has_next)
```

## Imports & Structure

### Future Annotations

Every module starts with:

```python
from __future__ import annotations
```

Enables forward references (PEP 563) — allows type hints before class definitions. Required for cleaner type signatures in this codebase.

### Module Docstring

Explain *why*, not *what*:

```python
"""Device entity — listDevices, device, uploadImei, dispatchAction.

uploadImei is synchronous (creates Device + UPLOAD-APPLIED milestone, no SQS).
dispatchAction is validate-only: it checks the state machine + best-effort
busy-read and enqueues to the processor queue, which originates the request
(sets the single-flight lock + writes REQUESTED) under its own FOR UPDATE lock.
It returns a minimal DispatchResult{actionId, status}.
"""
```

- Describe the module's role and key design decisions
- Do NOT describe function signatures (code is self-documenting)

### Import Organization

```python
from __future__ import annotations

import json              # stdlib
import threading        # stdlib
from datetime import datetime

import boto3            # third-party
import psycopg          # third-party

from config import logger   # local
from db import Database     # local
from errors import AppError # local
```

1. Future
2. Stdlib (alphabetical)
3. Third-party (alphabetical)
4. Local (alphabetical)

## Code Style

### Line Length & Formatting

- **Line length:** 100 characters (set in root pyproject.toml for ruff)
- **String quotes:** Double quotes (`"string"`, not `'string'`)
- **Formatting tool:** ruff (from monorepo root: `npm run fmt`)
- **Linting:** ruff (from monorepo root: `npm run lint`)

Run before commit:
```bash
cd /path/to/repo/root
npm run fmt
npm run lint
```

### File Size

Target < 200 lines per file (rationale: easier context for LLMs). Exception: `db.py` at 750 LOC is the single database surface — accepted to keep all domain methods in one place.

If a resolver module grows large:
- Validate it's truly a single entity
- Consider splitting into sub-modules (`resolvers/device/` with device.py, serializers.py, etc.)

### Comments

Explain *why*, not *what*:

```python
# ✅ Good: Explains the invariant
# Processor holds the authoritative single-flight lock via FOR UPDATE.
# This best-effort check fails fast but does not race — two concurrent
# dispatches can both pass; processor serializes them, loser no-ops.
if device["assigned_action_id"] is not None:
    raise Conflict("DEVICE_BUSY", "...")

# ❌ Bad: Restates code
# Check if assigned_action_id is not None
if device["assigned_action_id"] is not None:
    raise Conflict("DEVICE_BUSY", "...")
```

**No plan references in code:** Comments must not reference plan artifacts (phase numbers, finding codes F1/F13, audit labels). Explain the invariant self-contained.

## Constants

### Action Classification

Immutable in `constants.py`:

```python
INLINE_UPLOAD = "UPLOAD"
INLINE_ENROLL = "ENROLL"

SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})
DEVICE_BOUND_ACTIONS = frozenset({
    "ACTIVATE", "LOCK", "UNLOCK", "NOTIFY_FROM_ACTIVE", ...
})

AUTO_CHAIN_AFTER_APPLIED = {"ENROLL": "ACTIVATE"}
```

These classify actions for:
- Dispatch route validation (dispatchAction rejects INLINE_UPLOAD/ENROLL)
- SQS routing (SYSTEM_ACTIONS → processor, no FCM; DEVICE_BOUND_ACTIONS → processor, FCM)
- Auto-chaining (applier re-enqueues ACTIVATE to the processor after ENROLL APPLIED)

### API Key Format

```python
API_KEY_PREFIX = "mdm_live_"
API_KEY_TOKEN_LEN = 32
```

Generated by enroll Lambda: `mdm_live_` + 32-char token. Stored as SHA256 hash in devices table.

### IMEI & TAC

```python
IMEI_LENGTH = 15
```

- IMEI must be 15 digits
- TAC (first 8 digits) is looked up in tacs table
- If TAC missing → uploadImei returns error (device not created)

## Testing

The resolver has **no unit tests**. End-to-end tests run against a deployed stack.

**Rationale:**
- Thin request dispatcher; most logic is SQL
- Each Lambda is independently deployed
- E2E tests verify actual AppSync + database behavior
- Mocking DB/SQS would test test infrastructure, not actual code

If adding tests:
- Use pytest
- Mock `Database` and `boto3` clients
- Test handler dispatch, error cases, serialization
- Verify error codes (schema contract)

## Deployment & Configuration

### Environment Variables

See system-architecture.md Configuration section.

Required for AWS:
- `DB_SECRET_ARN` + `DB_ENDPOINT` (or `DATABASE_URL`)
- `PROCESSOR_QUEUE_URL`, `CHECKIN_QUEUE_URL`
- `AWS_REGION`

Optional:
- `LOG_LEVEL` (default: INFO)
- `DPC_SHARED_KEY_SECRET_ARN`, `FIREBASE_SECRET_ARN` (not used by resolver)

### Database Migrations

Migrations live in the monorepo root (`infra/migrations/` or similar, Alembic). Resolver assumes:
- `services`, `states`, `actions` tables are seeded
- Schema matches `db.py` expectations (devices.assigned_action_id, states.deleted_at, etc.)

Do not modify schema directly in resolver code.

### Lambda Configuration

- **Runtime:** Python 3.12
- **Handler:** `handler.lambda_handler`
- **Memory:** 256–512 MB (thin wrapper)
- **Timeout:** >= 30s (pagination count queries can be slow)
- **Concurrency:** No reserved concurrency (bursty AppSync traffic OK)

## Debugging

### Logging

Root logger configured in `config.py` on import:

```python
from config import logger

logger.info("resolver.invoke type=%s field=%s", parent_type, field)
logger.warning("resolver.app_error code=%s msg=%s", ae.code, ae.message)
logger.exception("resolver.unhandled field=%s", field)
```

**Format:** `logger.level("component.event key=val key=val")`

- Avoid f-strings (harder to parse in log aggregation)
- Use structured logging (key=val pairs)
- Log level: INFO for normal flow, WARNING for app errors, exception for unhandled

### CloudWatch Insights Query

```
fields @timestamp, @message, @duration
| filter @message like /resolver\./
| stats count() by code
```

## Dependencies

See requirements.txt:

```
psycopg[binary]>=3.2,<4
boto3>=1.34,<2
```

- **psycopg:** PostgreSQL driver (async-capable, but we use sync here)
- **boto3:** AWS SDK (secretsmanager, sqs clients)

No heavy dependencies (numpy, pandas, etc.). Keep dependencies minimal for faster Lambda startup.

## Pre-Commit Checklist

Before pushing:

1. **No syntax errors:** `python -m py_compile *.py resolvers/*.py`
2. **Linting:** `npm run lint` from monorepo root
3. **Formatting:** `npm run fmt` from monorepo root
4. **No secrets in code:** grep for "secret", "key", "password"
5. **All error codes stable:** Check that AppError subclasses use UPPER_SNAKE codes
6. **Docstrings:** Every module and handler has a docstring explaining *why*
