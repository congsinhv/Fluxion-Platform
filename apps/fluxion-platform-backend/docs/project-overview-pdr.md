# Fluxion Backend — Project Overview & Product Development Requirements

## Project Overview

**Fluxion Backend** is the serverless data and event pipeline for Fluxion, an AWS-native Mobile Device Management (MDM) platform targeting Android Device Owner (DPC) fleets. It implements a strictly serialized state machine for device lifecycle management (onboarding, locking, unlocking, release) with full auditability and single-flight concurrency control.

### Platform Objective

Enable organizations to remotely manage, monitor, and control corporate-owned Android devices provisioned as Device Owner, with an immutable audit trail of every action and a 3-second command delivery latency via Firebase Cloud Messaging (FCM) wake pushes.

### Core Value Propositions

1. **Strict serializability** — Database-level `FOR UPDATE` lock prevents conflicting actions racing on the same device.
2. **Complete auditability** — Every state transition is recorded as an immutable milestone with actor, timestamp, and payload.
3. **Event-driven delivery** — FCM `wake=true` push prompts immediate device check-in instead of polling.
4. **Configuration-driven** — States, actions, and message templates seeded via Alembic migrations, not hard-coded.
5. **Serverless simplicity** — Five independently deployable Lambda functions; no servers to operate.

## Architecture Summary

### Backend Shape

Five self-contained Python 3.12 Lambda functions:

| Lambda | Role | Trigger |
|--------|------|---------|
| **Resolver** | GraphQL field dispatch (admin console queries/mutations) | AppSync direct invocation |
| **Processor** | Sole request-initiator; lock acquisition + FCM routing | SQS queue `fluxion-action-processor` |
| **Checkin** | Device command pull and acknowledgment gateway | HTTP `POST /v1/checkin` (FastAPI + Mangum) |
| **Enroll** | Device api_key issuance and enrollment flow | HTTP `POST /v1/enroll` (FastAPI + Mangum) |
| **Applier** | **Sole transition writer** — state flips, lock release, auto-chaining | SQS queue `fluxion-action-checkin` |

### Key Invariants

1. **Single-flight lock**: `devices.assigned_action_id` ensures only one action is in-flight per device at any moment.
2. **Two SQS queues**: Separate queues prevent AWS ESM filtering races on a shared queue.
3. **Sole transition writer**: Only the Applier Lambda writes APPLIED/FAILED milestones and flips device state.
4. **Idempotent acknowledgments**: Device acks are deduplicated by `command_id` (scoped to the REQUESTED milestone), not action_id (device-bound actions repeat across lifecycle).

### Device State Machine

```
IDLE → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED
```

Canonical onboarding path: 10 immutable milestones (UPLOAD, REGISTER, ENROLL, ACTIVATE, then ready for LOCK/UNLOCK cycles, finally RELEASE).

## Product Development Requirements (PDR)

### Functional Requirements

#### FR-1: State Machine Enforcement
- The backend must enforce a strictly defined device state machine with exactly six states: IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED.
- All state transitions must be persisted as immutable **milestone** rows with REQUESTED, APPLIED, or FAILED status.
- Invalid transitions (e.g., LOCKED → ENROLLED) must be rejected synchronously.

#### FR-2: Single-Flight Concurrency Control
- Exactly one action must be in-flight per device at any time, enforced at the database level via `devices.assigned_action_id` with `SELECT ... FOR UPDATE` and `WHERE assigned_action_id IS NULL` conditions.
- Concurrent requests for the same device must either succeed (if no action is in-flight) or be silently dropped (if one is already in-flight).

#### FR-3: Action Routing
- Actions must be routed based on classification:
  - **UPLOAD**: Inline synchronous execution in the Resolver Lambda.
  - **REGISTER, ENROLL**: Server-applied via Processor → Applier (no FCM, no device ack).
  - **ACTIVATE, LOCK, UNLOCK, NOTIFY, RELEASE**: Device-bound via Processor (FCM wake) → device `/v1/checkin` ack → Applier.
- Routing logic lives in `constants.py` and must not be duplicated or hard-coded elsewhere.

#### FR-4: Device Enrollment (API)
- `POST /v1/enroll` must validate a 15-digit IMEI, confirm the device is in REGISTERED state, generate a unique api_key (`mdm_live_` prefix), and store only the SHA-256 hash.
- Re-enrollment of an already ENROLLED device must return 409 Conflict (safe only because DPC disables factory reset).
- Enrollment is asynchronous: the endpoint returns the api_key synchronously but the state flip (REGISTERED → ENROLLED → ACTIVE) is async via the SQS pipeline.

#### FR-5: Device Check-in (API)
- `POST /v1/checkin` must support two mutually exclusive operations:
  - **PULL**: Return the pending command from the latest REQUESTED milestone (heartbeat + `last_checkin_at` update); never return SYSTEM_ACTIONS.
  - **ACK**: Validate the command result and enqueue to the applier queue for state transition; must be idempotent via `command_id` deduplication.
- Devices authenticate with bearer api_key; optional `X-Device-IMEI` header is cross-checked.
- RELEASED devices must be rejected with 403.

#### FR-6: Idempotent Acknowledgments
- Device acknowledgments must be deduplicated by `command_id` (scoped to the REQUESTED milestone), not action_id.
- A stale SQS redelivery of an ack for a device-bound action from an earlier cycle must result in a no-op (the action_id may be reused in a later cycle).
- Idempotency must not interfere with the single-flight lock for the current in-flight action.

#### FR-7: Auto-Chaining
- After the Applier writes APPLIED for ENROLL (server-applied), it must automatically enqueue ACTIVATE (device-bound) to the Processor queue.
- Auto-chain must run after the database transaction commits (state durable first).
- Auto-chain must be guarded by a "chain already started" milestone check to prevent duplicate ACTIVATE in case of Applier crash + redelivery.

