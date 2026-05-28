# Fluxion Checkin Lambda — Project Overview & PDR

## Module Purpose

The **Checkin Lambda** is the device-facing HTTP gateway for Fluxion, an AWS-native Android MDM platform. It handles two independent request shapes — device heartbeats (PULL) and command acknowledgments (ACK) — and enforces idempotency, authentication, and terminal state rejection. One of five self-contained Python 3.12 Lambdas in the Fluxion backend.

**Key Responsibility:** Device checkin (heartbeat + pending command delivery) and ACK validation; state transitions are delegated to the applier Lambda.

## Functional Requirements

### R1: Device Heartbeat (PULL)
- Accept POST /v1/checkin requests without `command_result`
- Update device `last_checkin_at` timestamp
- Store optional `device_info` from the request
- Return pending command from the device's latest REQUESTED milestone (if any)
- Return `next_checkin_in` = 60 seconds if pending, 3600 if idle

### R2: Command Acknowledgment (ACK)
- Accept POST /v1/checkin requests with `command_result` object
- Synchronously validate: `status` must be SUCCESS|FAILED, `command_id` required
- Reject unknown or already-processed acks with 400 UNKNOWN_COMMAND_ID
- Enqueue validated ack to checkin queue for applier (no inline state write)
- Return heartbeat response; never pull a command in ACK request

### R3: ACK Idempotency
- Idempotency is REQUESTED-scoped: an ack counts only if no APPLIED/FAILED milestone exists after the matching REQUESTED
- Device-bound actions (LOCK, UNLOCK, etc.) repeat across lifecycle; command_id alone insufficient
- Idempotent acks log and return gracefully (no error)

### R4: Device Authentication
- Require bearer api_key with `mdm_live_` prefix
- Hash validation: only SHA-256 digest stored in `devices.api_key_hash`
- Optional `X-Device-IMEI` header cross-check (403 INVALID_DEVICE_BINDING on mismatch)
- Missing Authorization header → 401 MISSING_API_KEY
- Invalid or unrecognized key → 403 INVALID_CREDENTIALS

### R5: Terminal State Rejection
- RELEASED state is terminal; checkins from released devices → 403 DEVICE_RELEASED
- No further commands or state transitions allowed

### R6: Command Filtering
- Never return SYSTEM_ACTIONS (REGISTER, ENROLL) as device commands
- These are server-applied; device sees only DEVICE_BOUND_ACTIONS (ACTIVATE, LOCK, NOTIFY_*, RELEASE_*)

## Non-Functional Requirements

### NF1: Idempotency & Consistency
- ACK enqueue happens *after* DB transaction commits (side effects follow durable state)
- All DB writes use parameterized queries (no SQL injection)
- Device lock (FOR UPDATE) prevents concurrent milestone writes within transaction

### NF2: Reliability
- 5xx errors are retryable; device should backoff 5s max 5 attempts
- Device error details preserved in milestone payload (executed_at, error object)

### NF3: Latency
- Response time: <100ms median (in-region DB, no external RPCs)
- Pending command payload includes notification template (resolved once at checkin)

### NF4: Observability
- All SQS enqueues logged with device_id, action_id, message_id
- Idempotent acks logged (device doesn't fail, but we track)

## Technical Constraints

### C1: Shared Database
- PostgreSQL 15 RDS (production), Docker local (dev)
- Alembic migrations at `scripts/db`
- All params bound via `%(name)s` — no interpolation

### C2: SQS Routing
- Two physical queues: `PROCESSOR_QUEUE_URL`, `CHECKIN_QUEUE_URL`
- ESM filtering on shared queue races; two queues avoid contention
- This Lambda only enqueues ACKs to checkin queue (applier consumes)

### C3: Stateless Lambda
- Module-global DB connection (cached, reused across invocations)
- Boto3 clients are lazy + thread-safe singletons
- No persistent state; all durable state in RDS

### C4: HTTP-Only
- No SQS event source (applier moved to separate Lambda)
- API Gateway → Mangum → FastAPI → routes
- No dual-mode checkin; SQS path is applier-only

### C5: Device State Machine
- Immutable device states: IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED
- Every transition = milestone row (REQUESTED / APPLIED / FAILED)
- `devices.assigned_action_id` = per-device single-flight lock

## Acceptance Criteria

- [ ] PULL requests return correct pending command (or null), with notification payload resolved from template
- [ ] ACK requests validate synchronously; unknown/malformed → 4xx with error_code
- [ ] Idempotent acks (REQUESTED-scoped) are accepted without error
- [ ] Terminal state (RELEASED) rejects all checkins with 403
- [ ] All DB operations use parameterized queries
- [ ] ACK enqueue happens *after* transaction commit
- [ ] All error responses include `retry_strategy` block (retryable only ≥500)
- [ ] E2E lifecycle test (an end-to-end lifecycle test) passes against deployed stack

## Dependencies

- **FastAPI** 0.115–0.120: HTTP framework
- **Mangum** 0.19–0.20: ASGI-to-Lambda adapter
- **Pydantic** v2: Request validation
- **psycopg** 3.2+: PostgreSQL adapter
- **boto3** 1.34+: AWS SDK (SQS, Secrets Manager)
- **Applier Lambda**: Consumes checkin queue, writes milestone transitions
- **Processor Lambda**: Sends FCM, enqueues to processor queue

## Scope & Limitations

### In Scope
- Device heartbeat (PULL) and command fetch
- Command ACK validation and queueing
- Bearer token authentication with IMEI cross-check
- Terminal state rejection
- ACK idempotency

### Out of Scope (Future)
- Play Integrity attestation (currently static internal key)
- QR-code provisioning
- GraphQL subscriptions (platform-level, not module-specific)
- RDS hardening (platform-level CDK)
- Emulator IMEI derivation (currently from ANDROID_ID, not production)

### Known Limitations
- No offline queueing on device (relies on FCM for wake)
- Notification template must exist at checkin time (not retroactive)
