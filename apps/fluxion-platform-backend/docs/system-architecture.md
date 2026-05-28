# Fluxion Backend — System Architecture

## Overview

The Fluxion backend is a distributed, event-driven system of five independent Lambda functions coordinating through two SQS queues and a PostgreSQL database to manage a strict device state machine with single-flight concurrency control and complete auditability.

## High-Level Pipeline

```mermaid
graph TB
    AdminConsole["React Admin Console<br/>(Cognito Auth)"]
    AppSync["AWS AppSync<br/>(GraphQL)"]
    
    Resolver["Lambda: Resolver<br/>(AppSync Direct Invoker)"]
    
    ProcQueue["SQS Queue:<br/>fluxion-action-processor"]
    CheckinQueue["SQS Queue:<br/>fluxion-action-checkin"]
    DLQ["Dead Letter Queue"]
    
    Processor["Lambda: Processor<br/>(SQS Consumer)"]
    Checkin["Lambda: Checkin<br/>(HTTP Gateway)"]
    Enroll["Lambda: Enroll<br/>(HTTP Gateway)"]
    Applier["Lambda: Applier<br/>(SQS Consumer)"]
    
    FCM["Firebase Cloud<br/>Messaging"]
    Device["Android Device<br/>(DPC)"]
    
    DB["PostgreSQL 15<br/>(RDS)"]
    
    AdminConsole -->|GraphQL Query/Mutation| AppSync
    AppSync -->|Invoke| Resolver
    Resolver -->|uploadImei: inline write| DB
    Resolver -->|dispatchAction: validate + enqueue| ProcQueue
    
    Enroll -->|POST /v1/enroll<br/>IMEI validate, key issue| DB
    Enroll -->|enqueue ENROLL| ProcQueue
    
    ProcQueue -->|consume| Processor
    Processor -->|lock acquire, write REQUESTED<br/>SYSTEM_ACTIONS: re-enqueue| CheckinQueue
    Processor -->|DEVICE_BOUND_ACTIONS: FCM wake| FCM
    Processor -->|read/write| DB
    
    FCM -->|wake=true push| Device
    Device -->|POST /v1/checkin<br/>PULL: get command| Checkin
    Device -->|POST /v1/checkin<br/>ACK: send result| Checkin
    
    Checkin -->|PULL: return pending command<br/>ACK: validate + enqueue| CheckinQueue
    Checkin -->|read/write| DB
    
    CheckinQueue -->|consume| Applier
    Applier -->|lock release, write APPLIED/FAILED<br/>flip state, auto-chain| DB
    
    Applier -->|auto-chain ENROLL→ACTIVATE| ProcQueue
    
    Applier -->|failed messages| DLQ
    Processor -->|failed messages| DLQ
    Checkin -->|validation failures| Applier
    
    style Resolver fill:#e1f5ff
    style Processor fill:#f3e5f5
    style Checkin fill:#f1f8e9
    style Enroll fill:#fff3e0
    style Applier fill:#fce4ec
    style DB fill:#e0f2f1
```

## SQS Queue Topology

The backend uses two physical queues instead of one shared queue with filtering:

```mermaid
graph LR
    Resolver["Resolver<br/>(GraphQL)"]
    Enroll["Enroll<br/>(HTTP)"]
    Checkin["Checkin<br/>(HTTP)"]
    
    ProcQueue["fluxion-action-processor<br/>(Request Origin)"]
    CheckinQueue["fluxion-action-checkin<br/>(State Transition)"]
    DLQ["Shared DLQ"]
    
    Processor["Processor<br/>(Consumer)"]
    Applier["Applier<br/>(Consumer)"]
    
    Resolver -->|dispatchAction| ProcQueue
    Enroll -->|enqueue ENROLL| ProcQueue
    Checkin -->|SYSTEM_ACTIONS| CheckinQueue
    
    Processor -->|consumes REQUESTED| ProcQueue
    Processor -->|re-enqueue REGISTER/ENROLL| CheckinQueue
    Processor -->|auto-chain ACTIVATE| ProcQueue
    
    Applier -->|consumes REQUESTED (device-ack)| CheckinQueue
    Applier -->|consumes REQUESTED (server-applied)| CheckinQueue
    
    ProcQueue -->|failed| DLQ
    CheckinQueue -->|failed| DLQ
    
    style ProcQueue fill:#fff9c4
    style CheckinQueue fill:#fff9c4
    style Processor fill:#f3e5f5
    style Applier fill:#fce4ec
```

