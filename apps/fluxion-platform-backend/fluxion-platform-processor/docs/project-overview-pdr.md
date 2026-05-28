# Fluxion Processor Lambda — Project Overview & PDR

## Overview

**Processor** is a self-contained Python 3.12 AWS Lambda that consumes SQS messages from the `fluxion-action-processor` queue and is the **sole request-initiator for every device action** in the Fluxion MDM platform.

**Purpose:** Claim per-device single-flight concurrency lock, record the REQUESTED milestone, then route the side effect (FCM wake-push to device or re-enqueue to checkin queue for server-applied actions).

**Platform context:** One of 5 Lambdas in Fluxion (Resolver, Processor, Enroll, Checkin, Applier). Operates on PostgreSQL 15 devices, actions, message_templates, and milestones tables. Sends FCM via Firebase Admin SDK.

## Core Requirements

### Must-Have (MVP scope)

1. **Single-flight origination per device**
   - Claim exclusive per-device lock via `SELECT ... FOR UPDATE` on devices row
   - Only write REQUESTED milestone when `assigned_action_id IS NULL`
   - SQS redeliveries of same action proceed without second REQUESTED write
   - Different actions waiting on busy device are dropped silently

2. **Audit trail REQUESTED writes**
   - Insert immutable milestones table row with event_type=REQUESTED
   - Capture command_id, metadata, template references, and state transitions
   - Milestone is the **sole write from this Lambda** (Applier writes APPLIED/FAILED/state)

3. **Routing to downstream queues**
   - SYSTEM_ACTIONS (REGISTER, ENROLL) → re-enqueue to checkin queue
   - DEVICE_BOUND_ACTIONS → FCM data-only wake-push
   - Routes execute only after DB transaction commits

4. **Failure resilience**
   - Return batchItemFailures for SQS partial retry
   - Skip non-processor messages without failing
   - FCM failures never propagate; next checkin tick is fallback wake

5. **Configuration-driven action classification**
   - Read action types and templates from database queries
   - No hard-coded routing logic

### Must-NOT (scope boundary)

- **Do NOT write APPLIED/FAILED milestones** — only Applier writes state transitions
- **Do NOT flip device state** — state is immutable until Applier applies action
- **Do NOT clear assigned_action_id lock** — Applier is sole lock clearer
- **Do NOT implement idempotent ACK deduplication** — Applier owns command_id dedup
- **Do NOT poll devices** — pure event-driven via SQS messages

## Functional Requirements

| Requirement | Acceptance Criteria | Verified By |
|-------------|-------------------|-------------|
| Consume SQS `processor` queue | Message deserialization, target_service filter | handler.py:28–42, lifecycle-test.py |
| Acquire FOR UPDATE lock | Only one action in-flight per device | db.py:58–76, concurrency lock test |
| Originate REQUESTED milestone | Inserted when assigned_action_id=NULL | handler.py:92–110, db.py:126–175 |
| Idempotent message handling | Same action_id redelivery = no second REQUESTED | handler.py:70, test assertion |
| Route SYSTEM_ACTIONS to checkin | REGISTER/ENROLL enqueued + log recorded | handler.py:115–128, constants.py:20 |
| Route DEVICE_BOUND_ACTIONS to FCM | Data-only payload sent, mocked if no cred | handler.py:130–142, fcm_dispatcher.py:66–85 |
| Side effects post-commit | SQS/FCM only after tx commits | handler.py:114, Python `with tx():` scope |
| Return batchItemFailures | Failed messages marked for retry | handler.py:28–50 |
| Never raise on FCM failure | Always return result dict, next checkin is fallback | fcm_dispatcher.py:66, dispatch() contract |

## Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| Performance | <3s action -> device wake | Depends on FCM latency + network, not Lambda |
| Concurrency | 100+ concurrent Lambdas safe | psycopg FOR UPDATE + Secrets Manager caching |
| Availability | 99.9% (AWS Lambda SLA) | Dead-letter queue for unprocessable messages |
| Auditability | Every action in milestones table | Immutable append-only, includes all metadata |
| Latency | SQS batch (10 msgs) processed <5s | Batch size tunable in CDK |

## Success Metrics

- **Action coverage:** All 9 action types (REGISTER, ENROLL, ACTIVATE, LOCK, UNLOCK, NOTIFY×3, RELEASE×2) route correctly
- **Lock contention:** Device-busy messages dropped silently, no errors
- **Milestone audit trail:** 10-milestone canonical lifecycle (device register → enroll → activate → release) completes with full payload
- **Idempotency:** SQS redelivery of same action_id = idempotent (no double REQUESTED)
- **FCM resilience:** Failures logged, not retried, next checkin proceeds
- **Deployment:** Single `cdk deploy` from infra/, no manual steps

## Architecture Constraints

1. **Duplicated utility modules** — config.py, constants.py, db.py, errors.py, sqs_client.py are copied into each Lambda (no shared package). Edits to one must be synced to sibling Lambdas.
2. **Single-threaded processing** — Lambda execution context is synchronous; concurrency is handled by per-device database lock.
3. **Secrets Manager fallback** — Local dev can use DATABASE_URL env var; production uses DB_SECRET_ARN + DB_ENDPOINT.
4. **Mock mode permanent** — If FIREBASE_SECRET_ARN is unset or malformed, dispatch flips to permanent mock (not transient retry).

## Related Documentation

- **Platform overview:** See monorepo [README.md](../../../../README.md)
- **Backend layout:** See [README.md](../../README.md)
- **System architecture:** See [system-architecture.md](./system-architecture.md)
- **Code standards:** See [code-standards.md](./code-standards.md)
- **Deployment:** See [deployment-guide.md](./deployment-guide.md)

## Open Questions

None — scope is locked to single-flight origination. Applier, Checkin, and Resolver own their respective responsibilities.
