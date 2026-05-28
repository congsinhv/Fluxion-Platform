# Fluxion Platform — Codebase Summary

## Directory Structure

```
/Users/synhvo/RSU/Fluxion-Platform/
├── infra/                              # AWS CDK (TypeScript) — deployed via `npm run infra:deploy`
│   ├── schema/
│   │   └── appsync.graphql            # [SOURCE OF TRUTH] SDL for AppSync + frontend codegen
│   └── lib/
│       └── fluxion-stack.ts           # CDK stack (auth, database, api, lambdas, messaging, secrets)
├── apps/
│   ├── fluxion-platform-backend/      # 5 Python 3.12 Lambdas (~5k LOC)
│   │   ├── fluxion-platform-resolver/
│   │   ├── fluxion-platform-enroll/
│   │   ├── fluxion-platform-processor/
│   │   ├── fluxion-platform-checkin/
│   │   └── fluxion-platform-applier/
│   ├── fluxion-platform-frontend/     # React 18 + Vite + TypeScript (~2.4k LOC)
│   └── fluxion-platform-client/       # Kotlin + Compose DPC (~1.9k LOC)
└── scripts/
    └── lifecycle-test.py              # E2E validation (10-milestone trail, locks, idempotency)
```

## Backend: 5 Python Lambdas

All from `apps/fluxion-platform-backend/`. Each Lambda dir is **fully self-contained** with its own `config.py`, `db.py`, `errors.py`, `sqs_client.py` (intentional duplication for CDK asset isolation — changes must be mirrored across copies).

### Shared across all Lambdas (copy in each dir)
- **config.py** — Logs root logger on import; env + Secrets Manager DB creds; Boto3 clients.
- **constants.py** — Immutable values only; action/state classification enums.
- **db.py** — Module-global psycopg3 connection; `dict_row`, `autocommit=True`; transaction context manager.
- **errors.py** — `AppError` base + subclasses (NotFound, Conflict, BadRequest, Forbidden, Unauthorized, InternalError).
- **sqs_client.py** — SQS producer/consumer; message serialization.

### Resolver Lambda (`fluxion-platform-resolver/`)
**Trigger:** AppSync field dispatch (direct)  
**Writes:** UPLOAD milestone (inline), validation only (dispatchAction enqueues)

| File/Dir | Purpose |
|---|---|
| `handler.py` | AppSync adapter; routes by `fieldName` via `QUERY_HANDLERS`/`MUTATION_HANDLERS` dicts aggregated from resolvers/ |
| `resolvers/` | Per-entity modules (device, milestone, action, config, template, tac) each exporting `QUERY_HANDLERS`/`MUTATION_HANDLERS` |
| `auth.py` | Cognito identity → upsert user; token validation |

**Key resolvers:**
- `resolvers/device.py` — QUERY listDevices/getDevice/countDevices; MUTATION uploadImei (inline Device + UPLOAD REQUESTED+APPLIED milestones), dispatchAction (validate + enqueue), releaseDevice.
- `resolvers/milestone.py` — QUERY listMilestones/getMilestone; only applier writes APPLIED/FAILED.
- `resolvers/action.py` — QUERY listActions; all device-bound actions cached from DB.
- `resolvers/config.py` — QUERY configMetadata (states/actions/transitions); frontend uses to populate action dropdowns.
- `resolvers/template.py` — CRUD listMessageTemplates/getMessageTemplate/createMessageTemplate/updateMessageTemplate/deleteMessageTemplate.
- `resolvers/tac.py` — CRUD listTacs/getTac/createTac/updateTac/deleteTac.

### Enroll Lambda (`fluxion-platform-enroll/`)
**Trigger:** HTTP POST `/v1/enroll`  
**Writes:** Device fields (api_key hash, fcm_token, info) + ENROLL to SQS

| File | Purpose |
|---|---|
| `app.py` | FastAPI app + Mangum adapter |
| `routes/enroll.py` | POST /v1/enroll — validate IMEI, generate api_key, enqueue ENROLL to processor queue |
| `auth.py` | Validates IMEI format, checks device state (must be REGISTERED) |