**Why two queues?** AWS EventSource Mapping (ESM) filtering on a shared queue races: a non-matching ESM marks the message as processed and deletes it **before** the matching ESM can poll. Two queues eliminate the race by ensuring each consumer has its own queue.

## Device State Machine

```mermaid
stateDiagram-v2
    direction TB
    
    [*] --> IDLE: UPLOAD (inline)
    IDLE --> REGISTERED: REGISTER (system)
    REGISTERED --> ENROLLED: ENROLL (system)
    ENROLLED --> ACTIVE: ACTIVATE (auto-chained after ENROLL)
    
    ACTIVE --> LOCKED: LOCK (device-bound)
    LOCKED --> ACTIVE: UNLOCK (device-bound)
    
    ACTIVE --> RELEASED: RELEASE_FROM_ACTIVE (device-bound)
    LOCKED --> RELEASED: RELEASE_FROM_LOCKED (device-bound)
    
    ACTIVE --> ACTIVE: NOTIFY_FROM_ACTIVE (in-place)
    LOCKED --> LOCKED: NOTIFY_FROM_LOCKED (in-place)
    
    RELEASED --> [*]
    
    note right of IDLE
        Device created with IMEI
    end note
    
    note right of REGISTERED
        IMEI validated, api_key issued
    end note
    
    note right of ENROLLED
        Device enrolled, awaiting activation
    end note
    
    note right of ACTIVE
        Device active, ready for commands
    end note
    
    note right of LOCKED
        Device locked, device owner can unlock
    end note
    
    note right of RELEASED
        Device retired, no checkins accepted
    end note
```

## Milestone Audit Trail

Every state transition is recorded as an immutable **milestone** row:

```
Device lifecycle (canonical 10-milestone onboarding):
1. UPLOAD (IDLE → IDLE) — UPLOAD-APPLIED [sync, inline]
2. REGISTER (IDLE → REGISTERED) — REGISTER-REQUESTED [processor]
3. REGISTER (same) — REGISTER-APPLIED [applier, system-applied]
4. ENROLL (REGISTERED → ENROLLED) — ENROLL-REQUESTED [processor]
5. ENROLL (same) — ENROLL-APPLIED [applier, system-applied]
6. ACTIVATE (ENROLLED → ACTIVE) — ACTIVATE-REQUESTED [processor, auto-chained]
7. ACTIVATE (same) — ACTIVATE-APPLIED [applier, device-ack]
8. (Device lives in ACTIVE, issuing LOCK/UNLOCK/NOTIFY/RELEASE as needed)
9. RELEASE_FROM_ACTIVE (ACTIVE → RELEASED) — RELEASE_FROM_ACTIVE-REQUESTED [processor]
10. RELEASE_FROM_ACTIVE (same) — RELEASE_FROM_ACTIVE-APPLIED [applier, device-ack]
```

**Milestone schema**:
```sql
CREATE TABLE milestones (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL,
    action_id VARCHAR NOT NULL,      -- e.g., "REGISTER", "LOCK"
    command_id VARCHAR NOT NULL,     -- unique per REQUESTED, used for idempotency
    type VARCHAR NOT NULL,           -- "REQUESTED", "APPLIED", "FAILED"
    status VARCHAR,                  -- "SUCCESS" (for APPLIED/FAILED)
    actor VARCHAR,                   -- "OPERATOR", "SYSTEM", "DEVICE"
    applied_by VARCHAR,              -- "DEVICE", "SYSTEM" (for APPLIED only)
    payload JSONB,                   -- action details, command result
    created_at TIMESTAMP NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX ON milestones(device_id, created_at DESC);
CREATE INDEX ON milestones(device_id, action_id, command_id);
```

