# Codebase Summary — Processor Lambda

7 Python files, 631 LOC total. Single responsibility: SQS consumer → per-device lock → REQUESTED milestone → route side effects.

## Module inventory

### handler.py (152 LOC)
**Purpose:** SQS event handler + transaction orchestrator.

**Key functions:**
- `lambda_handler(event, context)` — Entry point. Parses SQS batch, skips non-processor messages, collects batchItemFailures.
- `_process_one(body)` — Single message processor. Acquires FOR UPDATE lock, checks single-flight condition, writes REQUESTED milestone inside transaction, routes side effects after commit.
- `_build_fcm_payload(action_type, template, command_id)` — Builds data-only FCM message ({wake, command_id, action_type, template_title?, template_type?}).

**Data flow:**
1. Parse SQS message body (JSON).
2. Filter by target_service=processor.
3. Open transaction on device row (FOR UPDATE).
4. Check `assigned_action_id`: NULL → originate; same action_id → idempotent redelivery; different → device busy, drop.
5. Resolve template (explicit or fallback to action.default_template_id).
6. If originating: set lock, insert REQUESTED milestone.
7. Commit transaction.
8. Route: SYSTEM_ACTIONS → enqueue_action(checkin); DEVICE_BOUND_ACTIONS → fcm_dispatch(fcm_token, payload).

### db.py (175 LOC)
**Purpose:** Thin psycopg wrapper. Module-scope singleton connection with double-checked locking, reconnect on broken.

**Key functions:**
- `_build_url()` — Builds DATABASE_URL from env or Secrets Manager (DB_SECRET_ARN + DB_ENDPOINT).
- `_get_conn()` — Lazy connection singleton. Checks closed/broken status, reconnects if needed.
- `Database.lock_device_by_id(device_id)` — SELECT ... FOR UPDATE on devices row (returns imei, tac_id, service_id, current_state_id, assigned_action_id, fcm_token, etc.).
- `Database.set_device_assigned_action(device_id, action_id)` — UPDATE devices SET assigned_action_id.
- `Database.get_action_by_id(action_id)` — SELECT from actions (type, name, actor, target_state_id, default_template_id, etc.).
- `Database.get_message_template(template_id)` — SELECT from message_templates (title, content, type, icons).
- `Database.insert_milestone(device_id, action_id, event_type, from_state_id, to_state_id, template_id, requested_by_id, payload)` — INSERT into milestones RETURNING id, created_at.

**Database tables touched:**
- `devices` — reads: id, imei, tac_id, service_id, current_state_id, assigned_action_id, fcm_token. Writes: assigned_action_id.
- `actions` — reads: id, type, name, actor, from_state_id, target_state_id, default_template_id.
- `message_templates` — reads: id, title, content, type, header_icon_url, notification_icon_url.
- `milestones` — writes: device_id, action_id, event_type, from_state_id, to_state_id, template_id, requested_by_id, payload (jsonb).

**Key pattern:** All SQL bound via `%(name)s`; never f-string-interpolated. Autocommit=True at module level; transactions managed by caller via `db.conn.transaction()` context manager.

### fcm_dispatcher.py (85 LOC)
**Purpose:** Firebase Admin SDK wrapper. Lazy init from Secrets Manager; permanent mock fallback if secret unset/empty/malformed.

**Key functions:**
- `_init()` — Double-checked locking. Fetches FIREBASE_SECRET_ARN from Secrets Manager, parses JSON, initializes firebase_admin. Returns True if initialized, False if permanent mock (secret empty/malformed). Transient errors leave _initialized=False to retry next call.
- `dispatch(fcm_token, payload)` — Send data-only message. Never raises. Returns {ok, mocked, message_id} on success; {ok, mocked, reason} on failure. If token is None or _init() fails, returns mocked response.

**Invariant:** FCM failure must not block milestone bookkeeping. Next /v1/checkin tick is fallback wake.

### config.py (58 LOC)
**Purpose:** Environment variables, lazy AWS clients, root logger initialization.

**Env vars exposed:**
- LOG_LEVEL, AWS_REGION (or AWS_REGION_OVERRIDE), DB_ENDPOINT, DB_SECRET_ARN, DATABASE_URL
- FIREBASE_SECRET_ARN, DPC_SHARED_KEY_SECRET_ARN
- PROCESSOR_QUEUE_URL, CHECKIN_QUEUE_URL, CHECKIN_PUBLIC_URL

**Lazy clients:**
- `secretsmanager()` — boto3 secretsmanager client (double-checked locking).
- `sqs()` — boto3 SQS client (double-checked locking).

**Side effect on import:** Root logger configured once at module level (`logging.getLogger()` and `logger = logging.getLogger("fluxion")`). Other modules use `from config import logger` to inherit.

### constants.py (51 LOC)
**Purpose:** Immutable values; no I/O, no env, no clients.

