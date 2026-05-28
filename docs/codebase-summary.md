# Fluxion Platform — Codebase Summary

## Monorepo Structure

```
fluxion-platform/
├── apps/
│   ├── fluxion-platform-backend/          # 5 Python 3.12 Lambdas (~5000 LOC total)
│   │   ├── fluxion-platform-resolver/     # AppSync GraphQL field dispatch
│   │   ├── fluxion-platform-processor/    # SQS originator + FCM wake
│   │   ├── fluxion-platform-checkin/      # HTTP /v1/checkin device gateway
│   │   ├── fluxion-platform-enroll/       # HTTP /v1/enroll enrollment endpoint
│   │   ├── fluxion-platform-applier/      # SQS consumer, sole transition writer
│   │   └── docs/                          # Backend-level architecture & PDR
│   ├── fluxion-platform-frontend/         # React 18 + Vite admin console (~2600 LOC)
│   │   ├── src/                           # TypeScript + React components
│   │   ├── docs/                          # Frontend PDR & architecture
│   │   └── vitest configs for unit tests
│   ├── fluxion-platform-client/           # Kotlin/Compose Android DPC client (~1850 LOC)
│   │   ├── app/                           # Main DPC application
│   │   ├── docs/                          # Android client architecture & PDR
│   │   └── gradle build configuration
│   └── docs/                              # Shared backend/platform docs (currently empty)
├── infra/                                 # AWS CDK TypeScript stack + GraphQL SDL
│   ├── lib/fluxion-stack.ts               # Main CDK stack with 6 constructs
│   ├── schema/appsync.graphql             # Single GraphQL SDL source of truth
│   └── package.json                       # CDK dependencies
├── scripts/
│   └── db/migrations/                     # Alembic migrations (6 files: init + seeds)
│       ├── 0001_init_schema.py            # 9 tables + pgcrypto + pg_trgm + triggers
│       ├── 0002_seed_services.py          # INVENTORY + DEVICE_FINANCING
│       ├── 0003_seed_states.py            # 6 states (IDLE, REGISTERED, etc.)
│       ├── 0004_seed_message_templates.py # 3 default templates
│       ├── 0005_seed_actions.py           # 10 actions (UPLOAD, REGISTER, ENROLL, etc.)
│       └── 0006_fix_actor.py              # Audit corrections
│   # (operational scripts kept local, not committed)
├── docs/                                  # ROOT monorepo documentation (new)
│   ├── project-overview-pdr.md            # Platform PDR, scope, value props
│   ├── codebase-summary.md                # This file: monorepo structure & per-app overview
│   ├── system-architecture.md             # End-to-end flows, queue topology, diagrams
│   ├── code-standards.md                  # Shared naming, ruff config, Lambda rules
│   ├── deployment-guide.md                # Full deploy runbook & local setup
│   ├── project-roadmap.md                 # Status & post-MVP items
│   └── design-guidelines.md               # (SKIP — frontend has its own)
├── package.json                           # npm workspaces (infra + frontend)
├── docker-compose.yml                     # Local PostgreSQL 15
├── README.md                              # Quick reference (no changes)
└── CLAUDE.md                              # Root-level development guidance
```

---

## Per-App Overview

### Backend: `apps/fluxion-platform-backend/`

**Purpose:** Serverless pipeline of 5 independent Python Lambdas managing device state, processing commands, and enforcing concurrency control.

**Tech:** Python 3.12, psycopg3, AWS Lambda, SQS, Secrets Manager, Firebase Admin SDK.

**Key files:**
- **resolver** — AppSync direct handler; routes GraphQL operations to `resolvers/{entity}.py` modules
- **processor** — SQS consumer (`fluxion-action-processor` queue); acquires lock, writes REQUESTED milestone, sends FCM wake
- **enroll** — HTTP endpoint (`/v1/enroll`); FastAPI + Mangum; validates IMEI, issues api_key, enqueues ENROLL
- **checkin** — HTTP endpoint (`/v1/checkin`); FastAPI + Mangum; device PULL/ACK gateway
- **applier** — SQS consumer (`fluxion-action-checkin` queue); sole transition writer (APPLIED/FAILED milestones, state flip, lock clear, auto-chain)

