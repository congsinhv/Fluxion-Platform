# Fluxion Platform — Project Roadmap

**Status:** MVP (Capstone Project) — Core features complete, known gaps tracked below.

## Current Status (as of June 2026)

### Completed Features ✅
- Device enrollment (single IMEI) and state machine (IDLE → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED).
- GraphQL API (AppSync): listDevices, getDevice, listMilestones, uploadImei, dispatchAction, config CRUD.
- Admin console (React): Device list, detail, dispatch commands, template/TAC CRUD.
- Android DPC: Kotlin + Compose, event-driven (FCM wake, checkin, command execution).
- Database: PostgreSQL 15, Alembic migrations, seeded state machine.
- Deployment: AWS CDK (TypeScript), region `ap-southeast-1`, serverless.
- E2E validation: end-to-end lifecycle test (10-milestone trail, lock rejection, idempotent acks).

### Known Limitations (Accepted Tradeoffs for MVP) ⚠️

| Feature | Status | Reason | Priority |
|---------|--------|--------|----------|
| CSV batch IMEI upload | Deferred | Single IMEI only; batch deferred to post-MVP | Low |
| GraphQL subscriptions | Not implemented | Polling every 10s; subscriptions deferred | Low |
| Pagination cursors | Partial | Supported in DB schema, but frontend fetches first 100–200 without next-page buttons | Medium |
| DPC API authentication | Static shared key | `BuildConfig` BuildConfig; production would use external key loader | Medium (demo only) |
| JWT storage | localStorage | XSS trade-off accepted; production would move to secure storage | Medium (XSS documented) |
| FCM wake recovery | Not recovered | Dropped FCM wake while online not recovered; accepted | Low (eventual ack recovers) |
| Python unit tests | None | E2E only; no per-Lambda unit test suite | Medium |
| Android instrumented tests | None | Manual lifecycle validation; no Kotlin tests | Low |
| Broken npm script | db:fixtures | References missing `Artifacts/test-fixtures.sql`; not blocking | Low |

## Phase Timeline

### Phase 0: Initialization & Setup (✅ Complete, ~2 days)
**Goals:** Set up project structure, tooling, local development environment.

- [x] Initialize monorepo (npm workspaces).
- [x] Set up PostgreSQL local Docker environment.
- [x] Configure AWS CDK stack (infra/) with Cognito, RDS, Lambda, SQS, AppSync.
- [x] Initialize React frontend (Vite + TypeScript + Apollo).
- [x] Initialize Android DPC (Kotlin + Gradle).
- [x] Create root CLAUDE.md and per-app CLAUDE.md files.

### Phase 1: Backend Infrastructure & Database (✅ Complete, ~3 days)
**Goals:** Establish data model, Alembic migrations, state machine seeding.

- [x] Design PostgreSQL schema (devices, states, actions, milestones, etc.).
- [x] Write Alembic migrations (schema + seed data).
- [x] Implement shared modules (config.py, db.py, errors.py, constants.py, sqs_client.py).
- [x] Test local DB setup and migrations.

### Phase 2: Core Lambda Functions (✅ Complete, ~4 days)
**Goals:** Implement the 5 Lambdas with single-flight lock and idempotent semantics.

- [x] **resolver:** GraphQL dispatch, uploadImei (inline), dispatchAction (enqueue).
- [x] **enroll:** HTTP /v1/enroll, IMEI validation, api_key issuance.
- [x] **processor:** SQS consumer, lock acquire, REQUESTED write, FCM wake.
- [x] **checkin:** HTTP /v1/checkin, PULL/ACK dual-mode, api_key auth.
- [x] **applier:** SQS consumer, APPLIED write, state flip, lock clear, auto-chain.
- [x] Test locally with SQS LocalStack and manual invocations.

### Phase 3: Frontend Admin Console (✅ Complete, ~3 days)
**Goals:** Build React UI for device management, command dispatch, configuration.

- [x] Set up Apollo Client with Cognito auth, error handling, polling.
- [x] Implement pages: Login, DeviceList, DeviceDetail, Upload, Config, Templates, TACs.
- [x] Implement domain logic (action-availability.ts, MilestoneTimeline).
- [x] Custom Tailwind design tokens (Editorial Cream + Terracotta).
- [x] Vitest unit tests (action-availability, milestone grouping).

### Phase 4: Android DPC Client (✅ Complete, ~3 days)
**Goals:** Build Kotlin + Compose client with event-driven command execution.

