# Code Standards — Applier Module

## Language & Environment

- **Language:** Python 3.12
- **Framework:** AWS Lambda (SQS consumer)
- **Code Format:** Ruff (line-length 100, Python 3.12 target)
- **Linting:** Ruff check
- **Type Hints:** Strongly encouraged (used throughout)

---

## File Organization

### Directory Structure

```
fluxion-platform-applier/
├── README.md              # Module readme (what, why, how)
├── CLAUDE.md              # AI guidance (commands, invariants)
├── handler.py             # Lambda entry
├── sqs_consumer.py        # Core logic
├── db.py                  # Database wrapper
├── config.py              # Env vars, logger, boto3 clients
├── constants.py           # Immutable constants
├── sqs_client.py          # SQS helper
├── errors.py              # Typed errors
├── requirements.txt       # Dependencies
└── docs/                  # Documentation
    ├── project-overview-pdr.md
    ├── codebase-summary.md
    ├── code-standards.md
    ├── system-architecture.md
    └── project-roadmap.md
```

### File Naming

- **Module files:** snake_case (import constraint: Python packages use snake_case)
- **Module directory:** kebab-case (convention across monorepo)
- **Documentation:** kebab-case with descriptive purpose

---

## Module Separation & Responsibilities

| File | Responsibility | Import Pattern |
|------|-----------------|-----------------|
| `handler.py` | Lambda entry; record dispatch | Entry point; no external imports except config, sqs_consumer |
| `sqs_consumer.py` | Core logic; state transitions | Imports config, constants, db, sqs_client |
| `db.py` | Database access; transactions | Imports config, psycopg |
| `config.py` | Env vars, logger, boto3 clients | Imports logging, os, boto3 (no internal deps) |
| `constants.py` | Immutable constants | No imports (no env, no I/O) |
| `sqs_client.py` | SQS enqueue helper | Imports config, constants |
| `errors.py` | Typed errors | No imports (no env, no I/O) |

**Circular dependency note:** None exist (DAG structure maintained).

---

## Coding Conventions

### Imports

- **Order:** Standard library → third-party → local (separated by blank lines)
- **Aliasing:** Avoid; use full names for clarity
- **Side effects:** Only in `config.py` (logger setup); mention in module docstring
- **Conditional:** None in production code (env guards handled in config.py)

```python
from __future__ import annotations

import json
import threading
import uuid

import boto3
import psycopg
from psycopg.rows import dict_row

import config
from constants import AUTO_CHAIN_AFTER_APPLIED
```

### Type Hints

**Required for:**
- Function parameters (especially public APIs)
- Function return types
- Class attributes (if not obvious)

**Convention:**
- Use `str | None` (Python 3.10+ union syntax)
- Use `dict | None` for database rows (prefer dict over Row for clarity)
- Use `list[dict]` for collections
- Use `uuid.UUID` for database IDs, but also accept `str` (conversion happens in db.py)

```python
def find_requested_by_command_id(
    self, device_id: str | uuid.UUID, command_id: str
) -> dict | None:
    ...

def enqueue_action(
    target_service: str,
    device_id: str | uuid.UUID,
    action_id: str | uuid.UUID,
    *,
    command_id: str | None = None,
) -> str:
    ...
```

### SQL & Database Access

**SQL binding — CRITICAL:**
- Always use `%(name)s` parameter binding; **never** f-string or `.format()`
- All values bound as parameters, even literals (for consistency & safety)

```python
# ✅ GOOD
query = """
    SELECT id, type, name
    FROM states
    WHERE type = %(type)s AND deleted_at IS NULL
"""
return self._fetch_one(query, {"type": type_})

# ❌ BAD — NEVER DO THIS
query = f"SELECT id FROM devices WHERE id = {device_id}"
```

**Transaction management:**
- Use `with db.conn.transaction():` for multi-statement writes
- Lock device first: `db.lock_device_by_id()` (SELECT FOR UPDATE)
- All reads/writes within same transaction
- Side effects (SQS enqueue) AFTER commit

```python
with db.conn.transaction():
    device = db.lock_device_by_id(device_id)
    db.insert_milestone(...)
    db.update_device_fields(...)
    # implicit commit on exit
# side effects now:
if auto_chain:
    enqueue_action(...)
```

**Soft deletes:**
- All queries: `WHERE ... AND deleted_at IS NULL`
- Never use `DELETE` (no hard deletes implemented)

**UUID handling:**
- Store/pass as `str(uuid)` when binding to SQL
- Accept both `str | uuid.UUID` in function signatures; convert to string for SQL
- Database returns as string from `dict_row` cursor factory

```python
return self._fetch_one(
    query,
    {"id": str(device_id)},  # convert to string
)
```

