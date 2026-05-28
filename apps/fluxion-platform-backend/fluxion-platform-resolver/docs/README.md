# fluxion-platform-resolver Documentation

**AppSync direct Lambda resolver for Fluxion MDM admin GraphQL API**

This directory contains implementation documentation for the resolver module (1,843 LOC, 18 Python files).

## Quick Start for Developers

### I want to...

- **Understand the module structure** → Start with [codebase-summary.md](./codebase-summary.md)
  - File inventory, handler registry, key patterns
  
- **Learn how requests flow** → Read [system-architecture.md](./system-architecture.md)
  - AppSync dispatch, synchronous (uploadImei) and async (dispatchAction) flows
  - Error contract, database schema, concurrency model
  
- **Write or modify code** → Follow [code-standards.md](./code-standards.md)
  - Handler patterns, error handling, DB access, serialization
  - Style guide, testing strategy, pre-commit checklist

## Documentation Map

| File | Lines | Purpose |
|------|-------|---------|
| [codebase-summary.md](./codebase-summary.md) | 96 | File-by-file inventory; handler registry; key patterns |
| [system-architecture.md](./system-architecture.md) | 357 | Platform context; request flows; error contract; concurrency |
| [code-standards.md](./code-standards.md) | 529 | Development conventions; patterns; debugging; pre-commit |

## Key Concepts

### Handler Dispatch (handler.py)
AppSync invokes Lambda with `event.info.fieldName`. Handler looks up resolver in merged `QUERY_HANDLERS + MUTATION_HANDLERS` dict, calls it with `(db, args, identity)`, catches `AppError` → GraphQL error.

### Two Flows

**Synchronous: uploadImei**
- Validate IMEI (15 digits)
- TAC lookup (IMEI[:8])
- Duplicate check
- CREATE device + UPLOAD milestones (single transaction)
- No SQS

**Asynchronous: dispatchAction**
- Validate action + state machine
- Best-effort busy-check (device.assigned_action_id IS NULL)
- ENQUEUE to processor queue
- Processor acquires FOR UPDATE lock, writes REQUESTED milestone

### Error Handling
Raise `AppError` subclasses with stable UPPER_SNAKE codes (e.g., `INVALID_IMEI_FORMAT`, `DEVICE_BUSY`). Handler converts to GraphQL error envelope.

### Database
Single global psycopg3 connection (thread-safe lazy init, reconnects on stale). All values bound via `%(name)s`. Transactions via `with db.conn.transaction():`.

### Pagination
Cursor = base64(id, createdAt). Fetch `limit+1` to detect overflow, separate count query for total.

## Architecture Context

Part of the Fluxion MDM platform backend (5 Lambdas):
1. **resolver** (you are here) — admin GraphQL API
2. **processor** — SQS consumer; sole request originator (lock + REQUESTED), FCM dispatcher
3. **checkin** — HTTP-only device /v1/checkin PULL/ACK gateway; enqueues acks to the checkin queue
4. **enroll** — HTTP-only device POST /v1/enroll, api_key issuer
5. **applier** — SQS consumer; sole transition writer (APPLIED/FAILED, state flip, lock clear, auto-chain ENROLL→ACTIVATE)

Two SQS queues (one per consumer, avoids ESM filtering race):
- `fluxion-action-processor` ← resolver/checkin/enroll/applier enqueue, processor consumes
- `fluxion-action-checkin` ← processor enqueues (REGISTER/ENROLL), checkin enqueues device acks, applier consumes

## Common Tasks

### Add a new Query handler
1. Create function in `resolvers/{entity}.py`: `def my_query(db, args, identity) -> dict`
2. Add to `QUERY_HANDLERS` dict in same file
3. It auto-aggregates in `resolvers/__init__.py`
4. Update GraphQL SDL in `infra/schema/appsync.graphql`

### Add a new Mutation handler
Same as query, but add to `MUTATION_HANDLERS` dict. Most mutations call `_require_user()` for auth.

### Handle a new error case
1. Raise appropriate `AppError` subclass: `raise NotFound("CODE_HERE", "message")`
2. Use stable UPPER_SNAKE code (appears in GraphQL extensions)
3. Follow error classes in [code-standards.md](./code-standards.md#error-handling)

### Test locally
1. Set `DATABASE_URL=postgresql://...` (or `DB_SECRET_ARN` + `DB_ENDPOINT`)
2. Set `PROCESSOR_QUEUE_URL`, `CHECKIN_QUEUE_URL`
3. Run: `python -c "from handler import lambda_handler; lambda_handler({...}, None)"`
4. Or use E2E tests: an end-to-end lifecycle test (deployed stack)

### Deploy
Module is self-contained (CDK Docker bundling). Touch this directory, CDK recomputes asset hash, Lambda redeploys. Changes to shared files (config.py, constants.py, db.py, errors.py, sqs_client.py, auth.py) must be mirrored to 5 Lambdas — use script automation to detect drift.

## Pre-Commit Checklist

Before pushing:
```bash
# Lint & format
npm run lint
npm run fmt

# Syntax check
python -m py_compile *.py resolvers/*.py

# No secrets in code
grep -r "secret\|password\|api.key" --include="*.py" .
```

See [code-standards.md](./code-standards.md#pre-commit-checklist) for full checklist.

## Debugging

### CloudWatch Logs
```
fields @timestamp, @message, @duration
| filter @message like /resolver\./
| stats count() by code
```

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `UNAUTHENTICATED` on mutation | No Cognito identity | Check AppSync auth rule; mutation requires claims.sub + claims.email |
| `DEVICE_NOT_FOUND` | Device by id/imei missing | Verify uploadImei succeeded first; check IMEI format |
| `DEVICE_BUSY` | assigned_action_id not NULL | Wait for processor to complete (acquire lock); check processor logs |
| `INVALID_STATE` | Action not valid from current state | Check device.current_state_id matches action.from_state_id |
| Connection timeout | DB unreachable | Check DATABASE_URL or DB_SECRET_ARN + DB_ENDPOINT env vars |

## Module Ownership

**Code:** resolvers/{entity}.py files, handler.py, auth.py (admin identity)
**Database:** db.py (thin psycopg wrapper)
**Errors:** errors.py (stable error codes)
**Config:** config.py, constants.py (env vars, action classification)
**Utilities:** sqs_client.py (enqueue to processor/checkin queues)

**Shared with 4 other Lambdas:** config.py, constants.py, db.py, errors.py, sqs_client.py, auth.py (copies, not shared package)

## Links

- **GraphQL Schema:** `infra/schema/appsync.graphql` (root)
- **Database Migrations:** `infra/migrations/` (Alembic)
- **Backend README:** `../README.md` (4 Lambdas overview)
- **Platform Architecture:** `../../../README.md` (root)
