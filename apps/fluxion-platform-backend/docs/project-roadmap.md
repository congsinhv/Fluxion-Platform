# Fluxion Backend — Project Roadmap

## Current Status

**Version**: 0.1.0 (MVP, Capstone Project)  
**Last Updated**: 2026-06-07  
**Phase**: Maintenance + Known Gaps Documentation

The backend is **feature-complete for MVP scope** (5-Lambda architecture, state machine, single-flight lock, E2E verification). All core workflows (device enrollment, lock/unlock, release) are implemented and tested. This roadmap documents current capabilities, known limitations, and proposed future enhancements.

## Completed Features (MVP)

### Phase 1: Core Architecture ✓
- [x] Five self-contained Python 3.12 Lambdas (Resolver, Processor, Checkin, Enroll, Applier)
- [x] Two SQS queues (Processor + Applier) + Shared DLQ
- [x] PostgreSQL 15 database with Alembic migrations
- [x] Single-module-global psycopg connection (no connection pool)
- [x] Configuration-driven state machine (seeded via migrations)

### Phase 2: Device State Machine ✓
- [x] Six states: IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED
- [x] Strict state transitions enforced in database
- [x] Immutable milestone audit trail (REQUESTED/APPLIED/FAILED)
- [x] State machine config seeded by Alembic migrations

### Phase 3: Concurrency Control ✓
- [x] Single-flight lock (`devices.assigned_action_id`)
- [x] Processor acquires lock (SELECT FOR UPDATE + WHERE NULL)
- [x] Applier releases lock (UPDATE ... SET = NULL)
- [x] Silent drop of concurrent requests (device busy)
- [x] Idempotent acks via `command_id` deduplication

### Phase 4: Action Routing ✓
- [x] SYSTEM_ACTIONS (REGISTER, ENROLL) → re-enqueue to Applier
- [x] DEVICE_BOUND_ACTIONS (ACTIVATE, LOCK, etc.) → FCM wake + device ack
- [x] Action classification in `constants.py`
- [x] Processor routing logic (sqs_consumer.py / handler.py)

### Phase 5: Device Enrollment (API) ✓
- [x] POST /v1/enroll endpoint (FastAPI)
- [x] 15-digit IMEI validation
- [x] api_key generation (`mdm_live_` prefix)
- [x] SHA-256 hash storage (never plaintext)
- [x] Re-enroll protection (409 Conflict)
- [x] Async state flip (enqueue ENROLL to Processor)

### Phase 6: Device Check-in (API) ✓
- [x] POST /v1/checkin endpoint (FastAPI)
- [x] PULL: heartbeat + command fetch
- [x] ACK: command result validation + enqueue
- [x] Bearer api_key authentication
- [x] Optional X-Device-IMEI cross-check
- [x] RELEASED device rejection (403)
- [x] Idempotent ack handling

### Phase 7: GraphQL Resolver ✓
- [x] AppSync direct Lambda invoker
- [x] Per-entity resolver modules (device, action, milestone, state, etc.)
- [x] Query/Mutation dispatch via dicts
- [x] uploadImei (sync inline write)
- [x] dispatchAction (validate + enqueue)
- [x] Error serialization (GraphQL error format)

### Phase 8: Concurrency & Idempotency ✓
- [x] Processor: lock acquisition + silent drop on conflict
- [x] Applier: sole transition writer + lock release
- [x] Command_id-scoped ack deduplication (REQUESTED-scoped)
- [x] Auto-chain ENROLL → ACTIVATE
- [x] SQS partial-batch retry (batchItemFailures)

### Phase 9: Testing & E2E Validation ✓
- [x] E2E test script (end-to-end lifecycle test, repo root)
- [x] 10-milestone lifecycle verification
- [x] Lock rejection under concurrency
- [x] Idempotent ack validation
- [x] Deployed stack testing (no unit-test suite)

### Phase 10: Infrastructure & Deployment ✓
- [x] AWS CDK stack (TypeScript, repo root infra/)
- [x] Lambda bundling via Docker (per-directory asset)
- [x] SQS queue + DLQ provisioning
- [x] PostgreSQL RDS provisioning
- [x] Secrets Manager integration
- [x] API Gateway HTTP Lambda invocation
- [x] CloudWatch Logs integration

### Phase 11: Documentation ✓
- [x] CLAUDE.md per-Lambda (Processor, Checkin, Enroll, Applier)
- [x] CLAUDE.md backend-level
- [x] Per-Lambda docs/ directories with module reference
- [x] Backend-level docs/ with architecture + PDR + standards
- [x] Monorepo CLAUDE.md with high-level overview

## Known Limitations & Gaps

### Code & Architecture