**Flow:**
1. Device posts IMEI + fcm_token.
2. Handler validates IMEI (15 digits, no leading zeros).
3. Looks up device in DB; must be REGISTERED state (409 Conflict if not).
4. Generates `api_key = "mdm_live_" + secrets.token_urlsafe(24)` (only SHA-256 hash stored).
5. Updates device.api_key_hash, device.fcm_token, device.info.
6. Enqueues ENROLL action to processor queue.
7. Returns `{api_key, message_templates, tacs}` synchronously.

**Errors:**
- 400 INVALID_IMEI_FORMAT (not 15 digits or has leading zero)
- 404 DEVICE_NOT_FOUND (IMEI not in DB)
- 409 INVALID_STATE (not REGISTERED)
- 500 INTERNAL_ERROR (DB/SQS failure)

### Processor Lambda (`fluxion-platform-processor/`)
**Trigger:** SQS `fluxion-action-processor` queue  
**Writes:** REQUESTED milestones + lock acquisition (sole REQUESTED writer)  
**Clears:** Lock in idempotent ack path (requeue, not applier)

| File | Purpose |
|---|---|
| `sqs_consumer.py` | Main handler; reads queue, classifies action (SYSTEM_ACTIONS vs DEVICE_BOUND), acquires single-flight lock, writes REQUESTED |
| `fcm_dispatcher.py` | FCM wake push; **never raises** (push failure ≠ message failure) |

**Flow:**
1. Dequeue action message (contains action.id, device.id, extras).
2. SELECT FOR UPDATE devices WHERE id = device_id.
3. Check `assigned_action_id IS NULL`; if null, set it to action.id (lock acquired).
4. Insert REQUESTED milestone with generated `command_id`.
5. Classify action:
   - **SYSTEM_ACTIONS** (REGISTER, ENROLL) → re-enqueue to checkin queue (applier will auto-apply via device ack path).
   - **DEVICE_BOUND** (LOCK, UNLOCK, NOTIFY_*) → send FCM wake data message (fcm_dispatcher.py).
6. Commit transaction, then dispatch (SQS enqueue / FCM send) — after commit only.
7. Return batchItemFailures (partial success ok).

### Checkin Lambda (`fluxion-platform-checkin/`)
**Trigger:** HTTP POST `/v1/checkin` + SQS `fluxion-action-checkin` (legacy queue name, now unused for SQS consumption)  
**Writes:** Device heartbeat fields, command_result enqueue (no milestones)

| File | Purpose |
|---|---|
| `app.py` | FastAPI + Mangum |
| `routes/checkin_route.py` | POST /v1/checkin — parse mode (PULL/ACK), authenticate, dispatch |
| `auth.py` | Bearer api_key auth (SHA-256 hash compare), optional X-Device-IMEI cross-check |

**Two-mode protocol:**
- **PULL mode** (no `command_result` in body): Return pending REQUESTED command (from latest action not yet APPLIED), update heartbeat fields, return 200 with command envelope.
- **ACK mode** (`command_result` present): Validate result by command_id (not action_id), enqueue to checkin queue for applier, return 200.

**Authentication:**
- Bearer token = `api_key` (user generated, stored as hash in DB).
- Optional X-Device-IMEI header (device provides its real IMEI for cross-check; backend compares).
- Returns 403 INVALID_CREDENTIALS if hash mismatch or DEVICE_RELEASED.

### Applier Lambda (`fluxion-platform-applier/`)
**Trigger:** SQS `fluxion-action-checkin` queue  
**Writes:** APPLIED/FAILED milestones (sole APPLIED writer) + device state flip + lock clear

| File | Purpose |
|---|---|
| `sqs_consumer.py` | Main handler; applies milestones, transitions state, clears lock, auto-chains ENROLL→ACTIVATE |

**Sole writer of state transitions.** Idempotent on milestone existence + command_id dedup.

