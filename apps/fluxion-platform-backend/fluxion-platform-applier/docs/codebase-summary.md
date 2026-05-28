# Codebase Summary — Applier Module

## Module at a Glance

**Total LOC:** ~850 across 8 files | **Language:** Python 3.12 | **Framework:** AWS Lambda (SQS consumer)

The Applier is a stateless, idempotent SQS consumer that applies state transitions. It reads messages from `fluxion-action-checkin`, branches on message shape (device-ack vs server-applied), writes milestones, flips state, clears the single-flight lock, and optionally auto-chains the next action.

---

## Per-File Summaries

### `handler.py` (25 lines)

**Purpose:** Lambda entry point.

**Exports:** `lambda_handler(event, context) -> dict`

**Behavior:**
1. Extract `Records` from event dict (SQS batch)
2. Guard: if empty, warn and return `{"batchItemFailures": []}`
3. Delegate to `sqs_consumer.handle_records(records)`

**Key Detail:** Importing `config` here triggers root logger setup (side effect).

---

### `sqs_consumer.py` (262 lines)

**Purpose:** Core SQS consumer logic; branches on message shape and applies state transitions.

**Exports:**
- `handle_records(records: list[dict]) -> dict` — main entry; returns batch failures
- `_process_one(body: dict) -> None` — processes single message
- `_apply_device_ack(...)` — device-ack path (SUCCESS/FAILED, with lock/state management)

**Key Flow:**

**handle_records:**
1. For each SQS record:
   - Parse JSON body
   - Bad JSON → batch failure (redelivery)
   - Skip if `target_service != "checkin"` (not a failure)
   - Call `_process_one(body)`; catch exceptions → batch failure + log

**_process_one:**
1. Extract device_id, action_id, command_id, result from body
2. Open transaction: `db.lock_device_by_id(device_id)` (SELECT FOR UPDATE)
3. Load action by action_id
4. Check if device holds the lock for this action
5. **Branch on result:**
   - **result present** → Call `_apply_device_ack()` (device-ack path)
   - **result absent** → Server-applied path:
     - Check if APPLIED already exists (redelivery); clear lock if so; fall through to auto-chain
     - Else, ensure lock is held; insert APPLIED milestone; flip state; clear lock
6. After commit (outside transaction):
   - If server-applied (applied_type not None): attempt auto-chain
   - Check `AUTO_CHAIN_AFTER_APPLIED` (ENROLL → ACTIVATE)
   - Guard: if chained action already has REQUESTED or APPLIED, skip
   - Else: generate fresh command_id, enqueue to processor queue

**_apply_device_ack:**
1. Validate lock is held by this action (if not, log + return)
2. Resolve REQUESTED by command_id (HTTP validation parity)
3. Check REQUESTED is latest for action (stale cycle check)
4. Check idempotency: if APPLIED/FAILED exists after REQUESTED, clear lock + return
5. **Branch on status:**
   - **SUCCESS:** Insert APPLIED (applied_by=DEVICE); flip state; clear lock
   - **FAILED:** Insert FAILED (applied_by=DEVICE, error); clear lock; no state flip
6. Log outcome

**Key Invariants:**
- Device-ack resolution by `command_id`, NOT `action_id` (actions repeat across lifecycle)
- Stale-cycle acks do not touch live-cycle locks (latest REQUESTED check)
- Idempotent acks detect via `find_ack_milestone_after()`
- Auto-chain only for server-applied (device-bound actions never chain)
- All DB operations within transaction (SELECT FOR UPDATE ensures consistency)

---

### `db.py` (345 lines)

**Purpose:** psycopg wrapper; database access layer; transactions & queries.

**Architecture:**
- Module-global cached connection (thread-lock guarded reconnect)
- `dict_row` factory; `autocommit=True`
- All values bound via `%(name)s` (never interpolated)
- Transaction via `with db.conn.transaction():`

**Exports (class Database):**

