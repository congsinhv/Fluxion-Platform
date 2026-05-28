# Code Standards — Processor Lambda

Conventions, linting rules, and architectural patterns used in this module.

## File structure

**Directory naming:** kebab-case  
**Python files:** snake_case  
**Root imports:** `sys.path.insert(0, os.path.dirname(__file__))` in handler.py to load sibling modules

**File organization:**
```
fluxion-platform-processor/
├── README.md              # Module entry point
├── handler.py             # SQS consumer + transaction logic
├── db.py                  # Database wrapper
├── fcm_dispatcher.py      # Firebase dispatch
├── config.py              # Env vars + clients
├── constants.py           # Immutable values
├── errors.py              # Typed errors
├── sqs_client.py          # SQS enqueue
├── requirements.txt       # Python deps
├── CLAUDE.md              # AI instructions (do not edit)
└── docs/
    ├── README.md (in root, not here)
    ├── project-overview-pdr.md
    ├── code-standards.md
    ├── codebase-summary.md
    ├── system-architecture.md
    ├── deployment-guide.md
    └── project-roadmap.md
```

## Linting & formatting

**Tool:** ruff (from monorepo root)

**Config:**
- Line length: 100
- Python: 3.12+
- Rules enabled: E, F, I, UP, B
- Ignored: E501 (line length overridden), B008 (mutable default args)

**Commands:**
```bash
# From monorepo root
npm run lint       # ruff check
npm run fmt        # ruff format --fix
```

**Before commit:**
```bash
npm run lint
# Fix any errors
npm run fmt
```

## Naming conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Python files | snake_case | handler.py, fcm_dispatcher.py |
| Functions | snake_case | lambda_handler, _process_one, _init |
| Classes | PascalCase | Database, AppError |
| Constants | UPPER_SNAKE_CASE | SYSTEM_ACTIONS, TARGET_PROCESSOR |
| Private functions | _snake_case | _build_url, _get_conn |
| Private module vars | _snake_case | _conn, _lock, _messaging |

## Import conventions

**Always explicit:**
```python
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import config
from config import logger
from constants import SYSTEM_ACTIONS
from db import Database
```

**Never use wildcard imports:**
```python
# Bad
from constants import *

# Good
from constants import SYSTEM_ACTIONS, DEVICE_BOUND_ACTIONS
```

**Module-level side effects allowed (config.py only):**
- Root logger initialization happens on import
- All other modules use `from config import logger`

## Type hints

**Required in:**
- Function signatures (parameters + return)
- Module-scope variables
- Class methods

**Style:**
```python
def _build_url() -> str:
    ...

def enqueue_action(
    target_service: str,
    device_id: str | uuid.UUID,
    *,
    command_id: str | None = None,
) -> str:
    ...

_conn: psycopg.Connection | None = None
_initialized: bool = False
```

**Avoid over-annotation:**
- Loop variables: only if non-obvious
- Inline literals: omit type (obviously a str, list, etc.)

## Docstrings

**Module docstrings** (required, after `"""` on line 1):
```python
"""Database — thin psycopg wrapper with the methods the processor needs.

Connection is single global, cached at module scope, dict_row + autocommit=True.
Multi-statement writes use `with db.conn.transaction():` (psycopg native context).
All values bound via %(name)s — never f-string-interpolated into SQL.
"""
```

**Function docstrings** (required for public functions; optional for private):
```python
def dispatch(fcm_token: str | None, payload: dict) -> dict:
    """Send a data-only wake-up to a device. Returns {ok, message_id, mocked, reason?}.

    Never raises — FCM failure must not block milestone bookkeeping. The next
    /v1/checkin tick acts as a fallback wake.
    """
```

**Style:**
- One-line summary (fits on one line)
- Blank line
- Multi-line explanation of why/invariants (not what-it-does)
- Do NOT reference plan phases, finding codes, or audit labels (see "Code comments" below)

## Code comments

**What to comment:**
- Race conditions and why they're safe
- Non-obvious single-flight logic
- SQL bound parameters (why %(name)s)
- Side effect ordering guarantees
- Fallback strategies and permanent vs. transient failures