## Concurrency Model: Single-Flight Lock

```mermaid
sequenceDiagram
    participant Admin
    participant Resolver
    participant Processor
    participant DB as PostgreSQL
    participant Applier
    
    Admin->>Resolver: dispatchAction(device_id=1, action=LOCK)
    Resolver->>DB: INSERT INTO milestones (REQUESTED, device_id=1, action=LOCK)
    Resolver->>Resolver: enqueue LOCK to processor queue
    
    Processor->>DB: SELECT FOR UPDATE FROM devices WHERE id=1
    DB->>Processor: {id: 1, assigned_action_id: NULL}
    
    Note over Processor: assigned_action_id is NULL → first action<br/>claim the lock
    Processor->>DB: UPDATE devices SET assigned_action_id='action_lock_1'<br/>WHERE id=1 AND assigned_action_id IS NULL
    DB->>Processor: OK (1 row updated)
    
    Processor->>DB: INSERT INTO milestones (REQUESTED, device_id=1)
    Processor->>Processor: send FCM wake push
    Processor->>DB: COMMIT
    
    Note over Processor,Applier: Device is now locked<br/>assigned_action_id='action_lock_1'
    
    par Concurrent request
        Admin->>Resolver: dispatchAction(device_id=1, action=UNLOCK)
        Resolver->>Resolver: enqueue UNLOCK to processor queue
    end
    
    Processor->>DB: SELECT FOR UPDATE FROM devices WHERE id=1
    DB->>Processor: {id: 1, assigned_action_id: 'action_lock_1'} (still LOCK, not UNLOCK)
    
    Note over Processor: assigned_action_id != 'action_unlock' → device busy<br/>drop silently (no REQUESTED written)
    Processor->>Processor: skip this message
    
    par Device responds
        Processor->>DB: (device acks LOCK via /v1/checkin)
    end
    
    Applier->>DB: SELECT FOR UPDATE FROM devices WHERE id=1
    Applier->>DB: INSERT INTO milestones (APPLIED, device_id=1)
    Applier->>DB: UPDATE devices SET current_state_id=LOCKED, assigned_action_id=NULL
    Applier->>DB: COMMIT
    
    Note over Applier: Lock cleared, device state flipped<br/>next action can proceed
```

## Processor → Applier Routing

The Processor classifies actions and routes them:

```mermaid
graph TD
    Processor["Processor<br/>(SQS Consumer)"]
    
    Decision{"Action<br/>Classification"}
    
    SystemAction["SYSTEM_ACTIONS<br/>(REGISTER, ENROLL)"]
    DeviceAction["DEVICE_BOUND_ACTIONS<br/>(ACTIVATE, LOCK, UNLOCK,<br/>NOTIFY, RELEASE)"]
    
    ReEnqueue["Re-enqueue to<br/>fluxion-action-checkin<br/>(Applier applies)"]
    FCMPush["FCM wake=true push<br/>(Device acks via<br/>/v1/checkin)"]
    
    Processor -->|Action from request| Decision
    
    Decision -->|REGISTER, ENROLL| SystemAction
    SystemAction -->|No device ack needed| ReEnqueue
    
    Decision -->|ACTIVATE, LOCK, UNLOCK,<br/>NOTIFY_*, RELEASE_*| DeviceAction
    DeviceAction -->|Send push| FCMPush
    
    style Processor fill:#f3e5f5
    style SystemAction fill:#fff9c4
    style DeviceAction fill:#fff9c4
    style ReEnqueue fill:#e0f2f1
    style FCMPush fill:#ffe0b2
```

## Request Flow: Device Enrollment (ENROLL)