#### FR-8: Complete Audit Trail
- Every action lifecycle (REQUESTED → APPLIED or FAILED) must be recorded with:
  - Milestone type (REQUESTED, APPLIED, FAILED)
  - Status (SUCCESS, FAILURE)
  - Actor (OPERATOR, SYSTEM, DEVICE)
  - Timestamps (ISO-8601 UTC)
  - Payload (action details, device response, error message)

#### FR-9: Configuration-Driven Actions & States
- States, actions, transitions, and message templates must be seeded via Alembic database migrations (repo root `scripts/db/migrations/`), not hard-coded.
- The admin console and backend must read the state machine from the database, enabling runtime customization.

#### FR-10: Remote Command Delivery (~3s latency)
- Device-bound commands must be delivered via Firebase Cloud Messaging (FCM) with `wake=true` to prompt immediate check-in.
- The Processor Lambda must never raise on FCM failure; failure is a no-op (device polls eventually).

### Non-Functional Requirements

#### NFR-1: Concurrency & Idempotency
- All SQS messages must support partial-batch retry (return `batchItemFailures` for redelivery).
- Message deduplication is NOT enabled on SQS; the application layer enforces idempotency via database checks.
- The Applier must guarantee that redelivered device acks do not create duplicate APPLIED milestones or corrupt the state machine.

#### NFR-2: Code Duplication (Intentional)
- Shared files (`config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py`) must be **copied** into each Lambda directory (no shared package).
- This design is required for CDK Docker bundling simplicity and independent deployment.
- When a shared file is edited, the developer must mirror the change across all five Lambda directories.

#### NFR-3: No Shared Package
- Do not extract a `shared/` package. CDK bundles each Lambda directory as one self-contained asset; a shared package introduces:
  - Extra Docker volume mount
  - Extra pip install step
  - Expensive `assetHashType: OUTPUT` recomputation on every change
- Accept duplication as the cost of independent deploys.

#### NFR-4: No Python Unit Tests
- The backend has no Python unit-test suite (no pytest/unittest coverage).
- Correctness is validated by end-to-end tests against a **deployed** stack.
- E2E tests verify the 10-milestone lifecycle, lock rejection under concurrency, and idempotent acks.

#### NFR-5: Eventual Consistency
- All state transitions are eventually consistent. `dispatchAction` enqueues only; state flip is async.
- Clients and tests must poll or subscribe to milestones to await state changes (no synchronous transitions).

#### NFR-6: Security
- Admin console (Resolver) uses AWS Cognito for identity.
- Device endpoints (Checkin, Enroll) use bearer api_key with SHA-256 hash stored (never plaintext).
- Secrets (DB credentials, Firebase service account) stored in AWS Secrets Manager.
- Database passwords and API keys never logged or exposed in error responses.

#### NFR-7: Performance Targets
- Command delivery latency: ~3 seconds (FCM wake push + device check-in network round-trip).
- State machine must support thousands of concurrent devices (AWS RDS and Lambda auto-scaling handle load).
- Milestone queries must use indexed lookups on `device_id` and `created_at`.

#### NFR-8: Observability
- All Lambdas log in `<service>.<event> key=value` format.
- Applier logs use historical `checkin_sqs.` prefix for continuity.
- CloudWatch Logs are the primary observability medium (no custom tracing tool).

### Acceptance Criteria

1. **State machine enforced** — Only valid transitions allowed; invalid transitions rejected synchronously.
2. **Single-flight lock holds** — Concurrent requests on the same device do not race; one succeeds, others drop.
3. **Actions route correctly** — SYSTEM_ACTIONS don't go to devices; DEVICE_BOUND_ACTIONS do go via FCM.
4. **Acks are idempotent** — Redelivered acks do not create duplicate milestones or corrupt state.
5. **Auto-chain works** — ENROLL → ACTIVATE happens automatically without admin intervention.
6. **Audit trail is complete** — Every action is recorded as a milestone with all required metadata.
7. **E2E lifecycle passes** — an end-to-end lifecycle test passes against a deployed stack (10-milestone trail, lock rejection, idempotent acks).

## Known Limitations & Future Work

### Current Scope (MVP)

- **Device enrollment**: Supports IMEI-based enrollment via `POST /v1/enroll` (production path uses QR-code provisioning, not implemented).
- **Admin console**: Cognito-authenticated React web app only (no mobile admin app).
- **Single AWS account**: No cross-account management.
- **Single region**: Deployed to `ap-southeast-1` (Singapore) only.
- **No redundancy**: Single-region deployment with no cross-region failover.

### Known Gaps

1. **Resolver Lambda lacks CLAUDE.md** — Per-Lambda guidance exists for all five but Resolver; consider adding.
2. **Stale backend README** — Partially refreshed in this doc; the original README still had "Four Lambdas" and outdated checkin/applier split description.
3. **Limited state machine runtime customization** — States and actions are seeded via migrations but not fully dynamic at runtime (schema changes require redeployment).
4. **No device-to-device messaging** — Devices can only receive commands from the admin console, not peer-to-peer actions.
5. **Manual testing focus** — E2E tests exist but are few; broader scenario coverage recommended.

## Metrics & Success Indicators

- **Concurrency correctness**: No duplicate milestone writes under concurrent device actions.
- **Ack idempotency**: Redelivered acks result in zero data corruption.
- **Availability**: E2E tests pass consistently in deployed environment.
- **Latency**: Average command delivery < 3 seconds (FCM + device round-trip).
- **Code quality**: Ruff linting passes (py312, line-length 100, rules E/F/I/UP/B).
