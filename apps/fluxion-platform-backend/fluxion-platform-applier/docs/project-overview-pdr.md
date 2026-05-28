# Applier Module — Project Overview & Product Development Requirements

## Overview

The **Applier** Lambda is the sole state-transition writer in the Fluxion MDM pipeline. It consumes the `fluxion-action-checkin` SQS queue and is responsible for writing APPLIED/FAILED milestones, flipping device state, and clearing the single-flight lock that coordinates concurrent action execution.

**Module Identity:** One of 5 self-contained Python 3.12 Lambdas; SQS-only (no HTTP surface); part of a capstone Android MDM project on AWS (region ap-southeast-1).

---

## Functional Requirements

### FR-1: Consume and Route SQS Messages
- Read from queue `fluxion-action-checkin`
- Parse JSON; skip non-"checkin" target_service; fail malformed JSON for redelivery
- Route based on message shape (device-ack vs server-applied)

### FR-2: Apply Device-Acknowledgment (Device-Ack Path)
**Trigger:** `extras.result` present (device reported command outcome via POST /v1/checkin)
- Validate device exists and lock is held by this action
- Resolve REQUESTED milestone by `command_id` (not `action_id` — actions repeat across lifecycle)
- Confirm REQUESTED is the in-flight cycle (latest for the action)
- Check idempotency: if APPLIED/FAILED already exists, clear lock and return
- **If status=SUCCESS:** Write APPLIED milestone (applied_by=DEVICE); flip state; clear lock
- **If status=FAILED:** Write FAILED milestone (applied_by=DEVICE, error payload); clear lock; no state flip
- Device-bound actions (ACTIVATE, LOCK, UNLOCK, NOTIFY_*, RELEASE_*) never auto-chain

### FR-3: Apply Server-Originated Actions (Server-Applied Path)
**Trigger:** `extras.result` absent (REGISTER, ENROLL — system-initiated, no device ack required)
- Check if APPLIED already exists (redelivery): clear lingering lock, fall through to auto-chain attempt
- Else, validate lock is held
- Acquire lock via SELECT FOR UPDATE; write APPLIED milestone (applied_by=SYSTEM); flip state; clear lock
- Log state transition

### FR-4: Auto-Chain (Post-Commit Enqueue)
- After server-applied transaction commits, check `AUTO_CHAIN_AFTER_APPLIED` map
- For ENROLL, auto-chain to ACTIVATE: generate fresh command_id, enqueue to processor queue
- Guard against double-chain: check if chained action already has REQUESTED or APPLIED
- Processor's FOR UPDATE origination is backstop against concurrent duplicates

### FR-5: Maintain Eventual Consistency
- All reads/writes within single transaction (SELECT FOR UPDATE)
- Side effects (SQS enqueue) only after commit durable
- Idempotency via `command_id` (device-ack) and APPLIED check (server-applied)
- Lock lifecycle: processor acquires, applier clears

### FR-6: Handle Batch Failures
- Return `{"batchItemFailures": [...]}` for partial-batch retry
- Skip non-"checkin" messages (not failures)
- Fail bad JSON for DLQ
- Exceptions → batch failure with full context logging

---

## Non-Functional Requirements

### NFR-1: Concurrency & Lock Management
- Single-flight lock: `devices.assigned_action_id` (WHERE NULL on acquire)
- All device access via SELECT FOR UPDATE
- Device-ack resolution keyed by `command_id` to handle repeating actions
- Stale cycle acks must not touch live cycle locks

### NFR-2: Idempotency
- Device-ack: deduplicate via command_id + latest REQUESTED check
- Server-applied: deduplicate via APPLIED milestone existence
- Auto-chain: deduplicate via existing REQUESTED/APPLIED for next action

### NFR-3: State Machine Integrity
- Transitions cross services; sync service_id from new state in same UPDATE
- Lifecycle: IDLE → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED; NOTIFY_* in-place
- Canonical onboarding = exactly 10 milestones (verified by integration tests)

### NFR-4: Observability
- Log every milestone write (device-applied, device-failed, system-applied, auto-chain)
- Log stale cycles, idempotent acks, lock mismatches, missing actions
- Format: `checkin_sqs.<event> key=value` (prefix historical, preserved for log continuity)