### Logging

**Format:**
- Style: `checkin_sqs.<event> key=value key2=value2`
- Prefix historical: `checkin_sqs` (this consumer split from checkin Lambda; kept for log continuity)
- Keys: snake_case; values: quoted if strings with spaces
- Exceptions: Use `logger.exception()` for auto-traceback

```python
logger.info("checkin_sqs.applied device=%s action=%s -> state=%s", device_id, action_type, state_id)
logger.warning("checkin_sqs.lock_mismatch device=%s sqs=%s db=%s", device_id, sqs_action, db_action)
logger.exception("checkin_sqs.failure msg=%s body=%s", msg_id, body)
```

**Log levels:**
- `DEBUG` — Entry/exit of key functions (not used in production Lambda)
- `INFO` — Normal state transitions (applied, failed, auto-chain)
- `WARNING` — Unexpected but recoverable (lock_mismatch, stale_cycle, missing_action)
- `ERROR` — (not used; exceptions logged as WARNING + exception)
- `EXCEPTION` — Uncaught exceptions with traceback

### Error Handling

**In sqs_consumer:**
- Catch all exceptions in `_process_one()` (top-level try/except in `handle_records`)
- Log with context; batch-fail for redelivery
- Do NOT re-raise (SQS will requeue + eventually DLQ)

```python
try:
    _process_one(body)
except Exception:
    logger.exception("checkin_sqs.failure msg=%s body=%s", msg_id, body)
    failures.append({"itemIdentifier": msg_id})
```

**In db.py:**
- Let psycopg exceptions propagate (caller handles)
- No try/catch around SQL execution

**No custom retry logic** — SQS handles redelivery and eventual DLQ.

### Constants & Configuration

**constants.py:**
- Immutable, no I/O, no env lookups
- UPPERCASE names (frozenset, dicts, strings)
- Comments explain classifications

```python
SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})
AUTO_CHAIN_AFTER_APPLIED = {"ENROLL": "ACTIVATE"}
```

**config.py:**
- Env var defaults; empty string if unset (consumers check truthiness)
- Lazy boto3 clients with thread-lock guard
- Logger setup on import (side effect, mention in docstring)

```python
DATABASE_URL = os.environ.get("DATABASE_URL", "")
PROCESSOR_QUEUE_URL = os.environ.get("PROCESSOR_QUEUE_URL", "")

def _client(service: str):
    if service not in _clients:
        with _lock:
            if service not in _clients:
                _clients[service] = boto3.client(service, region_name=AWS_REGION)
    return _clients[service]
```

### Comments & Docstrings

**Module docstrings:** One-liner purpose; mention no HTTP if SQS-only; reference related Lambdas if needed.

```python
"""SQS consumer for target_service=checkin — the single transition writer."""
```

**Function docstrings:** High-level behavior; parameters implicit from type hints; side effects if any.

```python
def _apply_device_ack(
    db: Database,
    device: dict,
    action: dict,
    result: dict,
    command_id: str | None,
    holds_this: bool,
) -> None:
    """Within the caller's transaction: write APPLIED/FAILED for a device ack,
    flip state on SUCCESS, clear the lock. Device-bound actions never auto-chain.
    
    Resolution is keyed by `command_id` (matching the HTTP validate layer), NOT
    by `action_id`. ...[explain why]...
    """
```

**Inline comments:** Explain WHY, not WHAT; reference invariants when relevant.

```python
# Device-ack resolution by command_id (HTTP-parity), not action_id.
# Actions repeat across lifecycle (LOCK -> UNLOCK -> LOCK); stale redeliveries
# of old cycles must not corrupt live cycles' locks.
requested = (
    db.find_requested_by_command_id(device_id, command_id) if command_id else None
)
```

### Function Sizing

- **Target:** 20–50 lines per function (readability)
- **Exceptions:** `_process_one` (~130 lines) is unavoidably complex due to branching; mitigated by helper `_apply_device_ack`
- **Helper functions:** Private (leading underscore) if internal logic

### Assertions vs Error Handling

- **Assertions:** Used to catch app bugs (e.g., action not found)
  ```python
  action = db.get_action_by_id(action_id)
  assert action  # app bug if action doesn't exist
  ```
- **Logged returns:** Used for operational edge cases (e.g., device not found)
  ```python
  device = db.lock_device_by_id(device_id)
  if not device:
      logger.warning("checkin_sqs.device_missing device=%s", device_id)
      return
  ```

---

## Code Quality Guidelines

### Linting & Formatting

**Before commit:**
```bash
npm run lint        # from monorepo root
npm run lint:fix    # auto-fix
npm run fmt         # format (line-length 100)
npm run fmt:check   # verify formatting
```

