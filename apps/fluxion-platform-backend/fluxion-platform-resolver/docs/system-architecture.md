# System Architecture: fluxion-platform-resolver

## Role in Fluxion Platform

The resolver is one of five backend Lambdas in the Fluxion MDM platform. It owns the **admin GraphQL API** — all device management, configuration, and action dispatch operations enter through AppSync here.

```mermaid
flowchart TB
    FE["Admin Frontend (React)"] -->|GraphQL| AS["AWS AppSync"]
    AS -->|"event.info.fieldName"| R["fluxion-platform-resolver<br/>(this Lambda)"]

    R -->|"sync reads/writes"| DB[("PostgreSQL")]
    R -->|"dispatchAction enqueue"| PQ[/"SQS fluxion-action-processor"/]

    PQ --> P["Processor Lambda<br/>(sole originator: lock + REQUESTED, FCM)"]
    P -->|"server-applied (REGISTER/ENROLL)"| CQ[/"SQS fluxion-action-checkin"/]
    P -.->|"FCM wake"| DPC["Android DPC device"]

    DPC -->|"POST /v1/checkin ack"| CK["Checkin Lambda (HTTP)"]
    DPC -->|"POST /v1/enroll"| EN["Enroll Lambda (HTTP)"]
    CK -->|"enqueue device ack"| CQ
    EN -->|"enqueue ENROLL"| PQ

    CQ --> AP["Applier Lambda<br/>(sole transition writer: APPLIED/FAILED,<br/>state flip, lock clear, auto-chain)"]
    AP -->|"auto-chain ENROLL→ACTIVATE"| PQ
    AP --> DB
    P --> DB
```

Queue consumers (verified `infra/lib/constructs/lambdas-construct.ts`): **processor** is the sole consumer of the processor queue; **applier** is the sole consumer of the checkin queue. Checkin and enroll are HTTP-only — they enqueue, never consume.

## Request Flow

### 1. Dispatch Entry (handler.py)

AppSync invokes Lambda with event:
```python
{
  "info": {
    "fieldName": "uploadImei",        # or "device", "listDevices", etc.
    "parentTypeName": "Mutation"      # or "Query"
  },
  "arguments": { "input": {...} },
  "identity": {
    "sub": "cognito-user-id",
    "claims": {"email": "admin@example.com"}
  }
}
```

Handler (handler.py:20–46):
1. Extract `fieldName`, `arguments`, `identity`
2. Look up handler in merged `_HANDLERS` dict (from resolvers/__init__.py)
3. Create `Database()` instance (gets live connection from pool)
4. Call handler with `(db, args, identity)`
5. On `AppError`: convert to GraphQL error → raise Exception(json.dumps({errorType, errorMessage, extensions.code}))
6. On unexpected Exception: log, raise INTERNAL_ERROR

### 2. Synchronous Flow: uploadImei

**Mutation:** `uploadImei(input: {imei: String!})`

**handler:** resolvers/device.py:83–170 `upload_imei()`

**Steps:**
1. Validate IMEI (15 digits)
2. Look up TAC code (IMEI[:8]) in database
   - Miss → create COMPLETED upload row (TAC_NOT_FOUND error) → return
3. Check for duplicate IMEI in devices
   - Exists → create COMPLETED upload row (duplicate_count=1) → return
4. Else: single transaction
   - Create device (service=INVENTORY, state=IDLE)
   - Insert REQUESTED milestone (action=UPLOAD, to_state=IDLE)
   - Insert APPLIED milestone (action=UPLOAD, to_state=IDLE)
   - Create COMPLETED upload row
5. Return DeviceUpload with attached device

**Database writes:** All within `with db.conn.transaction():` (autocommit=False inside block, auto-rolls back on exception)

**No SQS:** This is purely synchronous. The processor Lambda never sees UPLOAD actions.

```
uploadImei request
    │
    ▼
Validate IMEI (15 digits)
    │
    ▼
TAC lookup (IMEI[:8])
    ├─ NOT FOUND → create upload row (status=COMPLETED, error=TAC_NOT_FOUND) → return
    │
    ▼
Check device by IMEI
    ├─ EXISTS → create upload row (status=COMPLETED, duplicate_count=1) → return
    │
    ▼
BEGIN transaction
  │
  ├─ CREATE device (INVENTORY, IDLE)
  │
  ├─ INSERT milestone (UPLOAD, REQUESTED, to_state=IDLE)
  │
  ├─ INSERT milestone (UPLOAD, APPLIED, to_state=IDLE)
  │
  ├─ CREATE upload row (status=COMPLETED, created_count=1)
  │
COMMIT
    │
    ▼
Return DeviceUpload {device, status, result}
```

### 3. Asynchronous Flow: dispatchAction

**Mutation:** `dispatchAction(input: {deviceId, actionType, templateId?, metadata?})`

**handler:** resolvers/device.py:173–223 `dispatch_action()`