**State/Action/Template Lookups:**
- `get_state_by_type(type_: str) -> dict | None` — by type (e.g., "IDLE")
- `get_action_by_type(type_: str) -> dict | None` — by type (e.g., "ACTIVATE")
- `get_action_by_id(action_id) -> dict | None` — by ID
- `get_message_template(template_id) -> dict | None` — by ID

**Device Locking & Updates:**
- `lock_device_by_imei(imei: str) -> dict | None` — SELECT FOR UPDATE by IMEI
- `lock_device_by_id(device_id) -> dict | None` — SELECT FOR UPDATE by device ID
  - Returns: id, imei, tac_id, service_id, current_state_id, assigned_action_id, api_key_hash, fcm_token, info, first_checkin_at, last_checkin_at
- `update_device_fields(device_id, **fields) -> None` — named column updates
  - Column whitelist: current_state_id, assigned_action_id, api_key_hash, fcm_token, info, first_checkin_at, last_checkin_at
  - **Smart sync:** If current_state_id changes, auto-sync service_id from new state (one UPDATE, no drift)

**Milestone Queries:**
- `find_requested_by_command_id(device_id, command_id) -> dict | None` — resolve device-ack by HTTP command_id
- `find_ack_milestone_after(device_id, action_id, after_created_at) -> dict | None` — detect idempotent ack (APPLIED or FAILED after REQUESTED)
- `find_latest_requested_for_action(device_id, action_id) -> dict | None` — stale-cycle check (latest REQUESTED for repeating action)
- `find_applied_milestone(device_id, action_id) -> dict | None` — detect redelivery of server-applied
- `insert_milestone(...) -> dict` — write milestone (REQUESTED, APPLIED, FAILED)
  - Returns: id, created_at
  - Accepts: device_id, action_id, event_type, from_state_id, to_state_id, template_id, requested_by_id, payload (JSON)

**Internal Helpers:**
- `_fetch_one(query, params) -> dict | None` — execute SELECT; return first row as dict
- `_execute(query, params) -> None` — execute INSERT/UPDATE/DELETE (no return)
- `_build_url()` — construct DB URL from DATABASE_URL env or Secrets Manager (DB_SECRET_ARN + DB_ENDPOINT)
- `_get_conn()` — lazy singleton connection with thread-safe reconnect

**SQL Style:**
- All soft deletes: `deleted_at IS NULL`
- UUID conversion: `str(uuid)` for binding; `%(name)s` in query
- JSON storage: `payload::jsonb`, queried via PostgreSQL JSON operators (e.g., `payload->>'command_id'`)

---

### `config.py` (58 lines)

**Purpose:** Runtime configuration; env vars; lazy AWS clients; root logger setup.

**Exports:**
- **Env vars (module-scope constants):**
  - `DB_ENDPOINT`, `DB_SECRET_ARN`, `DATABASE_URL`
  - `FIREBASE_SECRET_ARN`, `DPC_SHARED_KEY_SECRET_ARN`
  - `PROCESSOR_QUEUE_URL`, `CHECKIN_QUEUE_URL`, `CHECKIN_PUBLIC_URL`
  - `AWS_REGION` (default "ap-southeast-1")
- **Logger:** `logger = logging.getLogger("fluxion")` (configured on import)
  - Level: env `LOG_LEVEL` (default "INFO")
  - Root logger also configured on import side effect
- **Functions:**
  - `secretsmanager()` — lazy boto3 client
  - `sqs()` — lazy boto3 client

**Behavior:**
- Thread-lock guarded lazy client instantiation (_lock, _clients dict)
- Logger setup occurs on module import (side effect); other modules use `from config import logger`
- Env vars are empty strings if unset; consumers check truthiness

---

### `constants.py` (51 lines)

**Purpose:** Immutable constants; no env, no I/O, no side effects.

**Exports:**

**Action Classification:**
- `INLINE_UPLOAD = "UPLOAD"` — not dispatchable via GraphQL
- `INLINE_ENROLL = "ENROLL"` — entered via POST /v1/enroll (but flows through SQS as server-applied)
- `SYSTEM_ACTIONS = frozenset({"REGISTER", "ENROLL"})` — no FCM, no device ack
- `DEVICE_BOUND_ACTIONS = frozenset({...})` — processor sends FCM, device acks via /v1/checkin