```mermaid
sequenceDiagram
    participant Device
    participant Enroll as "Enroll Lambda<br/>(HTTP)"
    participant ProcQ as "Processor Queue<br/>(SQS)"
    participant Processor
    participant CheckinQ as "Checkin Queue<br/>(SQS)"
    participant Applier
    participant DB as "PostgreSQL"
    
    Note over Device,DB: Step 1: POST /v1/enroll (Device → Enroll Lambda)
    Device->>Enroll: POST /v1/enroll {imei: "012345678901234"}
    
    Enroll->>DB: SELECT FROM devices WHERE imei = ?
    DB->>Enroll: Device (state: REGISTERED)
    
    Enroll->>Enroll: Generate api_key ("mdm_live_" + 32 bytes)
    Enroll->>Enroll: Compute SHA-256 hash of api_key
    
    Enroll->>DB: BEGIN TRANSACTION
    Enroll->>DB: UPDATE devices SET api_key_hash = ?, provisioned_at = NOW()
    Enroll->>DB: COMMIT
    
    Enroll->>Enroll: After commit: enqueue ENROLL
    Enroll->>ProcQ: {target_service: "processor", action: "ENROLL", device_id: 1}
    Enroll->>Device: 200 OK {api_key: "mdm_live_abc..."}
    
    Note over Device,Applier: Step 2: Processor consumes ENROLL
    Processor->>ProcQ: consume message
    
    Processor->>DB: SELECT FOR UPDATE FROM devices WHERE id = 1
    DB->>Processor: {id: 1, assigned_action_id: NULL}
    
    Processor->>DB: UPDATE devices SET assigned_action_id = "action_enroll_1"
    Processor->>DB: INSERT INTO milestones (type: "REQUESTED", action: "ENROLL", device_id: 1)
    Processor->>DB: COMMIT
    
    Processor->>Processor: ENROLL is SYSTEM_ACTION → re-enqueue
    Processor->>CheckinQ: {target_service: "checkin", ...}
    
    Note over Applier,DB: Step 3: Applier consumes ENROLL
    Applier->>CheckinQ: consume message
    
    Applier->>DB: SELECT FOR UPDATE FROM devices WHERE id = 1
    Applier->>DB: UPDATE devices SET current_state_id = "ENROLLED", assigned_action_id = NULL
    Applier->>DB: INSERT INTO milestones (type: "APPLIED", action: "ENROLL", ...)
    Applier->>DB: COMMIT
    
    Applier->>Applier: ENROLL is in AUTO_CHAIN_AFTER_APPLIED → enqueue ACTIVATE
    Applier->>ProcQ: {target_service: "processor", action: "ACTIVATE", device_id: 1}
    
    Note over Device,DB: Step 4: Processor consumes auto-chained ACTIVATE
    Processor->>ProcQ: consume message
    
    Processor->>DB: SELECT FOR UPDATE FROM devices WHERE id = 1
    DB->>Processor: {id: 1, assigned_action_id: NULL}
    
    Processor->>DB: UPDATE devices SET assigned_action_id = "action_activate_1"
    Processor->>DB: INSERT INTO milestones (type: "REQUESTED", action: "ACTIVATE", device_id: 1)
    Processor->>DB: COMMIT
    
    Processor->>Processor: ACTIVATE is DEVICE_BOUND → send FCM wake
    Processor->>Device: FCM wake=true push
    
    Note over Device,DB: Step 5: Device receives FCM, checks in
    Device->>Device: Receive FCM wake, trigger check-in
    Device->>Applier: POST /v1/checkin (pull pending command)
    
    Note over Device,DB: (Checkin Lambda handles check-in, see next diagram)
```

## Request Flow: Device Check-in (PULL + ACK)

