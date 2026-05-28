# Fluxion Enroll — Code Standards & Conventions

## Python Style

**Language & Tooling:**
- Python 3.12 (PEP 701 match expressions, positional-only params)
- Ruff (all-in-one linter + formatter from Python ecosystem)
- `ruff check --fix` for auto-fixes, `ruff format` for style

**Ruff Configuration (from monorepo pyproject.toml):**
```toml
[tool.ruff]
target-version = "py312"
line-length = 100
[tool.ruff.lint]
extend-select = ["E", "F", "I", "UP", "B"]  # Errors, Pyflakes, isort, pyupgrade, bugbear
extend-ignore = ["E501", "B008"]            # Ignore long lines (auto-wrapped), mutable defaults
[tool.ruff.format]
quote-style = "double"
```

**Apply from repo root:**
```bash
npm run lint           # ruff check
npm run lint:fix       # ruff check --fix
npm run fmt            # ruff format
npm run fmt:check      # dry-run format check
```

## File Organization

**Naming:**
- Directories: kebab-case (`routes/`, `models/`)
- Top-level Python files: snake_case (handler.py, app.py, config.py)
- Classes: PascalCase (AppError, Database, BadRequest)
- Functions: snake_case (handle_enroll, generate_device_api_key)
- Constants: UPPER_SNAKE (CHECKIN_INTERVAL_IDLE, API_KEY_PREFIX)
- Private functions/vars: leading underscore (_validate_imei, _conn)

**Module Headers:**
Every Python file starts with a docstring explaining its purpose:
```python
"""Database — thin psycopg wrapper with the methods the checkin Lambda needs.

Connection is single global, cached at module scope, dict_row + autocommit=True.
Multi-statement writes use `with db.conn.transaction():` (psycopg native context).
All values bound via %(name)s — never f-string-interpolated into SQL.
"""

from __future__ import annotations  # PEP 563 deferred annotations
```

## Imports & Dependencies

**Order (per isort/Ruff):**
1. `from __future__ import annotations` (always first)
2. Standard library (os, sys, json, datetime, threading, hashlib, secrets, uuid, logging)
3. Third-party (fastapi, pydantic, psycopg, boto3)
4. Local imports (config, db, errors, constants)

**Side Effects:**
- `config` imported first in handler.py to trigger root logger setup
- Lazy AWS clients via `config.secretsmanager()`, `config.sqs()` (not globals)

**Type Hints:**
- PEP 604 syntax: `dict | None` instead of `Optional[dict]`
- `from __future__ import annotations` enables string-forward-references (PEP 563)
- Generic types: `dict[str, Any]`, `list[dict]`, `tuple[str, str]`

## Database & SQL

**Connection Management:**
- Single global `_conn` (module scope in db.py), thread-lock guarded reconnect
- `autocommit=True` (explicit `with db.conn.transaction():` for writes)
- `dict_row` factory (rows returned as dicts, not tuples)

**Parameter Binding:**
- **ALWAYS** use named binding: `%(column_name)s`
- **NEVER** use f-string interpolation in SQL
- **NEVER** use positional `%s` binding

**Safe Pattern:**
```python
query = """
    UPDATE devices
    SET api_key_hash = %(hash)s, fcm_token = %(token)s
    WHERE id = %(id)s
"""
db._execute(query, {"hash": key_hash, "token": fcm_token, "id": device_id})
```

**Unsafe (FORBIDDEN):**
```python
# BAD: SQL injection risk
query = f"UPDATE devices SET api_key_hash = '{key_hash}' WHERE id = {device_id}"
```

**Column Whitelisting (for dynamic UPDATEs):**
```python
def update_device_fields(self, device_id, **fields):
    allowed = {"api_key_hash", "fcm_token", "info", "first_checkin_at", ...}
    cols = [k for k in fields.keys() if k in allowed]  # Whitelist check
    # ... build UPDATE query from cols only
```

**Transactions:**
```python
with db.conn.transaction():
    device = db.lock_device_by_imei(imei)  # FOR UPDATE
    if not device:
        raise NotFound(...)
    db.update_device_fields(device["id"], **fields)  # Atomic with lock
# After exiting context: commit happens, then enqueue (outside transaction)
enqueue_action(...)
```

## Error Handling

**Typed Errors:**
All errors are AppError subclasses with (code, http_status, message):

