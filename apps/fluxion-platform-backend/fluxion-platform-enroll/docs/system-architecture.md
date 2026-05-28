# Fluxion Enroll — System Architecture

## Position in Fluxion Pipeline

Fluxion is an AWS-native Android MDM (Device Policy Controller) fleet management platform. Device state machine: REGISTERED → ENROLLED → ACTIVE → LOCKED/UNLOCK/RELEASE.

**Enroll Lambda's Role:** Device-initiated enrollment gateway. Sits at the device's second interaction (after factory reset + EULA acceptance). Issues per-device api_key and enqueues the ENROLL action into the processor-checkin SQS pipeline for downstream state transition.

```
┌─────────────────────────────────────────────────────────────┐
│ Fluxion Deployment                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Admin Console (React)  ←→  AppSync GraphQL Resolver       │
│                                ↓ (dispatchAction mutation) │
│                                └──→ processor queue        │
│                                                             │
│  Device (Android DPC)  ──→  Enroll Lambda (THIS MODULE)    │
│                           ↓                                 │
│                processor queue → Processor                  │
│                           ↓                                 │
│                checkin queue → Applier (state writer)       │
│                                                             │
│  Device (Android DPC)  ←→  Checkin Lambda (HTTP /v1/checkin)│
│                           ↓ (device acks)                  │
│                checkin queue → Applier                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Request Flow: POST /v1/enroll

**Happy Path (synchronous enroll request):**

```
Device (POST /v1/enroll)
│
├─ Body: {imei, device_info, fcm_token?}
│
v
Enroll Lambda (handler.py)
│
├─ 1. Validate IMEI (15 digits)
│    └─ 400 INVALID_IMEI_FORMAT if bad
│
├─ 2. Validate device_info is dict
│    └─ 400 MISSING_FIELD if not
│
├─ 3. Database lock_device_by_imei (FOR UPDATE)
│    └─ 404 DEVICE_NOT_FOUND if missing
│
├─ 4. Check current_state_id == REGISTERED.id
│    └─ 409 INVALID_STATE if ENROLLED/ACTIVE/LOCKED
│
├─ 5. Generate api_key (mdm_live_<32-char>)
│    ├─ Store SHA-256 hash in database
│    ├─ Return plaintext to device (only time!)
│
├─ 6. Update device fields (atomically in transaction):
│    ├─ api_key_hash ← SHA-256(api_key)
│    ├─ fcm_token ← from request
│    ├─ info ← device_info dict
│    ├─ first_checkin_at ← now (if unset)
│    └─ last_checkin_at ← now
│
└─ 7. Response to device (200 OK):
   {
     device_id,
     api_key (plaintext),
     checkin_endpoint,
     checkin_interval: 3600,
     server_time
   }

After DB commit (before HTTP 200 returns):
│
├─ 8. Enqueue ENROLL to processor queue
│    ├─ target_service: "processor"
│    ├─ device_id
│    ├─ action_id (ENROLL action)
│    ├─ extras: {branch: "enroll"}
│    └─ Return MessageId logged
```

**Key Safety Properties:**
- Device lock (FOR UPDATE) prevents concurrent enrollments.
- State check (== REGISTERED) prevents re-enrollment (409 on ENROLLED/ACTIVE).
- SQS enqueue outside transaction (fire-and-forget after commit).
- api_key plaintext returned exactly once; device must store locally.

## Async Pipeline (After Enroll Returns 200)

Device receives api_key and checkin_endpoint, but state transition happens asynchronously:

```
┌─────────────────────────────────────────┐
│ Enroll Lambda (completes)               │
│ └─ Enqueues ENROLL → processor queue   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Processor Lambda (SQS consumer)         │
│ ├─ Lock device (FOR UPDATE)             │
│ ├─ Write REQUESTED milestone            │
│ │  └─ event_type: REQUESTED             │
│ │  └─ action_id: ENROLL                 │
│ │  └─ payload: {branch: enroll}         │
│ ├─ Set assigned_action_id = enroll_id  │
│ └─ Enqueue ENROLL → checkin queue      │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Applier Lambda (sole SQS consumer of    │
│ the checkin queue; single state writer) │
│ ├─ Lock device (FOR UPDATE)             │
│ ├─ Write APPLIED milestone              │
│ │  └─ event_type: APPLIED               │
│ │  └─ from_state_id: REGISTERED.id      │
│ │  └─ to_state_id: ENROLLED.id          │
│ ├─ Flip state: REGISTERED → ENROLLED    │
│ │  └─ UPDATE devices SET current_state_ │
│ │     id = ENROLLED.id                  │
│ ├─ Auto-chain: Enqueue ACTIVATE         │
│ │  └─ (Auto_chain_after_applied rules)  │
│ └─ Clear assigned_action_id             │
└─────────────────────────────────────────┘
                    ↓
    [Device has not yet checked in]
    [Only after device POST /v1/checkin]
    [does it receive ACTIVATE command]