**What NOT to comment:**
- Obvious code (`x = y` doesn't need explanation)
- Plan/audit references (phase numbers, finding codes, etc.)
- Origin story (where requirement came from)

**Examples:**

Good:
```python
# A different action already holds the single-flight lock — drop this message
# (device busy). The winner originated first under FOR UPDATE.
if assigned is not None and str(assigned) != str(action_id):
    logger.warning("processor.busy device=%s", device_id)
    return
```

Good:
```python
# All values bound via %(name)s — never f-string-interpolated into SQL.
cur.execute(query, params or {})
```

Bad:
```python
# Per phase 2a (F5: origination), check assigned_action_id
if assigned is None:
```

Bad:
```python
# TODO: update per audit finding Y14
# This might need hardening
```

## SQL patterns

**All parameters bound via `%(name)s`:**

```python
# Good
query = """
    SELECT id, assigned_action_id FROM devices
    WHERE id = %(id)s AND deleted_at IS NULL
    FOR UPDATE
"""
self._fetch_one(query, {"id": str(device_id)})

# Bad (NEVER do this)
query = f"SELECT * FROM devices WHERE id = '{device_id}' FOR UPDATE"
```

**Transactions via context manager:**

```python
# Good
with db.conn.transaction():
    db.set_device_assigned_action(device_id, action_id)
    db.insert_milestone(...)
    # Both writes committed atomically

# Side effects OUTSIDE transaction
fcm_dispatch(fcm_token, payload)
```

**FOR UPDATE pattern:**

```python
# Good — idempotency boundary
def lock_device_by_id(self, device_id: str | uuid.UUID) -> dict | None:
    query = """
        SELECT ... FROM devices
        WHERE id = %(id)s AND deleted_at IS NULL
        FOR UPDATE
    """
    return self._fetch_one(query, {"id": str(device_id)})
```

## Logging

**Logger:** Import from config: `from config import logger`

**Style:** `logger.method(msg_template, *args)` with structured keys  
**Format:** `<module>.<event> key=value key=value`

**Examples:**

```python
logger.info("processor.routed system device=%s action=%s -> checkin", device_id, action_type)
logger.warning("processor.busy device=%s sqs_action=%s db_assigned=%s", device_id, action_id, assigned)
logger.exception("processor.failure msg=%s body=%s", msg_id, body)
```

**Log levels:**
- `INFO` — Normal flow (routing decisions, successful dispatches)
- `WARNING` — Expected edge cases (device missing, device busy, device without FCM token)
- `ERROR` — Unexpected but recoverable (action not found, template not found)
- `EXCEPTION` — Unhandled errors in try-catch blocks

## Error handling

**Pattern:** Catch at handler level, log + append to batchItemFailures; never raise to SQS.

```python
def lambda_handler(event: dict, _context) -> dict:
    failures: list[dict] = []
    for rec in records:
        try:
            _process_one(body)
        except Exception:
            logger.exception("processor.failure msg=%s body=%s", msg_id, body)
            failures.append({"itemIdentifier": msg_id})
    return {"batchItemFailures": failures}
```

**Inside transactions:** Let exceptions propagate; psycopg rolls back automatically.

**FCM failures:** Never raise; always return dict.

```python
def dispatch(fcm_token: str | None, payload: dict) -> dict:
    try:
        message_id = _messaging.send(msg)
        return {"ok": True, "mocked": False, "message_id": message_id}
    except Exception as e:
        logger.warning("fcm.send_failed token=%s err=%s", fcm_token[:12], e)
        return {"ok": False, "mocked": False, "reason": str(e)}
```

## Concurrency model

**Per-device serialization:** PostgreSQL FOR UPDATE row lock.  
**No explicit threading:** Lambda is synchronous; concurrency handled by database.

**Double-checked locking** (for lazy singletons):

```python
_lock = threading.Lock()
_conn: psycopg.Connection | None = None

def _get_conn() -> psycopg.Connection:
    global _conn
    if _conn is not None and not _conn.closed and not _conn.broken:
        return _conn
    with _lock:
        if _conn is None or _conn.closed or _conn.broken:
            _conn = psycopg.connect(...)
    return _conn
```

## Shared files (critical)

**These 5 files are INTENTIONALLY DUPLICATED across all 5 Lambdas:**
- config.py
- constants.py
- db.py
- errors.py
- sqs_client.py

**Why:** CDK bundles each Lambda as a self-contained asset (no shared Python package).

**Sync rule:** If you edit one, you MUST sync to sibling Lambdas:
- `../fluxion-platform-resolver/`
- `../fluxion-platform-checkin/`
- `../fluxion-platform-enroll/`
- `../fluxion-platform-applier/`

**How to detect:** Use grep across all 5 directories:
```bash
grep -r "def lock_device_by_id" ../*/db.py
```

**Before merge:** Ensure all 5 versions are identical in spirit (may have module-specific DB queries).

## Testing

**Unit tests:** None (pure event handler, tested via E2E).

**E2E tests:** an end-to-end lifecycle test (in monorepo)
```bash
# Deploy stack first
cd infra && npx cdk deploy --profile fluxion-dev

# Then run lifecycle test
npm run test:processor
```

**Local validation:**
```bash
# Lint + format
npm run lint
npm run fmt

# Check for compile errors
python -m py_compile handler.py db.py fcm_dispatcher.py config.py constants.py errors.py sqs_client.py
```

## Dependencies

**Python:** 3.12+

**Packages:**
```
psycopg[binary]>=3.2,<4   # PostgreSQL async driver
firebase-admin>=6.5,<7    # Firebase Admin SDK
boto3>=1.34,<2            # AWS SDK
```

**Constraints:**
- No external HTTP clients; use boto3 + firebase_admin only
- No async/await; Lambda is synchronous
- No database migrations (alembic runs from monorepo root)

## Anti-patterns (do NOT)

| Bad | Why | Good |
|-----|-----|------|
| `f"... WHERE id = '{device_id}' ..."` | SQL injection | Bind via %(name)s |
| Modify assigned_action_id outside tx | Races | Use `with db.conn.transaction():` |
| Raise from fcm_dispatch | Blocks milestone audit | Return dict, log, continue |
| Import * | Unclear scope | Explicit imports |
| Global mutable state (except singletons) | Race conditions | Use double-checked lock |
| Commit inside _process_one | Manual commit risk | Let context manager handle |
| FCM init in handler | Repeated init | Lazy module-scope singleton |

## Deployment checklist

Before `cdk deploy`:
1. All files pass `npm run lint` (monorepo root)
2. All shared files (db.py, config.py, etc.) synced to sibling Lambdas
3. No hardcoded secrets or credentials in code
4. Log statements use structured key=value format
5. All SQL uses %(name)s binding
6. No F-strings in SQL
7. Side effects only after tx commits

