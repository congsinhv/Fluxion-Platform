# Code Standards

## Style & Formatting

**Language:** Python 3.12  
**Formatter:** `ruff format` (from repo root: `npm run fmt`)  
**Linter:** `ruff check` (rules: E/F/I/UP/B, E501 ignored)  
**Line Length:** 100 characters  
**Import Order:** Standard library → third-party → local (enforced by ruff I rules)

```bash
npm run fmt           # Format all Python
npm run fmt:check     # Check formatting
npm run lint          # Lint check
npm run lint:fix      # Auto-fix linting issues
```

## Naming Conventions

| Entity | Pattern | Example |
|--------|---------|---------|
| Module (file) | kebab-case + .py | `sqs_client.py`, `checkin_route.py` |
| Function | snake_case | `validate_device_bearer()` |
| Class | PascalCase | `Database`, `AppError` |
| Constant | SCREAMING_SNAKE_CASE | `CHECKIN_INTERVAL_IDLE`, `API_KEY_PREFIX` |
| Private function | `_snake_case` | `_validate_ack()`, `_pull_pending_command()` |
| Directory | kebab-case | `routes/` |
| Error code | SCREAMING_SNAKE_CASE | `INVALID_CREDENTIALS`, `DEVICE_RELEASED` |
| API key | `mdm_live_<token>` | Bearer token prefix, 32 chars post-prefix |

## Type Hints

All functions must have type hints:

```python
def validate_device_bearer(db: Database, auth_header: str | None, imei_header: str | None) -> dict:
    ...

def find_requested_by_command_id(self, device_id: str | uuid.UUID, command_id: str) -> dict | None:
    ...
```

Use `from __future__ import annotations` for forward references (Python 3.10+ syntax).

## Database Access

### Connection Management
- Single module-global connection, cached at module scope
- Reuse across invocations within Lambda lifetime
- All methods use `dict_row` for dict-like cursor results
- `autocommit=True` — explicit transactions via `with db.conn.transaction():`

### Parameterized Queries
**Required:** All values must be bound via `%(name)s` placeholders. **Never** interpolate.

```python
# ✅ Good
query = "SELECT * FROM devices WHERE api_key_hash = %(h)s"
db._fetch_one(query, {"h": key_hash})

# ❌ Bad — SQL injection risk
query = f"SELECT * FROM devices WHERE api_key_hash = '{key_hash}'"
```

### Multi-Statement Writes
Wrap in transaction context to ensure atomicity:

```python
with db.conn.transaction():
    device = db.lock_device_by_id(device_id)
    db.update_device_fields(device_id, **fields)
    db.insert_milestone(...)
```

### Column Whitelist
`update_device_fields()` enforces a whitelist of allowed columns to prevent accidental writes:

```python
allowed = {
    "current_state_id",
    "assigned_action_id",
    "api_key_hash",
    "fcm_token",
    "info",
    "first_checkin_at",
    "last_checkin_at",
}
```

Add to whitelist if new columns are needed.

### JSON Handling
JSONB columns (e.g., `info`, `payload`) are automatically serialized/deserialized:

```python
# Device info stored as JSON
db.update_device_fields(device_id, info=device_info)

# Payload written as JSONB (auto-stringified in insert_milestone)
db.insert_milestone(..., payload={"command_id": "...", "status": "SUCCESS"})
```

## Error Handling

### AppError Hierarchy
All endpoint errors raise typed `AppError` subclasses:

```python
from errors import BadRequest, Forbidden, Unauthorized, InternalError

raise Unauthorized("MISSING_API_KEY", "Missing Authorization header")
raise Forbidden("INVALID_CREDENTIALS", "api_key not recognized")
raise BadRequest("UNKNOWN_COMMAND_ID", f"No REQUESTED milestone for command {cmd_id}")
```

### Error Response Format
FastAPI exception handler maps to JSON:

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

Retryable (≥500) errors include backoff guidance (5s, max 5 attempts).

### Logging on Error
Optionally log before raising:

```python
logger.warning("auth.invalid_key device=%s", device_id)
raise Forbidden("INVALID_CREDENTIALS", "...")
```

## Transaction Boundaries

### Rule: Side Effects After Commit
SQS enqueue happens *after* the DB transaction commits. This ensures the device record and milestone are durable before the applier reads them:

```python
with db.conn.transaction():
    # All DB writes here
    device = validate_device_bearer(db, auth_header, imei_header)
    db.update_device_fields(device_id, ...)
    # DO NOT enqueue inside transaction

if ack is not None:
    # Safe: transaction committed above
    enqueue_action(TARGET_CHECKIN, device_id, action_id, ...)
```

## Timestamps