```

**Scope Split:**
- **Enroll Lambda (this module):** validates + issues api_key, enqueues ENROLL
- **Processor Lambda:** originates lock + REQUESTED milestone, re-enqueues to checkin queue
- **Checkin Lambda:** HTTP-only (POST /v1/checkin); receives device acks, enqueues them to checkin queue — no SQS consumer
- **Applier Lambda:** sole consumer of checkin queue; single transition writer — APPLIED milestone + state flip + ACTIVATE auto-chain

## Data Model: Key Tables

**Devices Table:**
```sql
-- from scripts/db/migrations/versions/0001_init_schema.py
CREATE TABLE devices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  imei                char(15)    NOT NULL UNIQUE,
  tac_id              uuid        NOT NULL REFERENCES tacs(id) ON DELETE RESTRICT,
  service_id          uuid        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  current_state_id    uuid        NOT NULL REFERENCES states(id) ON DELETE RESTRICT,
  assigned_action_id  uuid        REFERENCES actions(id) ON DELETE SET NULL,
  api_key_hash        text,       -- SHA-256 hex
  fcm_token           text,
  info                jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- device_info from enroll
  first_checkin_at    timestamptz,
  last_checkin_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  deleted_at          timestamptz,
  CONSTRAINT chk_imei_digits CHECK (imei ~ '^[0-9]{15}$')
);
```

**Enroll's Writes:**
```
UPDATE devices
SET
  api_key_hash = %(hash)s,
  fcm_token = %(token)s,
  info = %(info)s::jsonb,
  first_checkin_at = COALESCE(first_checkin_at, %(now)s),
  last_checkin_at = %(now)s
WHERE id = %(device_id)s;
```

**States Table (lookup):**
```sql
SELECT id FROM states WHERE type = 'REGISTERED' AND deleted_at IS NULL;
```

**Actions Table (lookup):**
```sql
SELECT id FROM actions WHERE type = 'ENROLL' AND deleted_at IS NULL;
```

**Milestones Table (NOT written by enroll):**
Processor writes REQUESTED; Applier writes APPLIED/FAILED. Enroll does not touch milestones.

## SQS Topology

**Two Physical Queues, One Consumer Each:**
1. `fluxion-action-processor` — enqueued by resolver, checkin, enroll, and applier (auto-chain); consumed by processor
2. `fluxion-action-checkin` — enqueued by processor (server-applied actions) and checkin HTTP (device acks); consumed solely by applier

No message filtering is used. ESM filtering on a shared queue races — the non-matching event source mapping treats messages as processed and deletes them before the matching one can poll. Two queues with exactly one consumer each eliminate the race (see `../../README.md`).

**Enroll's SQS Contract:**
```json
{
  "target_service": "processor",
  "device_id": "device-uuid",
  "action_id": "enroll-action-uuid",
  "command_id": null,
  "template_id": null,
  "requested_by_id": null,
  "extras": {
    "branch": "enroll"
  }
}
```

## Transaction Boundaries

**Enroll Transaction (atomic):**
```python
with db.conn.transaction():
    device = db.lock_device_by_imei(imei)  # FOR UPDATE
    # Check state, generate api_key, update device
    db.update_device_fields(device["id"], ...)
    # COMMIT happens here