**Shared modules (duplicated across Resolver, Processor, Applier by design):**
- `config.py` — logger, boto3 clients, env/Secrets Manager, AppSync endpoint (for publishers)
- `constants.py` — action classification, state/actor enums
- `db.py` — psycopg connection singleton, helper queries
- `errors.py` — typed AppError exceptions
- `sqs_client.py` — SQS send_message helper
- `appsync_publisher.py` — Fire-and-forget IAM-signed GraphQL mutation calls for real-time push (Resolver, Processor, Applier only)

**Invariants:**
- Single-flight lock via `devices.assigned_action_id` with `WHERE assigned_action_id IS NULL`
- Two SQS queues (not one shared) to avoid ESM filtering races
- Only Applier writes state transitions; others enqueue
- Device ACK idempotency via REQUESTED-scoped `command_id`, not action_id

**Status:** MVP complete. E2E tested via an end-to-end lifecycle test (canonical 10-milestone trail, concurrency, idempotency).

**Docs:** See `apps/fluxion-platform-backend/docs/` for backend PDR, system architecture, code standards.

---

### Frontend: `apps/fluxion-platform-frontend/`

**Purpose:** React admin console for operators to manage devices, dispatch commands, and audit state history.

**Tech:** React 18, TypeScript, Vite, Apollo Client, Tailwind CSS (custom, no shadcn/ui), Amazon Cognito, Vitest.

**Key modules:**
- `src/apollo/client.ts` — ApolloClient setup with dual auth/transport: HTTP (Cognito JWT) for queries/mutations, WebSocket (Cognito JWT) for subscriptions; error link (401 → /login)
- `src/auth/` — Cognito integration, AuthContext, JWT store, protected routes
- `src/components/action-availability.ts` — Core domain logic: which operator actions are dispatchable per device state/service
- `src/pages/` — One file per route (device list, detail, configuration, upload); DeviceDetail, DevicesByState, UploadHistory pages use `useSubscription` hooks to listen for real-time push and refetch affected queries
- `src/graphql/` — Apollo operations (queries/mutations/subscriptions); codegen produces typed DocumentNode in `generated/`
  - `subscriptions.graphql` — `onDeviceUpdated(deviceId)`, `onDeviceChanged`, `onDeviceUploadChanged` (lightweight change-event payloads used as refetch signals)

**GraphQL codegen pipeline:**
1. SDL at `infra/schema/appsync.graphql` is single source of truth
2. Operations in `src/graphql/*.graphql`
3. Run `npm run codegen` → generates typed code in `src/graphql/generated/` (gitignored)
4. Import from `@/graphql/generated/graphql`

**Architecture decisions:**
- `watchQuery` fetch policy is `cache-and-network` (NOT `cache-first`) — required for 10s `pollInterval` fallback
- Real-time subscriptions via AppSync WebSocket (Cognito JWT); polling fallback retained for robustness
- Apollo `split` link routes subscriptions over WebSocket, queries/mutations over HTTP
- Strict production CSP (`script-src 'self'`) enforced in `index.html`, extended with `connect-src` for WebSocket realtime origin; relaxed only in dev (HMR)
- Zero-warning ESLint policy (`--max-warnings 0`)

**Status:** MVP complete. All 10 UI mockups implemented. Vitest covers action-availability logic and milestone grouping.

**Docs:** See `apps/fluxion-platform-frontend/docs/` for frontend PDR, architecture, design guidelines.

---

### Android Client: `apps/fluxion-platform-client/`

**Purpose:** Device Policy Controller (DPC) app provisioned as Device Owner on corporate Android devices.

**Tech:** Kotlin, Jetpack Compose, FCM, WorkManager (event-driven), Retrofit, DevicePolicyManager.

**Key modules:**
- **CheckinWorker** — Event-driven (FCM wake, post-execute, back-online, app boot); pulls pending commands from `/v1/checkin`
- **DPC commands** — ACTIVATE, LOCK, UNLOCK, NOTIFY, RELEASE via DevicePolicyManager APIs
- **Local auth** — Static shared key in `BuildConfig` (demo-acceptable; Play Integrity post-MVP)

**Build targets:**
- minSdk 28 (Android 9), targetSdk 34

**Enrollment flow:**
1. Operator uploads IMEI to admin console
2. Device calls `/v1/enroll` with IMEI + api_key
3. Device receives api_key hash stored in Secrets Manager
4. Device pulls `/v1/checkin` on next FCM wake
5. Device executes DPC commands, acknowledges

**Status:** MVP complete. Event-driven CheckinWorker in place (no polling).

**Docs:** See `apps/fluxion-platform-client/docs/` for Android PDR and architecture. **Important:** Read `apps/fluxion-platform-client/CLAUDE.md` before touching client code.