- [x] Set up Compose UI (EULA, Enrolling, Active, Locked, Released screens).
- [x] Implement CheckinWorker (ACK-mode + PULL-mode dual protocol).
- [x] FCM integration (FluxionFcmService, wake event routing).
- [x] Command execution (CommandExecutor: ACTIVATE, LOCK, UNLOCK, NOTIFY, RELEASE).
- [x] SecureStorage (EncryptedSharedPreferences) for api_key, device_id, phase.
- [x] Retrofit + OkHttp networking (/v1/enroll, /v1/checkin).
- [x] Device Owner (DPC) integration + permission grants.

### Phase 5: Integration & E2E Testing (✅ Complete, ~2 days)
**Goals:** Deploy to AWS, validate end-to-end lifecycle.

- [x] Deploy CDK stack to `ap-southeast-1` (fluxion-dev profile).
- [x] Post-deploy: populate Firebase service account secret.
- [x] Create admin user via admin-user provisioning script.
- [x] Manual mobile testing: full enrollment → lock/unlock → release lifecycle.
- [x] Write E2E lifecycle test (E2E validation against deployed stack).
- [x] Verify 10-milestone trail, lock rejection, idempotent acks.

## Roadmap: Post-MVP Features

### Next Phase: Batch Operations & Scalability (⏳ Proposed, 1–2 weeks)
**Goals:** Support bulk device enrollment and improved UX.

**Features:**
- [ ] CSV batch IMEI upload via resolver.
- [ ] Progress tracking for bulk uploads.
- [ ] Pagination cursors in frontend (enable next-page navigation).
- [ ] Rate limiting on device enroll (DDoS mitigation).

**Dependencies:** None (incremental to existing resolver).

**Risk:** CSV parsing, transaction rollback on partial failure.

### Next Phase: Real-Time Updates (⏳ Proposed, 1–2 weeks)
**Goals:** Replace 10s polling with live subscriptions.

**Features:**
- [ ] GraphQL subscriptions (AppSync subscription resolvers).
- [ ] WebSocket transport (AppSync managed).
- [ ] Frontend subscription integration (Apollo `useSubscription`).
- [ ] Android: device state change notifications via FCM data + local handler.

**Dependencies:** AppSync upgrade, frontend Apollo refactor.

**Risk:** Subscription cost (AppSync pricing per concurrent connection), connection flapping.

### Next Phase: Testing Infrastructure (⏳ Proposed, 1–2 weeks)
**Goals:** Add unit test coverage to Python Lambdas.

**Features:**
- [ ] Pytest fixtures for DB, SQS mocking.
- [ ] Per-Lambda test suites (processor, applier, resolver, etc.).
- [ ] CI/CD pipeline (GitHub Actions) to run tests on PR.
- [ ] Coverage thresholds (e.g., 70%+).

**Dependencies:** None (local improvements).

**Risk:** Mocking SQS + DB complexity; may reveal subtle race conditions.

### Next Phase: Android Testing (⏳ Proposed, 1 week)
**Goals:** Add instrumented tests to Kotlin client.

**Features:**
- [ ] Instrumented tests for CheckinWorker (two-mode protocol).
- [ ] Mock API responses, FCM messages.
- [ ] Verify state transitions (EULA → Enrolling → Active → Locked → Released).
- [ ] Emulator-based validation in CI.

**Dependencies:** Gradle instrumented test setup, Firebase Test Lab (optional).

**Risk:** Emulator flakiness; Firebase Test Lab cost.

### Next Phase: Production Auth (⏳ Proposed, 1–2 weeks)
**Goals:** Replace static BuildConfig key with dynamic auth.

**Features:**
- [ ] External API key loader service (e.g., Lambda for Secrets Manager).
- [ ] Remove DPC_INTERNAL_API_KEY from BuildConfig (load at runtime).
- [ ] Device attestation (optional: SafetyNet / Play Integrity API).

**Dependencies:** New Lambda for key distribution, SecureStorage refactor.

**Risk:** Key rotation ceremony, security audit, compatibility with test devices.

### Future Phase: Advanced Features (❌ Out of scope for capstone)
- [ ] Multi-service support (currently DEVICE_FINANCING only).
- [ ] Device groups and bulk actions.
- [ ] Compliance reporting (audit log export, GDPR).
- [ ] Sandbox testing against deployed stack (currently manual only).