### NFR-5: Performance
- Single cached psycopg connection; thread-lock guarded reconnect
- Batch processing via SQS; no sequential delays
- No retries within Lambda (SQS handles redelivery)
- Transaction scope: single device; minimal lock duration

### NFR-6: Reliability
- E2E correctness verified by an end-to-end lifecycle test against deployed stack
- No unit-test suite (Lambda-specific, SQS-coupled logic not easily isolated)
- Catch all exceptions, log, batch-fail for redelivery
- Secrets Manager fallback for DB credentials

---

## Scope Boundaries

### What This Module Does
- ✅ Apply state transitions (APPLIED/FAILED milestones)
- ✅ Manage single-flight lock lifecycle
- ✅ Handle device-ack idempotency (command_id resolution)
- ✅ Auto-chain ENROLL → ACTIVATE
- ✅ Sync state/service transitions

### What This Module Does NOT Do
- ❌ Originate actions (processor + resolver + checkin + enroll do that)
- ❌ Send FCM push (processor does that)
- ❌ Validate device ack payloads (checkin Lambda validates; this consumes pre-validated messages)
- ❌ Enforce state machine rules (rules are config-driven via Alembic migrations; this only follows them)
- ❌ Handle HTTP (SQS-only; no REST endpoints)

---

## Architecture Context

### Pipeline Position
```
resolver / enroll / processor
         ↓ (enqueue)
  [fluxion-action-checkin queue]
         ↓ (THIS LAMBDA)
    ├─ Write milestone
    ├─ Flip state
    ├─ Clear lock
    └─ Auto-chain enqueue (if ENROLL)
         ↓
  [fluxion-action-processor queue]
         ↓ (processor re-originates ACTIVATE)
```

### Key Invariants
1. **Sole transition writer:** Only Lambda that writes APPLIED/FAILED and flips state.
2. **Two-queue topology:** Processor queue + checkin queue + shared DLQ (not one queue with filtering — filtering races).
3. **Single-flight lock:** `assigned_action_id` acquired by processor, cleared by applier.
4. **Command-id keyed resolution:** Device-ack matching by `command_id` (not action_id) preserves stale-cycle safety.
5. **Config-driven state machine:** States, actions, transitions in DB (Alembic migrations), not code.

---

## Success Criteria

- ✅ All SQS messages (device-ack, server-applied) processed idempotently
- ✅ Device state flips only on SUCCESS, never on FAILED
- ✅ Lock held only during transaction; cleared after commit
- ✅ Auto-chain prevents double-enqueue (guards + processor FOR UPDATE)
- ✅ Stale device-ack cycles do not corrupt live cycles' locks
- ✅ E2E lifecycle test passes (10 milestones, concurrency-lock rejection, idempotent acks)
- ✅ Redelivered messages are idempotent (no duplicate milestones, no double-chain)
- ✅ All exceptions logged with context; DLQ absorbs unparseable messages

---

## Known Limitations (Demo Phase)

- **No unit tests:** Lambda logic is SQS/DB-coupled; E2E tests via deployed stack are primary validation.
- **Polling-only clients:** Admin dashboard polls every 10s (no GraphQL subscriptions); eventual consistency model requires client-side polling.
- **Single API key per device:** No key rotation in demo; demo devices share a static shared key in BuildConfig (Android client).
- **Soft delete only:** deleted_at IS NULL in all queries; no hard deletes implemented.
- **No schema versioning:** Alembic migrations only; no backward-compatibility layer for schema changes.

---

## Related Dependencies

- **Processor Lambda:** Originates actions; acquires lock.
- **Checkin Lambda:** Validates device /checkin acks; enqueues to this queue.
- **PostgreSQL:** State machine config, device state, milestones, locks.
- **SQS:** Queue topology (fluxion-action-checkin, fluxion-action-processor, shared DLQ).
- **Alembic:** Seeds state machine (states, actions, transitions) via migrations.
- **Secrets Manager:** DB credentials, Firebase key, DPC shared key.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-07 | Initial capstone delivery; sole transition writer; auto-chain ENROLL→ACTIVATE |

---

## Acceptance Sign-Off

- **Functional:** All message paths (device-ack, server-applied, auto-chain) implemented.
- **Non-Functional:** Concurrency, idempotency, observability in place.
- **Testing:** E2E lifecycle test validates 10-milestone canonical path.
- **Demo Ready:** Module complete for capstone submission.