**Flow (two paths):**
1. **Device ack path** (command_result present): Dequeue, find REQUESTED by command_id, write APPLIED milestone, transition state (if action.targetState set), clear lock, auto-chain next action if applicable (ENROLL → ACTIVATE).
2. **Server apply path** (SYSTEM_ACTIONS re-enqueued from processor): Similar, but applier is the first to see; apply state transition, auto-chain.

**Invariants:**
- Only applier writes APPLIED/FAILED milestones.
- Processor acquires lock; applier clears.
- command_id idempotency: if APPLIED milestone already exists for this command_id, skip (no rewrite).
- Auto-chain: after ENROLL APPLIED, immediately enqueue ACTIVATE (no ack needed, goes to processor).

## Database Schema (PostgreSQL 15)

| Table | Key Columns | Purpose |
|---|---|---|
| **services** | id (UUID), name | INVENTORY, DEVICE_FINANCING, etc. |
| **states** | id (UUID), service_id, name | IDLE, REGISTERED, ENROLLED, ACTIVE, LOCKED, RELEASED |
| **actions** | id (UUID), name, from_state_id, target_state_id, actor, created_at | REGISTER, ENROLL, ACTIVATE, LOCK, UNLOCK, RELEASE_*, NOTIFY_* |
| **message_templates** | id (UUID), name, subject, body, created_at, updated_at | Operator-managed templates for notifications |
| **tacs** | id (UUID), app_id, app_name, allowed | Trusted App Catalog entries |
| **users** | id (UUID), cognito_sub, email, created_at | Operator identities from Cognito |
| **devices** | imei UNIQUE, current_state_id (FK states), service_id, api_key_hash (SHA-256), fcm_token, info (JSON), assigned_action_id (lock), created_at, updated_at, deleted_at | Core device record |
| **milestones** | id (UUID), device_id (FK), action_id (FK), command_id UNIQUE, status (REQUESTED/APPLIED/FAILED), created_at | Immutable audit log |
| **device_uploads** | id (UUID), uploader_id (FK users), imei, created_at | Track operator IMEI uploads |

**Seeding:** Alembic migrations (scripts/db/migrations/versions/) seed states, actions, transitions, and message templates. No hardcoded state machine.

## Frontend: React 18 + Vite + TypeScript (~2.4k LOC)

**Location:** `apps/fluxion-platform-frontend/`