**Key constants:**
- `INLINE_UPLOAD`, `INLINE_ENROLL` — Actions not dispatchable via admin GraphQL (dispatch route guard).
- `SYSTEM_ACTIONS` — frozenset{REGISTER, ENROLL}. Server-applied → enqueue to checkin.
- `DEVICE_BOUND_ACTIONS` — frozenset{ACTIVATE, LOCK, UNLOCK, NOTIFY_FROM_ACTIVE, NOTIFY_FROM_LOCKED, RELEASE_FROM_ACTIVE, RELEASE_FROM_LOCKED}. Device-initiated → FCM.
- `AUTO_CHAIN_AFTER_APPLIED` — {"ENROLL": "ACTIVATE"}. Checkin uses for auto-chaining.
- `TARGET_PROCESSOR`, `TARGET_CHECKIN` — SQS routing labels.
- `CHECKIN_INTERVAL_IDLE`, `CHECKIN_INTERVAL_PENDING` — Device checkin tuning (3600s idle, 60s pending).
- `API_KEY_PREFIX`, `API_KEY_TOKEN_LEN` — DPC API key format (mdm_live_, 32 chars).
- `IMEI_LENGTH` — 15 characters.

### sqs_client.py (53 LOC)
**Purpose:** SQS enqueue helper. Routes to correct queue by target_service.

**Key functions:**
- `_queue_url_for(target_service)` — Returns PROCESSOR_QUEUE_URL or CHECKIN_QUEUE_URL.
- `enqueue_action(target_service, device_id, action_id, *, command_id, template_id, requested_by_id, extras)` — Builds message body, calls sqs().send_message(), logs, returns MessageId.

**Message schema:**
```json
{
  "target_service": "processor|checkin",
  "device_id": "uuid",
  "action_id": "uuid",
  "command_id": "string|null",
  "template_id": "uuid|null",
  "requested_by_id": "uuid|null",
  "extras": {"metadata": {}, "branch": "system|device", ...}
}
```

### errors.py (54 LOC)
**Purpose:** Typed application errors for cross-Lambda contracts.

**Classes:**
- `AppError` — Base (code, http_status, message). `to_dict()` returns {error_code, message, retry_strategy}.
- Subclasses: `NotFound` (404), `Conflict` (409), `BadRequest` (400), `Forbidden` (403), `Unauthorized` (401), `InternalError` (500).

**Retry logic:** http_status >= 500 → retryable=True, backoff_seconds=5, max_attempts=5.

---

## Data flow (complete)

```
SQS fluxion-action-processor
    │
    └─> handler.lambda_handler()
        │
        ├─> skip non-processor messages
        │
        ├─> _process_one() per message
        │   │
        │   ├─> db.lock_device_by_id()
        │   │   └─> SELECT ... FOR UPDATE devices
        │   │
        │   ├─> Check assigned_action_id
        │   │   ├─ NULL: originate
        │   │   ├─ same: idempotent redelivery
        │   │   └─ different: drop (device busy)
        │   │
        │   ├─> db.get_action_by_id()
        │   │   └─> SELECT actions
        │   │
        │   ├─> db.get_message_template()
        │   │   └─> SELECT message_templates
        │   │
        │   ├─> db.set_device_assigned_action()
        │   │   └─> UPDATE devices SET assigned_action_id
        │   │
        │   └─> db.insert_milestone()
        │       └─> INSERT milestones (REQUESTED event)
        │
        └─> [after transaction commits]
            │
            ├─ if SYSTEM_ACTIONS:
            │  └─> sqs_client.enqueue_action(TARGET_CHECKIN)
            │      └─> SQS fluxion-action-checkin
            │
            └─ if DEVICE_BOUND_ACTIONS:
               └─> fcm_dispatcher.dispatch()
                   └─> Firebase Admin SDK send (or mock)
```

---

## Key invariants

1. **No dedupe on (device, action)** — Same action dispatched many times per device lifetime; each carries own command_id and warrant separate REQUESTED milestone.
2. **Single-flight lock per device** — Only one action in-flight at a time. Redeliveries idempotent (check `assigned_action_id`).
3. **Side effects post-commit** — SQS and FCM only after transaction commits. Prevents cascading rollback.
4. **REQUESTED-only writes** — Processor never writes APPLIED, FAILED, or state transitions. Applier owns those.
5. **FCM never blocks** — Dispatch returns dict, never raises. Next checkin is fallback wake.
6. **Permanent mock fallback** — If FIREBASE_SECRET_ARN unset/malformed, dispatch flips to permanent mock (not transient retry).

---

## Configuration

**Prod deployment:** CDK wires env vars from Secrets Manager ARNs. Local dev uses DATABASE_URL env var + mock Firebase.

**Linting (monorepo root):**
```bash
npm run lint    # ruff check (E/F/I/UP/B)
npm run fmt     # ruff format
```

**Testing:** E2E via an end-to-end lifecycle test against deployed stack. No unit tests (pure event handler).