---

## Infrastructure: `infra/`

**Purpose:** AWS CDK TypeScript stack defining all cloud resources (Cognito, RDS, AppSync, API Gateway, Lambda, SQS, Secrets Manager).

**Key files:**
- `lib/fluxion-stack.ts` — Main stack composed of 6 constructs: auth, database, api, lambdas, messaging, secrets
- `schema/appsync.graphql` — **Single GraphQL SDL source of truth** (feeds both AppSync and frontend codegen)

**Constructs:**
- **Auth** — Amazon Cognito (fluxion-admin-pool, no self-signup, seed admin user via script); AppSync also supports IAM auth for internal Lambda broadcasts
- **Database** — RDS PostgreSQL 15, t3.micro, public SG 0.0.0.0/0 (dev-only; production post-MVP)
- **API** — AppSync GraphQL (dual auth: Cognito USER_POOL for operators, IAM for Lambda publishers) + HTTP API Gateway (routes /v1/enroll, /v1/checkin, /v1/health)
  - Schema includes internal broadcast mutations (`publishDeviceChange`, `publishDeviceUploadChange`) backed by NONE data sources + JS passthrough resolvers
  - Subscriptions: `onDeviceUpdated(deviceId)`, `onDeviceChanged`, `onDeviceUploadChanged`
- **Lambdas** — 5 Python 3.12 ARM64 functions, 512MB memory, 30s timeout, Docker bundling per directory
  - Resolver, Processor, Applier have IAM permission to call AppSync broadcast mutations (post-commit)
- **Messaging** — 2 SQS queues (`fluxion-action-processor`, `fluxion-action-checkin`) + shared DLQ (maxReceiveCount=3)
- **Secrets** — `fluxion/firebase-service-account` (FCM key), `fluxion/dpc-shared-api-key`

**Region:** `ap-southeast-1` (Singapore)

**Deploy:** `npm run infra:deploy` (uses `--profile fluxion-dev`; requires CDK bootstrap first)

---

## Scripts: `scripts/`

| Script | Purpose |
|--------|---------|
| **db/migrations/0001–0006.py** | Alembic schema init + state machine seeding (required before anything works) |

---

## Code Standards (Root Level)

- **Python ruff config:** py312, line-length 100, double quotes, select E/F/I/UP/B, ignore E501/B008
- **Naming:** Directories + top-level files kebab-case; files inside Python packages snake_case
- **Lambda duplication rule:** Each Lambda dir owns full copies of `config.py constants.py db.py errors.py sqs_client.py` — CDK bundling constraint; mirror changes across all 5. Resolver, Processor, Applier additionally own `appsync_publisher.py` (no shared package, same bundling reason); changes must be mirrored.
- **GraphQL SDL:** `infra/schema/appsync.graphql` is single source of truth; update it → redeploy infra AND re-run frontend codegen
- **Commit messages:** Conventional commits (feat, fix, docs, refactor, test, chore); no AI references

See `docs/code-standards.md` for full shared standards and per-app code patterns.

---

## Local Development Quick Start

```bash
# Install dependencies
npm install

# Start local PostgreSQL and run migrations (REQUIRED)
npm run db:up
npm run db:migrate

# Run linting
npm run lint / lint:fix

# Frontend dev
cd apps/fluxion-platform-frontend
npm run codegen          # Generate GraphQL types (required on schema changes)
npm run dev              # http://localhost:5173

# Android client build
cd apps/fluxion-platform-client
cp local.properties.example local.properties
./gradlew :app:assembleDebug
./gradlew :app:installDebug

```

---

## Deployment Quick Start

```bash
cd infra
npm install
npx cdk bootstrap --profile fluxion-dev
npx cdk deploy --profile fluxion-dev

# Post-deploy
# Run admin-user provisioning script
# Populate fluxion/firebase-service-account secret
# Copy stack outputs to frontend .env and client local.properties
```

---

## Related Documentation

- **`docs/system-architecture.md`** — Component topology, flows, diagrams (Mermaid v11)
- **`docs/code-standards.md`** — Shared naming, ruff, Lambda duplication, GraphQL pipeline, commit conventions
- **`docs/deployment-guide.md`** — Full deploy runbook and post-deploy verification
- **`docs/project-roadmap.md`** — Current status and post-MVP milestones
- **Per-app docs** — `apps/{app}/docs/` for app-specific architecture, PDRs, code standards