```mermaid
sequenceDiagram
    participant Device
    participant Checkin as "Checkin Lambda<br/>(HTTP)"
    participant CheckinQ as "Checkin Queue<br/>(SQS)"
    participant Applier
    participant DB as "PostgreSQL"
    
    Note over Device,DB: PULL: Get pending command
    Device->>Checkin: POST /v1/checkin {no command_result}
    
    Checkin->>DB: SELECT FROM devices WHERE api_key_hash = ?
    DB->>Checkin: Device (state: ACTIVE, assigned_action_id: "action_activate_1")
    
    Checkin->>DB: SELECT FROM milestones<br/>WHERE device_id = 1 AND type = "REQUESTED"<br/>ORDER BY created_at DESC LIMIT 1
    DB->>Checkin: ACTIVATE-REQUESTED milestone {command_id: "cmd_123", action: "ACTIVATE"}
    
    Checkin->>Checkin: Never return SYSTEM_ACTIONS (REGISTER, ENROLL)
    Checkin->>DB: UPDATE devices SET last_checkin_at = NOW()
    
    Checkin->>Device: 200 OK {command: {action: "ACTIVATE", command_id: "cmd_123"}, next_checkin_in: 60}
    
    Note over Device,DB: Device executes ACTIVATE (acquires Device Owner lock, etc.)
    
    Note over Device,DB: ACK: Send command result back
    Device->>Checkin: POST /v1/checkin {command_result: {command_id: "cmd_123", result: "SUCCESS"}}
    
    Checkin->>DB: SELECT FROM devices WHERE api_key_hash = ?
    DB->>Checkin: Device (state: ACTIVE, assigned_action_id: "action_activate_1")
    
    Checkin->>Checkin: Validate command_id matches latest REQUESTED
    Checkin->>DB: SELECT FROM milestones WHERE command_id = "cmd_123" AND type = "REQUESTED"
    DB->>Checkin: ACTIVATE-REQUESTED {device_id: 1}
    
    Checkin->>Checkin: Validation passed
    Checkin->>Checkin: Enqueue ACK to checkin queue (after commit)
    
    Checkin->>DB: BEGIN
    Checkin->>DB: UPDATE devices SET last_checkin_at = NOW()
    Checkin->>DB: COMMIT
    
    Checkin->>CheckinQ: {target_service: "checkin", device_id: 1, command_id: "cmd_123", result: "SUCCESS"}
    Checkin->>Device: 200 OK {next_checkin_in: 3600}
    
    Note over Applier,DB: Applier consumes ACK
    Applier->>CheckinQ: consume message
    
    Applier->>DB: SELECT FOR UPDATE FROM devices WHERE id = 1
    DB->>Applier: {id: 1, assigned_action_id: "action_activate_1"}
    
    Applier->>DB: SELECT FROM milestones WHERE command_id = "cmd_123" AND type = "REQUESTED"
    DB->>Applier: ACTIVATE-REQUESTED {action_id: "action_activate_1"}
    
    Applier->>Applier: Ack matches lock, check for idempotency
    Applier->>DB: SELECT FROM milestones WHERE device_id = 1 AND created_at > ACTIVATE-REQUESTED.created_at AND type IN ("APPLIED", "FAILED")
    DB->>Applier: (empty) → no previous APPLIED/FAILED yet
    
    Applier->>DB: INSERT INTO milestones (type: "APPLIED", action: "ACTIVATE", ..., applied_by: "DEVICE")
    Applier->>DB: UPDATE devices SET current_state_id = "ACTIVE", assigned_action_id = NULL
    Applier->>DB: COMMIT
    
    Applier->>Applier: ACTIVATE not in AUTO_CHAIN_AFTER_APPLIED → no auto-chain
    
    Note over Device,DB: Device is now in ACTIVE state, lock cleared
```

## Idempotency: Stale ACK Redelivery