#### G-1: Missing Resolver CLAUDE.md
**Status**: Open  
**Severity**: Low  
**Description**: The Resolver Lambda is the only one without a dedicated CLAUDE.md. Per-Lambda guidance exists for Processor, Checkin, Enroll, and Applier.  
**Impact**: New developers working on GraphQL resolvers have no Lambda-specific guidance.  
**Proposed Fix**: Create `fluxion-platform-resolver/CLAUDE.md` with:
- Architecture overview (per-entity resolver modules, handler dispatch)
- Module structure (resolvers/device.py, resolvers/action.py, etc.)
- Error handling (GraphQL error format)
- Common patterns (query structure, mutation validation)

**Effort**: 1-2 hours  
**Priority**: Medium (nice-to-have, not blocking)

#### G-2: No Python Unit Tests
**Status**: Accepted (by design)  
**Severity**: Medium  
**Description**: The backend has no Python unit-test suite. All validation is E2E via an end-to-end lifecycle test against a deployed stack.  
**Impact**: Local development lacks quick feedback; errors are caught only after deployment.  
**Rationale**: Lambda functions are thin wrappers around database transitions. E2E testing the deployed system is more realistic than mocking AWS services. No long-running servers to test in isolation.  
**Proposed Improvement** (optional): Add light integration tests:
- Database transaction rollback on error
- SQS message format validation
- Lock acquisition/release correctness
- But defer to E2E as source of truth

**Effort**: 8-16 hours (if pursued)  
**Priority**: Low (E2E is sufficient for MVP)

#### G-3: Stale Inline Comments & README References
**Status**: Partially resolved (README refreshed; inline comments may remain)  
**Severity**: Low  
**Description**: Some code comments and per-Lambda docstrings still reference the old 4-Lambda design or stale checkin/applier split.  
**Impact**: Confusion for new developers.  
**Proposed Fix**: Audit code comments and update any references to the old architecture. Trust CLAUDE.md and the filesystem as source of truth.  
**Effort**: 1-2 hours (grep + sed)  
**Priority**: Low

### Features & Scope

#### G-4: Device Enrollment QR-Code Provisioning (Post-MVP)
**Status**: Proposed  
**Severity**: Medium  
**Description**: Current MVP supports IMEI-based enrollment (POST /v1/enroll validates IMEI). Production path should use Android QR-code provisioning (not implemented).  
**Impact**: Current onboarding requires manual IMEI entry; QR-code is more user-friendly and supports DPC provisioning workflows.  
**Proposed Approach**:
1. Add QR-code schema to the schema.graphql (QR provisioning endpoint).
2. Create new Lambda or extend Enroll to validate QR payload.
3. Update DPC Android client to generate/display QR codes.

**Effort**: 2-3 days (backend + frontend + client)  
**Priority**: High (production must-have)  
**Blocked By**: None

#### G-5: Limited State Machine Runtime Customization
**Status**: Accepted (by design)  
**Severity**: Low  
**Description**: States and actions are seeded via Alembic migrations. Schema changes (adding new state or action) require redeployment.  
**Impact**: Operators cannot customize state machine without code changes + redeployment.  
**Rationale**: Full runtime customization (e.g., drag-and-drop state machine builder) is out of MVP scope. Seeded migrations provide configuration-as-code benefits (version control, rollback).  
**Proposed Enhancement** (post-MVP): GraphQL mutations to add states/actions at runtime (with strict validation).  
**Effort**: 4-5 days (careful schema design required)  
**Priority**: Low (future enhancement)

#### G-6: No Device-to-Device Messaging
**Status**: Out of scope (MVP)  
**Severity**: Low  
**Description**: Devices can only receive commands from the admin console. No peer-to-peer device actions.  
**Impact**: Use cases requiring device-initiated commands (e.g., device-to-device sync) not supported.  
**Rationale**: MVP targets operator-initiated command flows. Device-device messaging is a secondary use case.  
**Proposed Enhancement**: Add device-to-device command routing (post-MVP).  
**Priority**: Low (future enhancement)

#### G-7: Single-Region Deployment
**Status**: Accepted (current architecture)  
**Severity**: Medium  
**Description**: All Lambdas and the database live in `ap-southeast-1` (Singapore). No cross-region failover.  
**Impact**: Regional outage → service down. No disaster recovery.  
**Proposed Enhancement** (production):
1. Multi-region RDS failover (read replicas).
2. Lambda replication + Route 53 failover.
3. SQS queue replication (manual or SNS fanout).

**Effort**: 2-3 weeks (requires careful testing)  
**Priority**: High (production must-have)  
**Blocked By**: Deployment infrastructure setup

#### G-8: No Redundancy or Caching
**Status**: Accepted (MVP)  
**Severity**: Medium  
**Description**: Single RDS instance, no read replicas, no caching layer (ElastiCache).  
**Impact**: Database becomes bottleneck under high load. No read scaling.  
**Proposed Enhancement** (production):
1. RDS read replicas for GraphQL queries.
2. ElastiCache (Redis) for device state snapshot + action deduplication.
3. SQS visibility timeout tuning.

**Effort**: 1-2 weeks  
**Priority**: Medium (for production scale)  
**Blocked By**: Load testing + metrics