All timestamps are ISO-8601 UTC with `Z` suffix:

```python
from datetime import UTC, datetime

now = datetime.now(UTC)
iso_str = now.isoformat().replace("+00:00", "Z")
# → "2026-06-07T10:30:00Z"
```

Database stores TIMESTAMP (not TIMESTAMPTZ) for predictable serialization.

## Logging

### Setup (config.py)
Root logger configured at module import:

```python
import logging
import os

_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logger = logging.getLogger("fluxion")
logger.setLevel(_LEVEL)
```

### Usage
All modules should use:

```python
from config import logger

logger.info("checkin.ack.idempotent device=%s cmd=%s", device_id, cmd_id)
logger.warning("auth.invalid_key token=%s", token[:8])  # truncate secrets
logger.error("db.connection_failed", exc_info=True)
```

### Sensitive Data
Never log full api_keys, passwords, or tokens. Truncate or redact:

```python
# ✅ Good
logger.warning("invalid_key token=%s", token[:8])

# ❌ Bad
logger.warning(f"invalid_key token={token}")
```

## Testing

**No unit tests.** All code validation via E2E an end-to-end lifecycle test against deployed stack.

## Docstrings

Module-level docstrings and function docstrings are required for public APIs:

```python
"""POST /v1/checkin — device gateway.

Two independent request shapes, branched on the presence of `command_result`:
- ACK (command_result present): validate and enqueue
- PULL (command_result absent): return pending command
"""

def handle_checkin(body: dict, auth_header: str | None, imei_header: str | None) -> dict:
    """Handle device checkin (PULL or ACK). Returns response dict."""
    ...
```

Private functions can use single-line docstrings or inline comments if complex.

## Comments

Write comments for *why*, not *what*:

```python
# ✅ Good — explains intent
# REQUESTED-scoped idempotency: device-bound actions (LOCK/UNLOCK) repeat
# across lifecycle, so only an ack created *after* this REQUESTED counts.
already = db.find_ack_milestone_after(...)

# ❌ Bad — restates obvious code
# Find the ack milestone after
already = db.find_ack_milestone_after(...)
```

## AWS SDK Usage

### Lazy + Thread-Safe Clients
Boto3 clients are lazily created and cached in `config.py`:

```python
def _client(service: str):
    if service not in _clients:
        with _lock:
            if service not in _clients:
                _clients[service] = boto3.client(service, region_name=AWS_REGION)
    return _clients[service]

def sqs():
    return _client("sqs")
```

Use via `config.sqs()`, `config.secretsmanager()`.

### Secrets Manager
Cached per-invocation (not process-global to allow rotation):

```python
def get_dpc_shared_key() -> str:
    global _dpc_shared_key_cache
    if _dpc_shared_key_cache:
        return _dpc_shared_key_cache
    raw = config.secretsmanager().get_secret_value(SecretId=config.DPC_SHARED_KEY_SECRET_ARN)["SecretString"]
    _dpc_shared_key_cache = raw
    return _dpc_shared_key_cache
```

## SQS Message Format

All enqueue messages follow a fixed schema (see `sqs_client.py`):

```python
body = {
    "target_service": "checkin",  # or "processor"
    "device_id": str(device_id),
    "action_id": str(action_id),
    "command_id": command_id,  # null if not applicable
    "template_id": str(template_id) if template_id else None,
    "requested_by_id": str(requested_by_id) if requested_by_id else None,
    "extras": extras or {},  # for result, options, etc.
}
config.sqs().send_message(QueueUrl=queue_url, MessageBody=json.dumps(body))
```

## Module Organization

```
fluxion-platform-checkin/
├── handler.py              # Lambda entry, imports app
├── app.py                  # FastAPI app + exception handler
├── routes/
│   ├── __init__.py
│   └── checkin_route.py   # PULL/ACK branching
├── auth.py                # Bearer token validation
├── db.py                  # Database layer
├── config.py              # Env vars + logger setup
├── constants.py           # Immutable values
├── errors.py              # AppError subclasses
├── sqs_client.py          # SQS enqueue helper
├── requirements.txt       # Python dependencies
├── README.md              # Quick start
└── docs/
    ├── project-overview-pdr.md
    ├── codebase-summary.md
    ├── code-standards.md
    ├── system-architecture.md
    └── project-roadmap.md
```

All top-level .py files are utilities or entry points; business logic lives in `routes/`.

## Dependency Versions

Keep pinned in `requirements.txt` with upper bounds:

```
fastapi>=0.115,<0.120
mangum>=0.19,<0.20
pydantic>=2.8,<3
psycopg[binary]>=3.2,<4
boto3>=1.34,<2
```

When upgrading, test against E2E lifecycle test.
