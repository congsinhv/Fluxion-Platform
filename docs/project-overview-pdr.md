# Fluxion Platform — Project Overview & Product Development Requirements

## Executive Summary

**Fluxion** is an AWS-native Mobile Device Management (MDM) platform enabling organizations to remotely provision, monitor, and control corporate-owned Android devices as Device Policy Controller (DPC) fleets. It targets inventory and device-financing use cases where operators must lock, unlock, notify, and release devices on demand with complete auditability.

The MVP (capstone project) delivers a React admin console, a serverless 5-Lambda Python backend, a configuration-driven state machine, and an event-driven Android client, with <3s command delivery via Firebase Cloud Messaging.

---

## Problem Statement

Fleet operators need a modern way to manage corporate Android devices with:
- **Strict control** — issue commands (lock, unlock, notify) with guaranteed single-flight serialization
- **Complete audit trail** — every action logged with actor, timestamp, payload
- **Fast delivery** — ~3 second command latency via push instead of polling
- **Provisioning flexibility** — support emulator demo path (adb set-device-owner) and post-MVP QR provisioning

---

## Users & Personas

| Persona | Role | Goals |
|---------|------|-------|
| **Fleet Operator** | Day-to-day device mgmt | Enroll devices, dispatch lock/unlock, view milestones, manage templates |
| **IT Administrator** | Fleet/config owner | Manage TACs (Type Allocation Codes), message templates, state/action rules |
| **Compliance Auditor** | Post-deployment review | Verify audit trail integrity, device state transitions, command delivery logs |

---

## Platform Scope (MVP Complete)

### In Scope
1. **Device provisioning & enrollment** — IMEI upload, api_key issuance, state progression (IDLE → REGISTERED → ENROLLED → ACTIVE)
2. **Remote state control** — LOCK, UNLOCK, RELEASE, NOTIFY commands via single-flight lock
3. **Immutable audit trail** — all milestones persisted with actor, timestamp, payload
4. **Admin console** — React UI for device listing, detail, state transitions, configuration management
5. **API Gateway** — HTTP `/v1/enroll` and `/v1/checkin` for Android DPC client
6. **FCM push delivery** — wake command triggers immediate device check-in
7. **Configuration-driven state machine** — states/actions/transitions seeded by database migrations, not hard-coded

### Out of Scope (Post-MVP)
- QR-code or NFC zero-touch provisioning
- Per-tenant Firebase projects or multi-tenancy
- GraphQL subscriptions (admin pages poll every 10s instead)
- Play Integrity attestation (static shared API key acceptable for demo)
- RDS access hardening (public RDS in dev; bastion+SSH tunnel post-MVP)

---

## Core Value Propositions

| Value | Mechanism |
|-------|-----------|
| **Serializability** | Database-level `FOR UPDATE` lock ensures only one action in-flight per device |
| **Auditability** | Immutable milestones with actor, timestamp, state, command payload |
| **Low latency** | FCM push wake instead of polling; ~3s end-to-end |
| **Configuration as code** | State machine seeded by Alembic migrations, not hard-coded constants |
| **Serverless ops** | 5 independent Lambda functions, no servers to operate or patch |
| **Idempotent** | Device ACKs deduplicated by command_id; safe to retry |

---

## Technology Stack Summary

| Layer | Tech |
|-------|------|
| **Control Plane** | React 18, TypeScript, Apollo Client, Cognito auth, Vite |
| **GraphQL** | AWS AppSync; SDL at `infra/schema/appsync.graphql` (single source of truth) |
| **Admin Backend** | Python 3.12 Lambdas (5), psycopg3, AWS Secrets Manager |
| **Device API** | FastAPI + Mangum on HTTP API Gateway (`/v1/enroll`, `/v1/checkin`) |
| **Device Client** | Kotlin/Compose, FCM, WorkManager (event-driven, no polling), DevicePolicyManager |
| **Messaging** | 2 SQS queues + shared DLQ, Firebase Cloud Messaging |
| **Data** | PostgreSQL 15 (RDS in production, Docker locally), Alembic migrations |
| **Infrastructure** | AWS CDK (TypeScript), region `ap-southeast-1` |

---

## Architectural Constraints & Decisions

### Why Two SQS Queues?
Single queue with EventSourceMapping filtering races — a non-matching consumer deletes the message before the matching consumer polls. Separate queues eliminate it: `fluxion-action-processor` (processor consumes, writes REQUESTED) + `fluxion-action-checkin` (applier consumes, writes APPLIED/FAILED) + shared DLQ.