```mermaid
sequenceDiagram
    participant Applier
    participant DB as "PostgreSQL"
    
    Note over Applier,DB: Scenario: Device-bound action repeats, stale ack redelivered
    
    Note over Applier,DB: Cycle 1: LOCK (action_id=5)
    Note over Applier,DB: Processor writes LOCK-REQUESTED {action_id=5, command_id=cmd_1}
    Note over Applier,DB: Device acks cmd_1 → Applier writes LOCK-APPLIED
    Note over Applier,DB: (unlock follows...)
    
    Note over Applier,DB: Cycle 2: LOCK again (action_id=5 reused!)
    Note over Applier,DB: Processor writes LOCK-REQUESTED {action_id=5, command_id=cmd_2}
    
    Note over Applier,DB: ↓ Stale SQS redelivery: ack(cmd_1) re-queued
    
    Applier->>DB: SELECT FOR UPDATE FROM devices WHERE id = 1
    DB->>Applier: {assigned_action_id: 5 (cmd_2 in flight, not cmd_1)}
    
    Applier->>DB: SELECT FROM milestones WHERE command_id = "cmd_1" AND type = "REQUESTED"
    DB->>Applier: cmd_1-REQUESTED {created_at: T1}
    
    Applier->>Applier: Check idempotency: is there an APPLIED/FAILED after cmd_1-REQUESTED?
    Applier->>DB: SELECT FROM milestones WHERE device_id = 1 AND created_at > T1 AND type IN ("APPLIED", "FAILED")
    DB->>Applier: (yes) cmd_1-APPLIED {created_at: T2}
    
    Applier->>Applier: Already applied! Idempotent no-op, don't touch the lock
    Note over Applier: Lock is held by cmd_2, leave it alone
    
    Applier->>DB: (no writes)
```

## Lambda Request/Response Examples

### Resolver (GraphQL)

**Request** (AppSync context):
```json
{
  "parentValue": null,
  "args": {"deviceId": 1, "action": "LOCK"},
  "identity": {"claims": {"sub": "user-123"}},
  "request": {"headers": {...}}
}
```

**Handler routes by fieldName**:
- `uploadImei` → `resolvers/device.py:uploadImei()`
- `dispatchAction` → `resolvers/action.py:dispatchAction()`
- `listDevices` → `resolvers/device.py:listDevices()`

**Response**:
```json
{
  "action_id": "action_lock_1",
  "device_id": 1,
  "status": "REQUESTED"
}
```

### Checkin (HTTP)

**PULL Request**:
```json
POST /v1/checkin
Authorization: Bearer mdm_live_abc...
X-Device-IMEI: 012345678901234

{
  "info": {"device_name": "Samsung Galaxy", "os_version": "14.0"}
}
```

**PULL Response**:
```json
{
  "command": {
    "action": "LOCK",
    "command_id": "cmd_123",
    "payload": {}
  },
  "next_checkin_in": 60
}
```

**ACK Request**:
```json
POST /v1/checkin
Authorization: Bearer mdm_live_abc...

{
  "command_result": {
    "command_id": "cmd_123",
    "result": "SUCCESS"
  }
}
```

**ACK Response**:
```json
{
  "next_checkin_in": 3600
}
```

### Enroll (HTTP)

**Request**:
```json
POST /v1/enroll
{
  "imei": "012345678901234"
}
```

**Response**:
```json
{
  "api_key": "mdm_live_def...",
  "device_id": 1
}
```

## Error Handling

All Lambdas raise `AppError` subclasses with UPPER_SNAKE codes:

**AppError hierarchy**:
- `BadRequest` (400) — invalid input (bad IMEI, malformed JSON)
- `Unauthorized` (401) — missing/invalid api_key
- `Forbidden` (403) — device RELEASED
- `NotFound` (404) — device not found
- `Conflict` (409) — device already enrolled
- `InternalError` (500) — database error, unexpected state

**Resolver** (GraphQL error):
```json
{
  "errorType": "AppError",
  "errorMessage": "IMEI must be 15 digits",
  "extensions": {
    "code": "INVALID_IMEI"
  }
}
```

**HTTP Lambdas** (JSON error):
```json
{
  "error_code": "INVALID_IMEI",
  "message": "IMEI must be 15 digits",
  "retry_strategy": {"retry": false}
}
```

**SQS** (batch failures):
```json
{
  "batchItemFailures": [
    {
      "itemId": "message_id_123",
      "reason": "InvalidPayload"
    }
  ]
}
```