| File/Dir | Purpose |
|---|---|
| `src/apollo/client.ts` | ApolloClient (error link → 401 clear+redirect; auth link → Cognito JWT; HTTP link to AppSync) |
| `src/auth/cognito.ts` | amazon-cognito-identity-js wrapper |
| `src/auth/AuthContext.tsx` | Global auth state; ProtectedRoute gate |
| `src/auth/jwt-store.ts` | localStorage jwt key persistence (XSS trade-off) |
| `src/App.tsx` | Route definitions; nested under Shell (sidebar layout) |
| `src/pages/` | Per-page components (Login, DeviceList, DeviceDetail, Upload, Config, etc.) |
| `src/components/` | Reusable UI + domain logic (ActionAvailability.ts, MilestoneTimeline, icons, etc.) |
| `src/graphql/` | **\*.graphql** operation files (QUERY/MUTATION); **generated/** (codegen output, gitignored) |
| `src/styles/` | Tailwind design tokens (tokens.css); tailwind.config.ts (Editorial Cream + Terracotta palette) |
| `src/env.ts` | Centralized import.meta.env access; throws on missing vars |
| `vitest.config.ts` | Test runner (jsdom, css: false) — standalone, doesn't inherit vite.config.ts CSP |
| `vite.config.ts` | Dev CSP relaxation (HMR), global define for Cognito CJS |

**GraphQL codegen pipeline:**
- SDL: `../../infra/schema/appsync.graphql` (single source of truth).
- Operations: `src/graphql/*.graphql` (query/mutation definitions).
- Output: `src/graphql/generated/` (typed-document-node, client preset, gitignored).
- Workflow: Edit .graphql → `npm run codegen` → import from `@/graphql/generated/graphql`.

**Key domain logic:**
- `action-availability.ts` — Determines which operator actions are available for a device given its state/service; guards against `assignedAction != null` (single-flight).
- `MilestoneTimeline.tsx` — Groups REQUESTED/APPLIED-FAILED milestone pairs by action.id for display.

**Design:**
- Custom Tailwind tokens (no shadcn/ui): "Editorial Cream" background + "Terracotta" accent.
- Inter + JetBrains Mono fonts.
- No emojis; inline SVG icons only (`icons.tsx`).
- Tests colocate as `*.test.ts(x)`; setup in `src/test/setup.ts`.

**Strict production CSP:** `script-src 'self'` (no `unsafe-inline`). Vite plugin relaxes during `vite serve` only (HMR needs scripts).

**Routes:**
- `/login` — Cognito auth form.
- `/devices` — List (10s poll, state/service filters).
- `/devices/:id` — Detail (milestones, dispatch actions).
- `/upload` — Single IMEI form.
- `/upload/history` — Upload audit log.
- `/config/states` — Read-only state metadata.
- `/config/actions` — Read-only action metadata (from configMetadata query).
- `/templates` — CRUD message templates.
- `/tacs` — CRUD Trusted App Catalog.

**Data fetch strategy:** `cache-and-network` (must NOT add `nextFetchPolicy: 'cache-first'` — kills polling).

## Android Client: Kotlin + Compose (~1.9k LOC)

**Location:** `apps/fluxion-platform-client/` | **Package:** `com.fluxion.client` | **minSdk:** 28 | **Target:** 34

| File | Purpose |
|---|---|
| `MainActivity.kt` | Entry point; route by SecureStorage phase (EULA → Enrolling → Active → Released). Transient flourish screens (ActivateWelcome/WelcomeBack) delivered via intent extras. DeviceStateEvents SharedFlow for live updates. |
| `EnrollmentScreen.kt` | EULA acceptance → POST /v1/enroll → store api_key. |
| `ActivatingScreen.kt` | Awaiting ACTIVATE completion (device sees ENROLLED state, waits for ACTIVATE milestone). |
| `ActiveScreen.kt` | Normal state; display device info + command history. |
| `LockedActivity.kt` | Kiosk mode (startLockTask); NOTIFY_FROM_LOCKED renders message on locked surface. |
| `ReleasedScreen.kt` | Terminal state (should not reach; device wipes storage post-ack). |
| `work/CheckinWorker.kt` | Dual-mode: ACK-mode (report result, clear, idle) or PULL-mode (execute command, stash ack, re-enqueue ACK). All wake paths funnel here. |
| `fcm/FluxionFcmService.kt` | FCM data message handler; enqueues CheckinWorker on {wake:true}. |
| `command/CommandExecutor.kt` | Executes ACTIVATE, LOCK, UNLOCK, NOTIFY_*, RELEASE_*; persists phase BEFORE starting activity. |
| `storage/SecureStorage.kt` | EncryptedSharedPreferences (AES256-GCM); stores api_key, device_id, imei, pending_ack, phase, last_template_*. |
| `net/CheckinApi.kt` | Retrofit + OkHttp + Moshi; /v1/enroll, /v1/checkin. |
| `DpcApp.kt` | App entry; primes LOCK allowlist, registers NetworkCallback (back-online wake). |
| `platform/dpc/FluxionDeviceAdminReceiver.kt` | Device admin receiver; handles policy constraints. |

**Event-driven wake sources:**
- FCM data {wake:true} → FluxionFcmService → CheckinWorker.
- App boot → NetworkCallback → CheckinWorker.
- Back-online → NetworkCallback → CheckinWorker.
- Post-command execution → CommandExecutor → CheckinWorker ACK run.

**Two-mode CheckinWorker protocol:**
- **ACK-mode:** `pendingAckJson` exists → POST /v1/checkin with result → clear pending → idle.
- **PULL-mode:** No pending → POST /v1/checkin (PULL) → receive command → CommandExecutor (execute) → stash ack → enqueue ACK run.

**RELEASE deferred cleanup:**
- CommandExecutor.handleRelease() sets `deviceId = RELEASED_SENTINEL`, relinquishes Device Owner.
- Next CheckinWorker ACK-mode sees sentinel, wipes storage, cancels work.

**Networking:**
- Retrofit + OkHttp + Moshi.
- /v1/enroll with X-Internal-API-Key (BuildConfig, demo limitation).
- /v1/checkin with Bearer api_key + X-Device-IMEI + X-DPC-Version.
- Auth errors (INVALID_CREDENTIALS, DEVICE_RELEASED) → clear storage → EULA.
- 5xx/transport → Result.retry().

**Build:**
- Gradle: `:app` module.
- `local.properties` → `BuildConfig` (DPC_BASE_URL, DPC_INTERNAL_API_KEY).
- `google-services.json` (Firebase, gitignored).
- Emulator must use Google APIs image (not Play, not AOSP).

**Storage & persistence:**
- SecureStorage: api_key, device_id, imei, pending_ack, current_phase, last_template_*.
- Persist-before-launch: handlers write phase/template BEFORE starting activity.
- UI state routing: phase changes propagate via DeviceStateEvents (live) + onResume re-read (cold).

**Logcat tags:** FluxionMain, FluxionCheckin, FluxionCommand, FluxionApp, FluxionFcm.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/db/migrations/` | Alembic schema + seeds (states, actions, transitions, message templates). |
| `scripts/adb-enroll.sh` | Sets Device Owner + grants READ_PHONE_STATE/POST_NOTIFICATIONS. |

## Key Dependencies

| Stack | Frameworks/Libraries |
|---|---|
| **Backend** | FastAPI, Mangum, psycopg3, boto3, firebase-admin |
| **Frontend** | React 18, Vite, TypeScript, Apollo Client, amazon-cognito-identity-js, Tailwind CSS, Vitest |
| **Android** | Kotlin, Jetpack Compose, Retrofit, OkHttp, Moshi, WorkManager, EncryptedSharedPreferences, firebase-messaging |
| **Infra** | AWS CDK (TypeScript) |
| **Local DB** | PostgreSQL 15 (Docker) + Alembic |

## Commands Summary

| Command | Purpose |
|---|---|
| `npm install` | Install workspaces (infra + frontend). |
| `npm run db:up / db:down` | Local PostgreSQL (Docker). |
| `npm run db:migrate` | Alembic schema + seeds (required first). |
| `npm run lint / lint:fix` | Ruff check (py312, line 100, E/F/I/UP/B). |
| `npm run fmt / fmt:check` | Ruff format. |
| Frontend workspace: `npm run dev` | Vite dev server at http://localhost:5173. |
| Frontend workspace: `npm run codegen` | GraphQL code generation (after schema changes). |
| Frontend workspace: `npm run test` | Vitest unit tests. |
| Infra: `npm run infra:deploy` | CDK deploy via --profile fluxion-dev. |
| Android: `./gradlew :app:assembleDebug` | Build APK. |
| Android: `./scripts/adb-enroll.sh` | Set Device Owner + grant permissions. |

## Local Dev Setup

1. `npm install` — Install workspace dependencies.
2. `npm run db:up` — Start local PostgreSQL.
3. `npm run db:migrate` — Seed state machine (required).
4. Frontend: `cp .env.example .env` (fill from `infra/cdk-outputs.json` post-deploy).
5. Frontend: `npm run codegen` — Generate GraphQL types (required before building).
6. Frontend: `npm run dev` — Start dev server (http://localhost:5173).
7. Android: `cp local.properties.example local.properties` (set DPC_BASE_URL, DPC_INTERNAL_API_KEY).
8. Android: Place `google-services.json` in `app/`.
9. Android: `./gradlew :app:installDebug && ./scripts/adb-enroll.sh`.