## Known Issues & Deferred Work

### Critical (Blocking deployment)
None currently identified.

### High (Should fix before production)
- **DPC static shared key** — Replace with production auth flow (see "Production Auth" phase).
- **JWT in localStorage** — Document XSS mitigation; move to secure storage post-MVP.
- **No Python unit tests** — Add pytest suite for per-Lambda validation.

### Medium (Quality of life)
- **Batch IMEI upload** — CSV parsing, bulk enroll flow.
- **Pagination cursors** — Frontend next-page button implementation.
- **GraphQL subscriptions** — Real-time updates instead of polling.
- **Android instrumented tests** — Kotlin test suite.

### Low (Nice to have)
- **db:fixtures npm script** — References missing SQL; not critical for MVP.
- **FCM wake recovery** — Dropped FCM while online; recovered by next ack.
- **Backend README stale** — 4-Lambda diagram vs. 5-Lambda reality.

## Success Metrics

### MVP (Current)
- ✅ Device enrollment and state transitions work idempotently end-to-end.
- ✅ Operator can dispatch commands and see device state in admin console.
- ✅ FCM wake and checkin correctly apply device-borne and server-borne actions.
- ✅ State machine is seeded from DB (not hardcoded) and mutable via migrations.
- ✅ E2E lifecycle test passes against deployed stack.

### Post-MVP Gates
1. **Batch upload:** CSV parsing tested with 1k+ devices; no performance degradation.
2. **Subscriptions:** All device pages use subscriptions; polling lag < 1 second.
3. **Unit tests:** Python coverage ≥ 70%; CI/CD enforces on PR.
4. **Production auth:** DPC key loader deployed; BuildConfig static key removed.

## Deployment Checklist (Current MVP)

- [x] AWS CDK stack deployed to `ap-southeast-1`.
- [x] RDS PostgreSQL 15 provisioned (multi-AZ, encrypted at rest).
- [x] AppSync API endpoint live.
- [x] 5 Lambdas deployed with 15-min timeout (max for SQS consistency).
- [x] SQS queues created (processor + checkin + shared DLQ).
- [x] FCM Firebase project created; service account secret populated.
- [x] Cognito user pool + identity pool configured.
- [x] Admin user created (admin-user provisioning script).
- [x] Frontend `.env` and Android `local.properties` populated from CDK outputs.
- [x] E2E test passes (end-to-end lifecycle test against deployed stack).

## Development Environment Setup

### First-Time Setup
```bash
git clone https://github.com/.../fluxion-platform.git
cd /Users/synhvo/RSU/Fluxion-Platform

npm install                            # Install workspaces
npm run db:up                          # Start local PostgreSQL
npm run db:migrate                     # Seed schema + state machine
npm run infra:deploy                   # Deploy to AWS (requires --profile fluxion-dev)
```

### Post-Deploy Steps
1. Copy CDK outputs: `cat infra/cdk-outputs.json | jq '.FluxionStack' > stack-outputs.json`
2. Frontend setup: `cp apps/fluxion-platform-frontend/.env.example apps/fluxion-platform-frontend/.env` (fill from outputs)
3. Frontend codegen: `npm --workspace apps/fluxion-platform-frontend run codegen`
4. Frontend dev: `npm --workspace apps/fluxion-platform-frontend run dev` (http://localhost:5173)
5. Android setup: `cp apps/fluxion-platform-client/local.properties.example apps/fluxion-platform-client/local.properties` (fill from outputs)
6. Android build: `cd apps/fluxion-platform-client && ./gradlew :app:assembleDebug && adb install -r build/outputs/apk/debug/app-debug.apk`
7. Android enroll: `./scripts/adb-enroll.sh` (sets Device Owner + grants permissions)

## Metrics & Health

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| E2E test pass rate | 100% | 100% | ✅ |
| Device state consistency | < 1s lag (eventually) | ~1–5s (10s poll cycle) | ⚠️ (polling acceptable for MVP) |
| Lambda error rate | < 0.1% | Unknown (no CloudWatch monitoring set up) | ❓ (future) |
| DPC command execution success rate | 95%+ | Unknown (manual validation only) | ❓ (requires instrumented tests) |
| Frontend CSP violations | 0 | 0 | ✅ |
| Code coverage (Python) | 70%+ | 0% (no unit tests) | ❌ (post-MVP) |
| Deployment time | < 10 min | ~3–5 min | ✅ |