### Why a Single Transition Writer (Applier)?
Only the Applier Lambda writes state transitions and clears the lock. Other Lambdas enqueue; Applier executes. Prevents races between transition + lock release, ensures idempotency of device ACKs.

### Why Configuration-Driven?
States, actions, message templates, and transitions are seeded by Alembic migrations, not hard-coded. Enables ops to modify rules without code redeploy; simplifies testing.

### Why Database-Level Lock?
`devices.assigned_action_id` with `WHERE assigned_action_id IS NULL` serializes at the DB, not application memory. Survives Lambda crashes and concurrent invocations.

---

## Key Metrics & Success Criteria

| Metric | Target | Status |
|--------|--------|--------|
| Command delivery latency | <3s (FCM wake + device check-in) | ✓ Achieved in E2E lifecycle tests |
| Single-flight enforcement | No concurrent actions per device | ✓ DB lock verified by concurrency test |
| Audit completeness | 10 canonical milestones per onboarding | ✓ Lifecycle test validates trail |
| Idempotency | Device ACK dedup by command_id, not action_id | ✓ Idempotency test passes |
| Deployment independence | Each Lambda deployable without others | ✓ Separate Docker assets, no shared packages |

---

## Limitations (Known, Documented, Not Bugs)

- **Provisioning** — emulator via `adb dpm set-device-owner`; production QR provisioning designed but post-MVP
- **Real-time updates** — admin pages poll every 10s; GraphQL subscriptions out of scope for MVP
- **IMEI on emulator** — derived from `Settings.Secure.ANDROID_ID`; operator must upload exact value before enroll
- **API authentication** — DPC uses static shared key in `BuildConfig` (demo-acceptable; Play Integrity post-MVP)
- **Database access** — RDS publicly accessible in dev; bastion+SSH tunnel hardening is post-MVP
- **Python testing** — no unit-test suite; E2E via an end-to-end lifecycle test against deployed stack

---

## End-to-End Device Lifecycle

```
1. UPLOAD (inline)         → Device row created, IDLE state
2. REGISTER (processor)    → Async, server-initiated, REGISTERED state
3. ENROLL (device-pulled)  → Device api_key issuance + enqueue
4. ACTIVATE (auto-chain)   → Processor chains ACTIVATE after ENROLL applied, ACTIVE state
5. LOCK (operator dispatch) → Device pulls & applies, LOCKED state
6. UNLOCK (operator dispatch) → Device pulls & applies, back to ACTIVE
7. NOTIFY (operator dispatch) → In-place, no state change
8. RELEASE (operator dispatch) → RELEASED state, device de-provisioned
9-10. Audit trail via milestones
```

Canonical flow = exactly 10 milestones, with single-flight lock ensuring no overlap.

---

## Post-MVP Roadmap

1. **QR provisioning** — Zero-touch enrollment for production fleets
2. **GraphQL subscriptions** — Real-time admin console updates (replace 10s polling)
3. **Per-tenant isolation** — Separate Firebase projects, multi-tenant database schemas
4. **Play Integrity attestation** — Replace static API key with cryptographic device attestation
5. **RDS hardening** — Bastion host + SSH tunneling for production database access
6. **CLI provisioning tool** — Bulk enrollment scripting for large fleets

---

## Repository Map

- **`apps/fluxion-platform-backend/`** — 5 Python 3.12 Lambdas (resolver, processor, checkin, enroll, applier)
- **`apps/fluxion-platform-frontend/`** — React 18 admin console
- **`apps/fluxion-platform-client/`** — Kotlin/Compose Android DPC client
- **`infra/`** — AWS CDK stack + GraphQL SDL
- **`scripts/`** — Lifecycle E2E test, admin user provisioning, database utilities

See `docs/codebase-summary.md` for full directory tree and per-app LOC.

---

## Related Documentation

- **`docs/system-architecture.md`** — Component topology, queue flow, state machine, sequence diagrams
- **`docs/code-standards.md`** — Shared naming, ruff config, Lambda duplication rule, commit conventions
- **`docs/deployment-guide.md`** — Full deploy runbook, local dev setup, post-deploy verification
- **`docs/project-roadmap.md`** — Current phase status and upcoming milestones
- **`docs/codebase-summary.md`** — Monorepo structure and per-app one-pagers
- **Per-app docs** — Read `apps/{app}/docs/` for app-specific architecture and PDRs
