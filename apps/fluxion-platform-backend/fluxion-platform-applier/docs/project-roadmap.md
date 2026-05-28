# Project Roadmap — Applier Module

## Overview

The Applier module is **feature-complete** for the Fluxion capstone submission. It is the sole state-transition writer in the MDM pipeline, handling both device-ack and server-applied action flows with full idempotency and concurrency safety.

**Status:** Delivered | **Version:** 1.0 | **Maturity:** Production-ready (capstone demo phase)

---

## Phase Status

### Phase 1: Core State-Transition Engine ✅ COMPLETE
**Timeline:** Capstone development
**Deliverables:**
- ✅ SQS message consumption (fluxion-action-checkin queue)
- ✅ Transaction-safe device state updates
- ✅ APPLIED/FAILED milestone writes
- ✅ Single-flight lock management
- ✅ Device-ack path (ACTIVATE/LOCK/UNLOCK/NOTIFY/RELEASE)
- ✅ Server-applied path (REGISTER/ENROLL)
- ✅ Idempotency via command_id and milestone checks
- ✅ Auto-chain ENROLL → ACTIVATE

**Success Metrics:**
- ✅ E2E lifecycle test passes (10-milestone canonical path)
- ✅ Lock rejection test passes (concurrent actions prevented)
- ✅ Idempotent ack test passes (redeliveries no-op)
- ✅ Stale-cycle ack test passes (old cycles don't corrupt new ones)

### Phase 2: Production Hardening ❌ DEFERRED
**Status:** Not in scope for capstone; planned post-demo

**Potential enhancements:**
- [ ] Structured logging (JSON format for log aggregation)
- [ ] CloudWatch metrics/alarms (batchItemFailures, lock_mismatch rates)
- [ ] Distributed tracing (X-Ray integration for SQS → Applier latency)
- [ ] Unit test suite (requires decoupling from SQS/DB; may not be worth complexity)
- [ ] Chaos engineering tests (intentional failures, recovery scenarios)
- [ ] Performance profiling (P99 latency under load, lock contention under concurrent devices)

### Phase 3: Extended State Machine ❌ DEFERRED
**Status:** Feature request; not in scope for capstone

**Ideas:**
- [ ] Additional transitions (e.g., RELEASED → re-enroll, LOCKED → auto-release after TTL)
- [ ] Conditional auto-chaining (e.g., ENROLL → ACTIVATE only if device meets requirements)
- [ ] Rollback/compensation actions (e.g., on FAILED, auto-enqueue rollback action)
- [ ] State-driven notifications (different messages for different state pairs)
- [ ] Device group lifecycle (coordinated transitions across fleet)

### Phase 4: Scalability & Optimization ❌ DEFERRED
**Status:** Post-capstone investigation

**Considerations:**
- Lock contention under 1000+ devices/sec (current design: per-device serialization via lock)
- Batch transaction processing (group multiple device updates in one DB transaction)
- Connection pool optimization (Lambda concurrent invocations vs. DB connection limits)
- SQS batch window tuning (latency vs. throughput trade-off)
- Read replica for milestone queries (separate analytics workload)

---

## Current Limitations (Accepted for Demo Phase)

### 1. No Unit Test Suite
**Constraint:** SQS + DB transaction logic is difficult to isolate; Lambda-specific.

**Mitigation:** E2E tests via an end-to-end lifecycle test against deployed stack (validates the full 10-milestone lifecycle, concurrency safety, idempotency).

**Future:** If extracted to standalone service, unit tests become viable.

### 2. Polling-Only Client Observability
**Constraint:** Applier has no subscriptions; admin dashboard must poll every 10s to detect state changes.

**Impact:** Eventual consistency model; state flips may not appear immediately on screen.

**Mitigation:** Frontend polls at 10s interval; acceptable for admin MDM use case.

**Future:** GraphQL subscriptions or WebSocket push (requires resolver/subscriptions architecture change; out of Applier scope).

### 3. No Key Rotation
**Constraint:** Demo uses static API key per device; no expiry or rotation.

**Impact:** Compromised key cannot be revoked without re-enroll.

**Mitigation:** Static shared key in BuildConfig (Android client); acceptable for capstone demo.

**Future:** Implement API key versioning, expiry, and rotation in enroll Lambda.

### 4. Soft Delete Only
**Constraint:** No hard deletes implemented; all queries include `deleted_at IS NULL`.

**Impact:** Database growth over time (soft-deleted records accumulate).

**Mitigation:** Acceptable for demo; production would implement data retention policy.

**Future:** Implement hard-delete jobs (e.g., Alembic migrations every N months).

### 5. Single Applier Deployment
**Constraint:** One Applier Lambda; no multi-region active-active setup.

**Impact:** Single point of failure; regional outage = no state transitions.

**Mitigation:** AWS Lambda auto-scaling + SQS auto-scaling (acceptable for capstone demo).

**Future:** Multi-region deployment with cross-region SQS replication.

### 6. No Schema Versioning
**Constraint:** Alembic migrations only; no backward-compatibility layer.

**Impact:** Can't roll back code without rolling back schema (both must align).

**Mitigation:** Acceptable for capstone; future versions use feature flags + gradual migration.

---

## Known Issues & Workarounds

### Issue 1: Stale Redelivery of Device-Ack
**Description:** SQS may redeliver a device-ack from a prior cycle of a repeating action (e.g., UNLOCK from cycle 1 arrives during cycle 2's LOCK).

**Status:** ✅ RESOLVED (via command_id keyed resolution + latest REQUESTED check)

**Workaround:** None needed; design handles it. See `docs/system-architecture.md` for details.

### Issue 2: Crash Between Commit and Auto-Chain Enqueue
**Description:** Applier commits APPLIED milestone but crashes before enqueuing ACTIVATE. On redelivery, ENQUEUE loses the auto-chain.

**Status:** ✅ RESOLVED (auto-chain guard: if ACTIVATE already REQUESTED, skip duplicate; redelivery re-attempts enqueue)

**Workaround:** SQS redelivery self-heals; no action required.

### Issue 3: Processor & Applier Race on Lock Acquire
**Description:** Processor's FOR UPDATE on REQUESTED originates action while Applier is clearing the lock.

**Status:** ✅ RESOLVED (Applier clears lock first; Processor re-attempts with same or new command_id)

**Workaround:** None needed; eventual consistency model handles it.

### Issue 4: Missing Milestone Due to DB Rollback
**Description:** If the transaction rolls back (e.g., DB connection lost), milestone is not written; Applier batch-fails; SQS redelivers.

**Status:** ✅ DESIGN (eventual consistency; redelivery retries)

**Workaround:** Monitor DLQ; manual recovery if milestone lost.

---

## Metrics & Health Checks

### Deployment Checklist

Before deploying Applier:

- [ ] `npm run lint` passes (Ruff no errors)
- [ ] `npm run fmt:check` passes (Ruff formatting)
- [ ] `python3 -m py_compile handler.py sqs_consumer.py db.py config.py` passes
- [ ] Local DB up: `npm run db:up && npm run db:migrate`
- [ ] CDK stack deployed: `npm run infra:deploy --profile fluxion-dev`
- [ ] E2E lifecycle test passes against deployed stack (test kept local)

### Production Observability

**Key CloudWatch Metrics (to be implemented):**
- `ApplierInvocations` — Total Lambda invocations per minute
- `ApplierBatchFailures` — Failed messages per batch (should be <1%)
- `ApplierLockMismatches` — Skipped messages due to lock mismatch (should be near 0)
- `ApplierIdempotentAcks` — Redelivered acks (expected; varies)
- `ApplierDuration` — P50/P99 message processing time
- `ApplierErrors` — Uncaught exceptions (should be near 0)

**Alerts (to be configured):**
- batchItemFailures > 5% → Page on-call
- lock_mismatch > 10 in 5 min → Investigate processor
- DLQ messages > 0 → Manual review required

---

## Dependency on Sibling Lambdas

Applier **depends on** (and is **depended upon by**):

| Lambda | Relationship | Failure Impact |
|--------|--------------|-----------------|
| **Processor** | Upstream; enqueues to applier | Processor down → Applier idle (no messages) |
| **Checkin** | Upstream; device-ack entry | Checkin down → device acks not processed |
| **Resolver** | Upstream; action dispatch | Resolver down → admin can't dispatch; pending actions still process |
| **Enroll** | Upstream; ENROLL entry | Enroll down → new devices can't onboard; existing processing continues |
| **PostgreSQL** | State machine, milestones, locks | DB down → Applier fails all messages; batch-fails; SQS queues up |
| **SQS** | Message queue | SQS down → Lambda not invoked; messages queue; eventual replay |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-07 | Initial capstone delivery; device-ack + server-applied paths; auto-chain; idempotency; concurrency safety |

---

## Post-Demo Roadmap (Speculative)

### Immediate Post-Demo (Month 1)
- [ ] CloudWatch metrics & alarms implementation
- [ ] Log aggregation (JSON structured logging)
- [ ] Performance profiling under load (1000 devices/sec)
- [ ] Chaos engineering tests (intentional failures)

### Short Term (Months 2–3)
- [ ] Multi-region deployment strategy
- [ ] API key rotation implementation
- [ ] Hard-delete retention policy
- [ ] Schema versioning layer

### Medium Term (Months 4–6)
- [ ] Extended state machine (more transitions)
- [ ] Device group lifecycle (fleet-wide actions)
- [ ] Conditional auto-chaining
- [ ] Rollback/compensation actions

### Long Term (6+ months)
- [ ] Standalone Applier service (separate from Lambda)
- [ ] Unit test suite
- [ ] GraphQL subscriptions (real-time state updates)
- [ ] Machine learning (predictive device state)

---

## Documentation Maintenance

This roadmap is living. Update when:
- A limitation is resolved
- A new issue is discovered
- A phase status changes
- Post-demo work begins

---

## Contact & Escalation

**Module Owner:** [Capstone team]

**Questions / Issues:**
1. Check `docs/system-architecture.md` (design deep dive)
2. Check `docs/codebase-summary.md` (code walkthrough)
3. Check CLAUDE.md (AI guidance)
4. Review `apps/fluxion-platform-backend/README.md` (monorepo context)
5. Check an end-to-end lifecycle test (E2E test scenarios)

**Deployment Issues:**
- `npm run lint:fix` to auto-fix formatting
- `npm run db:migrate` to reset local DB state machine
- Check CloudWatch logs for `checkin_sqs.*` events
- Review DLQ messages for unparseable records

---

## Sign-Off

✅ **Capstone Delivery Approved** — Module meets all FRs/NFRs for demo; known limitations documented; roadmap clear.

**Ready for:** Production deployment (with standard AWS ALB, CloudWatch monitoring, on-call rotation).