**Steps:**
1. Validate action not in {UPLOAD, ENROLL} (dispatch-guard)
2. Look up action by type in database
3. Validate action has SQS routing (SYSTEM_ACTIONS ∪ DEVICE_BOUND_ACTIONS)
4. Get effective template (provided or action.default_template_id)
5. **Best-effort busy-check** (read-only, no lock):
   - Device exists?
   - action.from_state_id == device.current_state_id?
   - device.assigned_action_id IS NULL? (best-effort; processor sets the lock later)
6. If template_required and no effective template → TEMPLATE_REQUIRED error
7. Generate `cmd_<16-hex>` command_id
8. **Enqueue to processor queue** (via sqs_client.enqueue_action)
9. Return DispatchResult {actionId, status=REQUESTED}

**SQS Message Body:**
```json
{
  "target_service": "processor",
  "device_id": "uuid",
  "action_id": "uuid",
  "command_id": "cmd_abc123...",
  "template_id": "uuid or null",
  "requested_by_id": "uuid",
  "extras": {"metadata": {...}}
}
```

**Downstream pipeline** (separate modules):
1. **Processor** consumes the processor queue. For ALL actions it acquires the device row `FOR UPDATE`, sets `assigned_action_id` (single-flight lock), and writes the REQUESTED milestone.
2. For SYSTEM_ACTIONS (REGISTER, ENROLL): processor re-enqueues to the checkin queue — no FCM, no device involvement.
3. For DEVICE_BOUND_ACTIONS: processor sends an FCM wake; the device pulls the command via `POST /v1/checkin`, executes, and acks. The checkin Lambda (HTTP) validates the ack and enqueues it to the checkin queue.
4. **Applier** consumes the checkin queue — sole transition writer. Writes APPLIED (or FAILED), flips device state, clears the lock; after a real ENROLL APPLIED it auto-chains ACTIVATE by enqueuing back to the processor.

**Note:** dispatchAction does NOT write REQUESTED milestone. The processor does, after acquiring the FOR UPDATE lock. This is why the busy-check is best-effort — two concurrent dispatches can both pass validation and reach the processor; the processor serializes them under the lock and the loser sees assigned_action_id already set.

```
dispatchAction request
    │
    ▼
Validate action NOT in {UPLOAD, ENROLL}
    │
    ▼
Action exists & has SQS routing?
    ├─ NO → INVALID_ACTION error
    │
    ▼
Device exists?
    ├─ NO → DEVICE_NOT_FOUND error
    │
    ▼
Check state machine: from_state_id == current_state_id?
    ├─ NO → INVALID_STATE error
    │
    ▼
Best-effort busy check: assigned_action_id IS NULL?
    ├─ NO → DEVICE_BUSY error
    │
    ▼
Template required but missing?
    ├─ YES → TEMPLATE_REQUIRED error
    │
    ▼
Generate command_id
    │
    ▼
ENQUEUE to processor queue
    │
    ▼
Return DispatchResult {actionId, status=REQUESTED}
    │
    └─► Processor Lambda picks up message from SQS
        (processor writes REQUESTED milestone + lock;
         applier later writes APPLIED/FAILED + clears lock)
```

## Error Contract

All errors map to GraphQL extensions.code. Schema:

```graphql
{
  "errorType": "CODE_IN_UPPER_SNAKE",
  "errorMessage": "Human-readable message",
  "extensions": {
    "code": "CODE_IN_UPPER_SNAKE"
  }
}
```

### Error Codes

| Code | HTTP | Cause | Example |
|------|------|-------|---------|
| `INVALID_IMEI_FORMAT` | 400 | IMEI not 15 digits | "IMEI must be 15 digits" |
| `DEVICE_NOT_FOUND` | 404 | Device id/imei missing | "Device {id} not found" |
| `DEVICE_BUSY` | 409 | assigned_action_id not NULL | "Device already has pending action" |
| `INVALID_ACTION` | 400 | Action type unknown or not dispatchable | "Unknown action {type}" |
| `INVALID_STATE` | 409 | from_state_id mismatch | "Action {type} not valid from state {type}" |
| `TEMPLATE_REQUIRED` | 400 | action.template_required but no templateId | "Action {type} needs templateId" |
| `UNAUTHENTICATED` | 401 | No Cognito identity | "Cognito identity missing" |
| `NOT_FOUND` | 404 | Resource (TAC, template) not found | "TAC/Template not found" |
| `INVALID_SERVICE` | 400 | Service type not found | "Service {type} not found" |
| `INVALID_TAC` | 400 | TAC format invalid | "TAC must be 8 digits" |
| `INTERNAL_ERROR` | 500 | Unhandled exception | "Unhandled server error" |
| `UNKNOWN_FIELD` | 400 | No resolver for field | "No resolver for field {type}.{field}" |

## Database Schema (Abbreviated)

Connection URL from env:
- `DATABASE_URL` (local dev), or
- Secrets Manager `DB_SECRET_ARN` + env `DB_ENDPOINT` (AWS)

Key tables read/written by resolver:

| Table | Resolver Writes? | Notes |
|-------|------------------|-------|
| `services` | Read only | Seeded by migrations; used for action/state/template grouping |
| `states` | Read only | State machine nodes; seeded by migrations |
| `actions` | Read only | Dispatchable actions; seeded by migrations |
| `devices` | Create only (uploadImei) | IMEI unique; `set_device_assigned_action` exists in db.py but is unused here (shared copy — processor/applier own the lock) |
| `tacs` | CRUD | TAC code (8 digits) unique; soft-deleted |
| `users` | Upsert (Cognito identity) | cognito_sub unique; admin users |
| `milestones` | Insert | Device history; action_id + from/to state |
| `message_templates` | CRUD | Admin-defined message content; soft-deleted |
| `device_uploads` | Insert | Batch upload records (uploadImei is one-off) |

## Concurrency Notes

### Single-Flight Lock Pattern (Processor Owns It)

The resolver does **best-effort** busy-check (assigned_action_id IS NULL, no lock). Processor acquires the lock:

1. Processor polls SQS message for device_id + action_id
2. Locks device row: `SELECT ... FROM devices WHERE id = ... FOR UPDATE`
3. Checks assigned_action_id again (now guaranteed exclusive)
   - If already set, no-op (another dispatch beat us)
   - Else, set assigned_action_id = current action_id
4. Writes REQUESTED milestone
5. Sends FCM (device-bound) or re-enqueues to checkin queue (server-applied)
6. Applier (sole consumer of checkin queue) writes APPLIED/FAILED, flips state, clears the lock

**Why best-effort in resolver?** Two concurrent dispatchAction calls could both pass, both enqueue. The processor serializes them under the lock; the loser sees assigned_action_id already set and no-ops. This trades slightly redundant SQS messages for simpler resolver code (no long-lived locks on device).

### Thread Safety

Database connection pooling:
- Single global `_conn` in db.py module scope
- Protected by `threading.Lock`
- Check: not closed, not broken before reuse
- Reconnects on stale connection
- Each Lambda invocation gets same global connection (safe due to psycopg3 thread-local design)

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant FE as Admin Frontend
    participant AS as AppSync
    participant H as handler.py
    participant DB as PostgreSQL
    participant PQ as processor queue (SQS)

    FE->>AS: GraphQL operation
    AS->>H: event {info.fieldName, arguments, identity}
    H->>H: lookup fieldName in _HANDLERS

    alt uploadImei (synchronous)
        H->>DB: validate IMEI, TAC lookup, duplicate check
        H->>DB: transaction: device + REQUESTED/APPLIED milestones + upload row
        H-->>AS: DeviceUpload {device, result}
    else dispatchAction (validate + enqueue)
        H->>DB: action lookup, state-machine + busy check (no lock)
        H->>PQ: enqueue {device_id, action_id, command_id, ...}
        H-->>AS: DispatchResult {actionId, status}
        Note over PQ: processor originates (lock + REQUESTED),<br/>applier later applies (APPLIED + state flip)
    else queries (listDevices, device, ...)
        H->>DB: paginated reads (cursor, limit+1, count)
        H-->>AS: Connection {edges, totalCount, pageInfo}
    end
```

## Configuration & Environment

Env vars (from config.py):

| Var | Purpose | Example |
|-----|---------|---------|
| `LOG_LEVEL` | Root logger level | "INFO", "DEBUG" |
| `AWS_REGION` | AWS region (fallback: ap-southeast-1) | "ap-southeast-1" |
| `DATABASE_URL` | Direct postgres URI (local dev) | "postgresql://user:pass@localhost:5432/fluxion" |
| `DB_SECRET_ARN` | Secrets Manager secret ARN (AWS) | "arn:aws:secretsmanager:..." |
| `DB_ENDPOINT` | RDS endpoint (AWS, paired with SECRET_ARN) | "db.xxx.rds.amazonaws.com" |
| `PROCESSOR_QUEUE_URL` | SQS queue for processor Lambda | "https://sqs.ap-southeast-1.amazonaws.com/..." |
| `CHECKIN_QUEUE_URL` | SQS queue for checkin Lambda | "https://sqs.ap-southeast-1.amazonaws.com/..." |
| `DPC_SHARED_KEY_SECRET_ARN` | Secret for DPC auth (used by device Lambdas, not this one) | — |
| `FIREBASE_SECRET_ARN` | Firebase credentials (used by processor, not this one) | — |

Database secret JSON (from Secrets Manager, used when DATABASE_URL unset):
```json
{
  "username": "fluxion_admin",
  "password": "...",
  "dbname": "fluxion"
}
```

## Deployment Notes

- Lambda runtime: Python 3.12
- Layer: psycopg[binary], boto3 (pinned in requirements.txt)
- Concurrency: No explicit reserved concurrency (AppSync can be bursty; monitor CloudWatch)
- Timeout: Should be >= 30s (device listing with pagination can hit DB + count query)
- Memory: 256–512 MB sufficient (thin wrapper, no heavy processing)

See ../README.md for deployment patterns (CDK Docker bundling, self-contained asset).