**Auto-Chaining:**
- `AUTO_CHAIN_AFTER_APPLIED = {"ENROLL": "ACTIVATE"}` — only mapping currently

**SQS Routing:**
- `TARGET_PROCESSOR = "processor"`
- `TARGET_CHECKIN = "checkin"`

**Tuning:**
- `CHECKIN_INTERVAL_IDLE = 3600` — seconds between device checkins when idle
- `CHECKIN_INTERVAL_PENDING = 60` — seconds when actions pending

**API Key Format:**
- `API_KEY_PREFIX = "mdm_live_"`
- `API_KEY_TOKEN_LEN = 32`

**Device:**
- `IMEI_LENGTH = 15`

---

### `sqs_client.py` (53 lines)

**Purpose:** Helper to enqueue actions to SQS; used by auto-chain and processor.

**Exports:**
- `enqueue_action(target_service, device_id, action_id, *, command_id=None, template_id=None, requested_by_id=None, extras=None) -> str`
  - Picks queue URL by target_service (processor or checkin)
  - Builds JSON body: target_service, device_id, action_id, command_id, template_id, requested_by_id, extras
  - Sends via SQS; logs; returns MessageId

**Key Detail:** Used by sqs_consumer for auto-chain enqueue (ENROLL → ACTIVATE).

---

### `errors.py` (54 lines)

**Purpose:** Typed application errors; used by resolver/checkin Lambdas; mostly unused in applier (SQS logs instead).

**Exports:**
- `AppError(code, http_status, message)` — base; has `to_dict()` method
- Subclasses: `NotFound`, `Conflict`, `BadRequest`, `Forbidden`, `Unauthorized`, `InternalError`
- Each has `retry_strategy` dict: `retryable` (>=500), backoff_seconds, max_attempts

**Note:** Applier does not raise these; it logs exceptions + batch-fails. This file is mirrored across all 5 Lambdas for consistency.

---

### `requirements.txt`

**Dependencies:**
- `psycopg[binary]>=3.2,<4` — PostgreSQL async-capable driver (used with dict_row, autocommit=True)
- `boto3>=1.34,<2` — AWS SDK (SQS, Secrets Manager)

---

## Cross-Module Duplication

**Deliberately duplicated in all 5 Lambdas:**
- `config.py` — env vars, logger, boto3 clients
- `constants.py` — action classification, routing labels
- `db.py` — database wrapper (queries differ per Lambda, but structure identical)
- `errors.py` — typed errors
- `sqs_client.py` — enqueue helper

**Reason:** CDK bundles each Lambda directory as a self-contained asset. A shared package broke asset hashing and made independent deploys impossible. **When editing one of these files, check sibling Lambdas** (`../fluxion-platform-{resolver,checkin,enroll,processor}/`) and mirror the change.

---

## Data Flow Walkthrough

### Device-Ack Example (ACTIVATE → SUCCESS)

```
1. Device POST /v1/checkin with ACTIVATE result:SUCCESS
   ↓ (checkin Lambda validates + enqueues)
2. Message lands on fluxion-action-checkin SQS queue
   ↓ (Applier consumes)
3. handler.py → sqs_consumer.handle_records()
4. sqs_consumer._process_one():
   - db.lock_device_by_id() [SELECT FOR UPDATE]
   - extras.result present → call _apply_device_ack()
5. _apply_device_ack():
   - Check lock held by ACTIVATE action_id
   - db.find_requested_by_command_id() → matches device's REQUESTED
   - db.find_latest_requested_for_action() → is latest? YES (in-flight cycle)
   - db.find_ack_milestone_after() → already APPLIED? NO (new ack)
   - status=SUCCESS → db.insert_milestone(APPLIED, applied_by=DEVICE)
   - db.update_device_fields(current_state_id=ACTIVE, assigned_action_id=None)
6. Commit transaction
7. Return with no auto-chain (device-ack never chains)
8. Log: "checkin_sqs.device_applied device=X action=ACTIVATE -> state=ACTIVE"
```