#### G-9: No Device-Level Encryption
**Status**: Accepted (MVP)  
**Severity**: Low  
**Description**: Device api_keys are hashed with SHA-256 only (no salt, no pepper). Not PBKDF2 or bcrypt.  
**Impact**: Cryptographically adequate for immediate use; pre-image attacks are hard but not impossible.  
**Proposed Improvement** (security hardening):
1. Use bcrypt or Argon2 instead of SHA-256 for api_key hashing.
2. Add per-key salt.
3. Rotate keys periodically (e.g., annually).

**Effort**: 4-6 hours  
**Priority**: Medium (security hardening, post-MVP)

#### G-10: Limited Admin Console Permissions
**Status**: Accepted (MVP)  
**Severity**: Low  
**Description**: All authenticated admins have full CRUD access. No role-based access control (RBAC).  
**Impact**: Fine-grained access control not possible (e.g., cannot limit a user to read-only).  
**Proposed Enhancement** (RBAC):
1. Add roles table (Admin, Viewer, Operator).
2. Extend Cognito groups or custom claims.
3. Implement resolver permission checks.

**Effort**: 3-4 days  
**Priority**: Medium (production nice-to-have)

## Development Metrics

| Metric | Current | Target |
|--------|---------|--------|
| **Code Quality** | Ruff lint clean (py312, line-length 100) | ✓ Passing |
| **Test Coverage** | E2E only (no unit tests) | Proposed: 10+ E2E scenarios |
| **Documentation** | CLAUDE.md + per-Lambda docs | ✓ Complete (missing Resolver CLAUDE.md) |
| **Deploy Time** | ~2 min (CDK) | < 3 min |
| **Command Latency** | ~3 sec (FCM + device round-trip) | 1-2 sec (proposed) |
| **Milestone Query Time** | Sub-100ms (indexed on device_id, created_at) | ✓ Acceptable |

## Proposed Phases (Post-MVP)

### Phase 12: Resolver Documentation ✓ (if pursued)
**Effort**: 2 hours  
**Dependencies**: None  
**Deliverable**: `fluxion-platform-resolver/CLAUDE.md`

### Phase 13: QR-Code Provisioning (Production MVP)
**Effort**: 2-3 days  
**Dependencies**: Frontend + client updates  
**Deliverable**: Enroll Lambda supports QR provisioning alongside IMEI

### Phase 14: Multi-Region Failover (Production)
**Effort**: 2-3 weeks  
**Dependencies**: DevOps + load testing  
**Deliverable**: Cross-region RDS + Lambda replication

### Phase 15: RBAC & Admin Permissions (Enhancement)
**Effort**: 3-4 days  
**Dependencies**: None  
**Deliverable**: Role-based access control in Resolver + frontend

### Phase 16: Device-to-Device Messaging (Enhancement)
**Effort**: 1-2 weeks  
**Dependencies**: Client-side implementation  
**Deliverable**: Device-originated command routing

### Phase 17: Performance Optimization (Production)
**Effort**: 1-2 weeks  
**Dependencies**: Load testing + metrics  
**Deliverable**: Caching layer (ElastiCache) + RDS read replicas

## Open Questions

1. **Should Resolver get a CLAUDE.md?** — Guidance for Processor/Checkin/Enroll/Applier exists; Resolver is the only one without. Would this be useful or overkill?
2. **QR-code provisioning timeline?** — Required for production. When does MVP -> production transition happen?
3. **Load testing targets?** — What's the target TPS (transactions per second) and concurrent device count? This drives caching/scaling decisions.
4. **Encryption requirements?** — Should device api_keys use bcrypt instead of SHA-256? Depends on threat model.
5. **RBAC priority?** — Is fine-grained admin access control needed before production launch?
6. **Monitoring/observability?** — CloudWatch Logs are the current medium. Should we add X-Ray tracing, custom metrics, or alerting?

## Success Criteria

- [x] Core device state machine works correctly (verified by E2E test)
- [x] Single-flight lock prevents race conditions (verified by E2E concurrent test)
- [x] Idempotent acks don't corrupt state (verified by E2E redelivery test)
- [x] Milestone audit trail is complete (10-milestone lifecycle)
- [x] Backend code is lint-clean (ruff passing)
- [x] Documentation is current (CLAUDE.md, per-Lambda docs, backend docs)
- [ ] Production readiness (QR provisioning, multi-region, RBAC) — post-MVP
- [ ] Load testing (TPS, latency under scale) — pre-production

## Timeline

**Current**: Feature-complete MVP (June 2026)  
**Next steps**:
1. **Immediate** (next 1-2 weeks): Resolve G-1 (Resolver CLAUDE.md) if high priority.
2. **Short-term** (next 1-2 months): QR-code provisioning (G-4) before production launch.
3. **Medium-term** (3-6 months): Multi-region failover (G-7), RBAC (G-10).
4. **Long-term** (6+ months): Device-to-device messaging (G-6), runtime state customization (G-5).

---

**Note**: This roadmap reflects the MVP capstone project scope. Post-MVP roadmap is speculative and subject to business/product priorities.