# Outside transaction: enqueue
enqueue_action(TARGET_PROCESSOR, ...)
```

**Why this order:**
- If enqueue fails, device updates already committed (no rollback).
- If update fails, no SQS message sent (device locked but not enrolled).
- Device sees api_key before processor starts (safe; api_key was stored before enqueue).

## Concurrency & Locking

**Device Lock:**
```sql
SELECT ... FROM devices WHERE id = ... FOR UPDATE
```
- Exclusive lock; other transactions on same device block.
- Released at transaction commit/rollback.
- Prevents concurrent ENROLL on same device (first one wins, second gets 409 INVALID_STATE).

**No Deadlock Scenarios:**
- Enroll locks device, updates, commits (short transaction).
- Processor locks device after enqueue (separate transaction).
- Applier locks device after processor (separate transaction).
- No circular waits (always lock device in same order: by ID/IMEI).

## Error Paths

**1xx-2xx (Client Error):**
- `400 INVALID_IMEI_FORMAT` — client retries after data fix; non-retryable
- `400 MISSING_FIELD` — client retries after data fix; non-retryable
- `404 DEVICE_NOT_FOUND` — client fails; device not in system (non-retryable)
- `409 INVALID_STATE` — client fails; device already enrolled (non-retryable)

**5xx (Server Error, Retryable):**
- `500 INTERNAL_ERROR` — database down, SQS down, Secrets Manager down
- Device applies exponential backoff (5s, 10s, 20s, ... up to 5 attempts)

## API Key Security Model

**Generation:**
- `secrets.token_urlsafe(32)` → strip `-_` → truncate to 32 chars
- Prefix `mdm_live_` → plaintext: `mdm_live_<32-char-random>`
- Hash: `SHA-256(plaintext)` → store only hex string

**Storage:**
- Device stores plaintext locally (encrypted on device storage by Android)
- Server stores only SHA-256 hash (irreversible)
- No recovery path if device loses key (must factory reset)

**Validation (by checkin Lambda):**
```python
token = auth_header[7:]  # "Bearer mdm_live_..."
key_hash = SHA-256(token)
device = db.query("SELECT ... WHERE api_key_hash = ?", key_hash)
```

## Re-enrollment Policy

**Not Supported by Design:**
- ENROLLED/ACTIVE device → 409 INVALID_STATE
- Safe because:
  - DPC policy hard-disables app uninstall on EULA accept
  - Factory-reset also disabled via DPC provisioning
  - Device never loses local api_key (no re-enroll flow)
  
**If DPC Policy Changes:**
- Requires design review (how to handle api_key loss)
- Current implementation would need a separate `/v1/re-enroll` endpoint
- Would need `api_key_hash = NULL` to re-enter REGISTERED state
- Not implemented; deferred pending business decision

## Deployment Context

**CDK Integration:**
- Enroll Lambda defined in `infra/lib/constructs/lambdas-construct.ts` (single stack: `infra/lib/fluxion-stack.ts`)
- Docker-bundles this directory (`fluxion-platform-enroll/`) as self-contained asset
- No shared package dependency; shared files copied to each Lambda dir
- 5 independently bundled Lambda functions (resolver, processor, checkin, enroll, applier)

**Environment:**
```bash
# Local dev (from monorepo root)
npm run db:up && npm run db:migrate

# Deploy
npm run infra:deploy
```

## Related Services

**PostgreSQL 15:**
- `devices`, `states`, `actions`, `milestones` tables
- Shared across all 5 Lambdas
- Single cached module-global connection per Lambda container (no pooler)

**SQS:**
- `fluxion-action-processor` queue (enroll enqueues here)
- `fluxion-action-checkin` queue (consumed solely by applier; enroll never touches it)

**AWS Secrets Manager:**
- Database credentials (DB_SECRET_ARN) — used when DATABASE_URL unset
- DPC shared key (DPC_SHARED_KEY_SECRET_ARN) — helper exists in shared `auth.py`; unused by the enroll route

**AWS CloudWatch:**
- Logs from Lambda (automatic)
- Custom metrics via config.logger (JSON format)

## Monitoring & Observability

**Logs (CloudWatch via Lambda stdout):**
- `config.py` sets root logger at import (level from LOG_LEVEL env var, default INFO); shared `fluxion` logger
- SQS enqueue logged with target, device_id, action_id, MessageId (`sqs_client.py`)
- Plain-text log lines (no structured/JSON logging implemented)

**Client retry contract:**
- 5xx errors → `retry_strategy` in error body tells device to retry (backoff 5s, max 5 attempts)
- 4xx errors → non-retryable; client must fix request data