**Python 3.12 target:** Ruff configured in monorepo; this module inherits.

### Compile Checks

Quick syntax validation (no execution):
```bash
python3 -m py_compile handler.py sqs_consumer.py db.py config.py
```

### Testing

- **No unit tests** — Lambda + SQS + DB logic too coupled; E2E via deployed stack.
- **Integration test:** an end-to-end lifecycle test (run after deploying).
- **Local smoke test:** Manual enqueue to local SQS queue; verify milestones in local DB.

---

## Duplication & Maintenance

**Deliberately duplicated across all 5 Lambdas:**
- `config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py`
- **Reason:** CDK bundles each Lambda dir as self-contained asset.
- **When editing:** Check sibling directories and mirror changes.
  - `../fluxion-platform-resolver/`
  - `../fluxion-platform-checkin/`
  - `../fluxion-platform-processor/`
  - `../fluxion-platform-enroll/`

Example: If you fix a bug in `db.py` (e.g., typo in SQL), apply same fix to all 4 sibling `db.py` files.

---

## Naming Conventions

| Item | Style | Example |
|------|-------|---------|
| Module files | snake_case | `sqs_consumer.py` |
| Classes | PascalCase | `class Database:` |
| Functions | snake_case | `def lock_device_by_id(...)` |
| Constants | UPPERCASE | `SYSTEM_ACTIONS`, `API_KEY_PREFIX` |
| Private functions | _snake_case | `def _process_one(...)` |
| Type hints | PascalCase | `Database`, `str`, `None` |
| Local variables | snake_case | `device_id`, `action_type` |
| Database columns | snake_case | `assigned_action_id`, `current_state_id` |
| Log event names | snake_case | `device_applied`, `auto_chain` |

---

## Performance Considerations

### Memory

- Module-global psycopg connection (cached, reused across invocations)
- No large data structures in memory; milestones/states fetched on-demand
- No streaming (batch SQS processing)

### CPU

- Minimal: JSON parse, SQL execution, logging
- No heavy computation (state machine is config-driven, not computed)

### Latency

- ~50–200ms per message (SELECT FOR UPDATE + milestone insert + state update)
- No sequential delays; batch processing via SQS
- No retries within Lambda (SQS handles)

### Concurrency

- Single-flight lock serializes per-device; multiple devices processed in parallel
- Thread-lock guarded psycopg reconnect (safe for Lambda concurrent invocations)

---

## Security Considerations

### SQL Injection Prevention

- **All values bound:** `%(name)s` binding prevents injection
- **Never interpolate:** No f-strings, `.format()`, or `%` operator in SQL

### Credential Management

- **Database URL:** From `DATABASE_URL` env (local) or Secrets Manager (deployed)
- **AWS credentials:** Via Lambda execution role (no hardcoded keys)
- **Log safety:** No credentials logged (no `config.py` vars in logs; no error payloads with secrets)

### Input Validation

- **SQS messages:** Parsed as JSON; bad JSON batch-failed (no uncaught exceptions bubble to logs)
- **Database UUIDs:** Passed as strings; UUID validation in db.py (str conversion safe)
- **State machine:** Config-driven (Alembic migrations); no user input in state lookups

---

## Dependencies & Versioning

| Dependency | Version | Purpose |
|-----------|---------|---------|
| psycopg | >=3.2,<4 | PostgreSQL driver with dict_row cursor factory |
| boto3 | >=1.34,<2 | AWS SDK (SQS, Secrets Manager) |
| Python | 3.12 | Lambda runtime |

No other third-party packages. Keep it minimal.

---

## Code Review Checklist

Before submitting changes:

- [ ] Imports organized (stdlib → third-party → local)
- [ ] Type hints on all function signatures
- [ ] All SQL uses `%(name)s` binding (no interpolation)
- [ ] Transactions wrap multi-statement writes
- [ ] Exceptions caught and logged; no silent failures
- [ ] Logging format: `checkin_sqs.<event> key=value`
- [ ] Comments explain WHY; docstrings explain WHAT
- [ ] No debug prints (use logger)
- [ ] No hardcoded AWS region/queue URLs (use config.py)
- [ ] Duplicated files checked across 5 sibling Lambdas
- [ ] Ruff lint/fmt passes
- [ ] Syntax checked: `python3 -m py_compile`
- [ ] No secrets in logs or config defaults

---

## References

- **Monorepo commands:** See the repo root `README.md`
- **Backend architecture:** See `apps/fluxion-platform-backend/README.md`
- **Module CLAUDE.md:** See `CLAUDE.md` in this directory
- **System architecture:** See `docs/system-architecture.md`