### Server-Applied Example (ENROLL → auto-chain ACTIVATE)

```
1. Device POST /v1/enroll with IMEI
   ↓ (enroll Lambda validates + enqueues ENROLL to processor queue)
2. Processor consumes, originates ENROLL to device
   ↓ (processor enqueues ENROLL + ACTIVATE to checkin queue for this Lambda)
3. Message lands on fluxion-action-checkin SQS queue (server-applied ENROLL, no result)
   ↓ (Applier consumes)
4. handler.py → sqs_consumer.handle_records()
5. sqs_consumer._process_one():
   - db.lock_device_by_id() [SELECT FOR UPDATE]
   - extras.result absent → server-applied path
   - db.find_applied_milestone() for ENROLL → none (new)
   - Lock held by ENROLL action_id? YES
   - db.find_latest_requested_for_action(ENROLL) → fetch from_state
   - db.insert_milestone(APPLIED, applied_by=SYSTEM)
   - db.update_device_fields(current_state_id=ENROLLED, assigned_action_id=None)
   - applied_type="ENROLL"
6. Commit transaction
7. After commit (outside transaction):
   - AUTO_CHAIN_AFTER_APPLIED["ENROLL"] → "ACTIVATE"
   - db.find_latest_requested_for_action(ACTIVATE) → none (not yet)
   - db.find_applied_milestone(ACTIVATE) → none (not yet)
   - enqueue_action(TARGET_PROCESSOR, device_id, ACTIVATE_action_id, command_id=fresh)
8. Log: "checkin_sqs.applied device=X action=ENROLL -> state=ENROLLED"
9. Log: "checkin_sqs.auto_chain device=X ENROLL -> ACTIVATE"
10. Processor re-consumes ACTIVATE, sends FCM to device
11. Device acks ACTIVATE → Applier flips to ACTIVE
```

---

## Testing Strategy

**No unit tests** — Lambda logic is tightly coupled to SQS + DB transactions; isolated unit testing is impractical.

**E2E validation:** an end-to-end lifecycle test (run against deployed stack)
- Enrolls a test device
- Verifies exactly 10 milestones in canonical order
- Tests lock rejection (concurrent action attempts)
- Tests idempotent acks (redelivered messages)
- Polls for eventual consistency

**Local development:**
```bash
npm run db:up && npm run db:migrate       # Local DB + seed state machine
python3 -m py_compile handler.py          # Quick syntax check
npm run lint / fmt                         # Ruff checks
```

---

## Performance Characteristics

- **Throughput:** Batch SQS processing; no per-message delays
- **Latency:** ~50–200ms per message (DB lock + milestone insert + state update)
- **Concurrency:** Single-flight lock serializes per-device; multiple devices in parallel
- **Memory:** Minimal (single psycopg connection, cached at module scope)
- **CPU:** Negligible (JSON parse, SQL execution, logging)

---

## Observability & Debugging

**Log Lines (all prefixed `checkin_sqs.` for historical continuity):**
- `applied` — Server-applied action successfully written
- `device_applied` — Device-ack (SUCCESS) written
- `device_failed` — Device-ack (FAILED) written
- `ack_idempotent` — Device ack already processed; lock cleared; no double-write
- `ack_stale_cycle` — Device ack from prior cycle of repeating action; lock not touched
- `lock_mismatch` — Device lock not held by this action; skipped
- `auto_chain` — ENROLL → ACTIVATE enqueued post-commit
- `bad_json` — Malformed SQS message; batch-failed
- `device_missing` — Device not found; likely app bug (processor should validate)
- `skip` — target_service != "checkin"; silently skipped
- `failure` — Uncaught exception; batch-failed; full traceback logged

**Metrics to Monitor:**
- `batchItemFailures` rate (should be near 0 in production)
- `lock_mismatch` rate (indicates out-of-order SQS or processor bugs)
- `ack_idempotent` rate (normal; redeliveries happen)
- P99 message age (SQS to processing latency)
- P99 transaction duration (lock hold time)