```python
class AppError(Exception):
    def __init__(self, code: str, http_status: int, message: str):
        self.code = code
        self.http_status = http_status
        self.message = message

    def to_dict(self) -> dict:
        return {
            "error_code": self.code,
            "message": self.message,
            "retry_strategy": {
                "retryable": self.http_status >= 500,
                "backoff_seconds": 5 if self.http_status >= 500 else None,
                "max_attempts": 5 if self.http_status >= 500 else None,
            },
        }
```

**Usage:**
```python
raise BadRequest("INVALID_IMEI_FORMAT", f"IMEI must be {IMEI_LENGTH} digits")
raise NotFound("DEVICE_NOT_FOUND", f"IMEI {imei} not registered")
raise Conflict("INVALID_STATE", "Device must be REGISTERED to enroll")
```

**Handler Exception Mapping (in app.py):**
```python
@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError):
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())
```

**HTTP Status Codes Used by Enroll:**
- `200 OK` — successful enrollment
- `400 Bad Request` — INVALID_IMEI_FORMAT, MISSING_FIELD
- `404 Not Found` — DEVICE_NOT_FOUND
- `409 Conflict` — INVALID_STATE (not REGISTERED)
- `500 Internal Server Error` — database, SQS, or AWS failures (retryable)

## Constants & Configuration

**constants.py — Immutable Values Only:**
- No environment variables
- No I/O or function calls
- No AWS clients
- Examples: action types, queue labels, intervals, key formats

```python
SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})
DEVICE_BOUND_ACTIONS = frozenset({"ACTIVATE", "LOCK", ...})
TARGET_PROCESSOR = "processor"
CHECKIN_INTERVAL_IDLE = 3600
API_KEY_PREFIX = "mdm_live_"
IMEI_LENGTH = 15
```

**config.py — Environment & AWS Clients:**
- Reads all env vars at module load time (no lazy env reads)
- Lazy AWS clients with thread-lock guard
- Root logger setup as side effect

```python
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.getLogger().setLevel(LOG_LEVEL)

PROCESSOR_QUEUE_URL = os.environ.get("PROCESSOR_QUEUE_URL", "")

_lock = threading.Lock()
def _client(service: str):
    if service not in _clients:
        with _lock:
            if service not in _clients:
                _clients[service] = boto3.client(service, region_name=AWS_REGION)
    return _clients[service]
```

## Comments & Documentation

**When to Comment:**
- Why a decision was made (not what the code does)
- Edge cases or race conditions
- Non-obvious algorithm choices
- SQL lock ordering or transaction boundaries

**When NOT to Comment:**
- Obvious intent (code should be self-documenting)
- Plan/phase/finding references (stale; use code comments for stable reasons)

**Example (Good):**
```python
# After commit: enqueue ENROLL with no pre-set lock. The processor
# originates it (sets assigned_action_id + writes REQUESTED) under FOR UPDATE,
# then routes to the checkin consumer for the server-side APPLIED.
enqueue_action(TARGET_PROCESSOR, device_id, enroll_action_id, ...)
```

**Example (Bad):**
```python
# Per phase-05-enroll-pipeline, route to processor
enqueue_action(...)  # NOW INVALID if phase renamed/deleted
```

## Async Patterns

**FastAPI Handlers:**
All route handlers are `async def`:
```python
@app.post("/v1/enroll")
async def enroll(request: Request):
    body = await request.json()
    return handle_enroll(body)
```

**Database Operations:**
Currently synchronous (psycopg, blocking). Async database calls deferred (psycopg_async branch not adopted).

## Testing

**No Unit Tests:** Module relies on an end-to-end lifecycle test. If adding tests:
- Use pytest (industry standard for Python)
- Place in `tests/` subdir at module root
- Name as `test_*.py` (pytest discovery)
- Fixtures in `conftest.py`

## Code Review Checklist

Before committing:
- [ ] `npm run lint` passes (ruff check, no errors)
- [ ] `npm run fmt:check` shows no formatting changes needed
- [ ] All error cases raise typed AppError subclasses
- [ ] No f-string SQL (all %(name)s binding)
- [ ] No plaintext passwords/secrets in code
- [ ] Transaction boundaries clear (FOR UPDATE + commit before SQS)
- [ ] Module docstring present + up-to-date
- [ ] Type hints on function signatures
- [ ] No commented-out code
- [ ] Comments explain why, not what

## Version History

- **v0.1** (2026-06-07): Initial release, single POST /v1/enroll endpoint, no re-enroll support.

## Related Documentation

- `project-overview-pdr.md` — Functional requirements and scope
- `codebase-summary.md` — Per-file breakdown and dependency graph
- `system-architecture.md` — Request flow and SQS pipeline context
- `../README.md` — API reference and deployment instructions
