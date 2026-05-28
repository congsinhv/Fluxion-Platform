<div align="center">

# Fluxion

### An AWS-native Mobile Device Management (MDM) platform for Android Device Policy Controller (DPC) fleets

[![React](https://img.shields.io/badge/React-18-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Kotlin](https://img.shields.io/badge/Kotlin-Compose-7F52FF?style=flat-square&logo=kotlin&logoColor=white)](https://kotlinlang.org)
[![AWS CDK](https://img.shields.io/badge/AWS_CDK-TypeScript-FF9900?style=flat-square&logo=amazonaws&logoColor=white)](https://aws.amazon.com/cdk/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![GraphQL](https://img.shields.io/badge/GraphQL-AppSync-E10098?style=flat-square&logo=graphql&logoColor=white)](https://graphql.org)

</div>

---

## Abstract

**Fluxion** is a cloud-native platform for enrolling, monitoring, and remotely controlling
fleets of Android devices provisioned as **Device Owner** through the Android Device Policy
Controller (DPC) APIs. It targets inventory and device-financing use cases, where an operator
must be able to **lock, unlock, notify, and release** a managed device on demand with a complete,
auditable record of every state change.

The system is built entirely on AWS managed services — no long-running servers. A React admin console
(custom Tailwind design, no shadcn/ui) talks to GraphQL (AppSync); a serverless backend of **5 Python
Lambdas** (Resolver, Processor, Enroll, Checkin, **Applier**) drives a strict device state machine; commands
are delivered to devices via Firebase Cloud Messaging (FCM) push and pulled by an **event-driven Android
CheckinWorker** (FCM wake, post-execute, back-online, app boot — no periodic polling). Every transition
is recorded as an immutable **milestone**, and a database-level `FOR UPDATE` concurrency lock guarantees
only one action is ever in-flight per device.

The **Applier** Lambda is the sole writer of state transitions, receiving both server-applied actions
(REGISTER/ENROLL) and device acknowledgments (ACTIVATE/LOCK/UNLOCK/NOTIFY/RELEASE), with idempotent
ACK handling via `command_id` deduplication.

> Developed as a capstone engineering project. The emulator path provisions Device Owner via
> `adb shell dpm set-device-owner`; production path uses QR-code provisioning (post-MVP).

## Table of Contents

- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Core Domain: The Device State Machine](#core-domain-the-device-state-machine)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Documentation](#documentation)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Verification](#verification)
- [Scope & Limitations](#scope--limitations)
- [Future Work](#future-work)

## Key Features

- **Full device lifecycle management** — register → enroll → activate → lock / unlock → release, each
  transition guarded by an explicit state machine.
- **Remote command delivery in ~3 s** — FCM `wake` push prompts an immediate device check-in, instead
  of waiting for the polling interval.
- **Complete audit trail** — every requested, applied, and failed action is persisted as a milestone
  row with actor, timestamps, and payload.
- **Single-flight concurrency control** — a conditional database update serializes actions per device,
  preventing conflicting commands from racing.
- **Configuration-driven** — states, actions, and message templates are seeded through database
  migrations rather than hard-coded in application logic.
- **Serverless and self-contained** — 5 independently deployable Lambdas, no servers to operate.
- **Secure by default** — Cognito-authenticated admin console, secrets in AWS Secrets Manager, RDS public
  for dev (private subnet + bastion post-MVP), strict CSP on the frontend.

## System Architecture

![Fluxion high-level architecture](assets/architecture.png)

The platform separates two traffic planes inside a single AWS account (`ap-southeast-1`):

- **Control plane (operators)** — the React admin console authenticates against **Amazon Cognito** and
  issues GraphQL operations to **AWS AppSync**. AppSync invokes the **Resolver** Lambda directly; write
  mutations (e.g. `dispatchAction`) enqueue work onto an SQS queue.
- **Device plane (DPC devices)** — the **Processor** Lambda consumes the queue and sends an FCM
  `wake=true` push. The Android device then calls `/v1/enroll` and `/v1/checkin` through **API Gateway**,
  handled by the dual-mode **Check-in** Lambda, which acknowledges the command and writes the milestone.

Four design decisions are central:

- **Two SQS queues, not one.** Single queue + ESM filtering races (non-matching consumer deletes before
  matching can poll). Separate queues (`processor` originator, `checkin` applier) + shared DLQ eliminate it.
- **Database-level concurrency lock.** `devices.assigned_action_id` is set with `WHERE assigned_action_id IS NULL`,
  so only one action is in-flight per device. Processor holds lock while originating; Applier clears on APPLIED/FAILED.
- **Sole transition writer.** Only Applier writes APPLIED/FAILED milestones and flips state. Other Lambdas
  enqueue; Applier executes. Prevents race between transition + lock release.
- **Event-driven device checkin.** Android CheckinWorker triggers on FCM wake, post-execute, back-online, app boot.
  No periodic polling. Server returns `next_checkin_in` for reference only.

## Core Domain: The Device State Machine

Devices move through six states, driven by typed **actions** with a defined `fromState` and
`targetState` and an actor (`OPERATOR` or `SYSTEM`). The canonical onboarding lifecycle produces a
fixed trail of ten milestones.

```mermaid
stateDiagram-v2
    direction TB

    [*] --> IDLE: UPLOAD
    IDLE --> REGISTERED: REGISTER (system)
    REGISTERED --> ENROLLED: ENROLL
    ENROLLED --> ACTIVE: ACTIVATE (auto-chained)
    ACTIVE --> LOCKED: LOCK
    LOCKED --> ACTIVE: UNLOCK
    ACTIVE --> RELEASED: RELEASE_FROM_ACTIVE
    LOCKED --> RELEASED: RELEASE_FROM_LOCKED
    RELEASED --> [*]

    note right of ACTIVE
        NOTIFY_FROM_ACTIVE
        in-place, no state change
    end note
    note right of LOCKED
        NOTIFY_FROM_LOCKED
        in-place, no state change
    end note
```

Each action type is routed to where it executes:

| Action(s)                                   | Execution path                                   | FCM | Re-enqueue |
| ------------------------------------------- | ------------------------------------------------ | --- | ---------- |
| `UPLOAD`                                     | inline in GraphQL `uploadImei`                   | —   | —          |
| `ENROLL`                                     | Enroll Lambda issues `api_key` → Processor → Check-in queue (async) | No  | Yes        |
| `REGISTER` (system)                          | Processor → Check-in queue                       | No  | Yes        |
| `ACTIVATE`, `LOCK`, `UNLOCK`, `NOTIFY_*`, `RELEASE_*` | Processor → FCM wake → device `/v1/checkin` ack | Yes | No         |

## Technology Stack

| Layer            | Technologies                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Admin Console**| React 18, Vite, TypeScript, Apollo Client, Amazon Cognito                          |
| **Admin Backend**| Python 3.12 Lambda (AppSync direct resolvers), psycopg, Firebase Admin SDK         |
| **DPC Backend**  | Python 3.12 Lambda (FastAPI + Mangum on API Gateway HTTP), SQS consumer            |
| **DPC Client**   | Kotlin/Compose (minSdk 28, target 34), Retrofit, FCM, WorkManager (event-driven, no polling), DevicePolicyManager |
| **Messaging**    | Amazon SQS (two queues + DLQ), Firebase Cloud Messaging                            |
| **Database**     | PostgreSQL 15 (Amazon RDS in production, Docker locally), Alembic migrations       |
| **Infrastructure**| AWS CDK (TypeScript): Cognito, RDS, AppSync, API Gateway HTTP, Lambda, SQS, Secrets Manager |
| **Region**       | `ap-southeast-1` (Singapore)                                                       |

## Repository Structure

```
fluxion/
├── apps/
│   ├── fluxion-platform-backend/    # 5 self-contained Python 3.12 Lambdas (52 .py files)
│   │   ├── fluxion-platform-resolver/      # AppSync GraphQL resolvers
│   │   ├── fluxion-platform-processor/     # SQS originator + FCM dispatch
│   │   ├── fluxion-platform-checkin/       # HTTP PULL/ACK gateway
│   │   ├── fluxion-platform-enroll/        # HTTP enrollment entry
│   │   └── fluxion-platform-applier/       # SQS consumer, sole transition writer
│   ├── fluxion-platform-frontend/   # React 18 + Vite + Custom Tailwind (2429 LOC)
│   └── fluxion-platform-client/     # Kotlin/Compose Android, event-driven (1852 LOC)
├── infra/                           # AWS CDK (TypeScript) + GraphQL SDL (source of truth)
├── scripts/
│   └── db/                          # Alembic migrations (6 files: init + seeds)
│   # (operational scripts kept local, not committed)
├── docs/                            # Project documentation
├── docker-compose.yml               # Local PostgreSQL
└── package.json                     # npm workspaces + root scripts
```

See `apps/*/README.md` for module-specific detail.

## Documentation

Comprehensive documentation is organized in the `docs/` directory:

- **[Project Overview & PDR](docs/project-overview-pdr.md)** — Platform scope, users, value propositions, tech stack
- **[Codebase Summary](docs/codebase-summary.md)** — Monorepo structure, per-app overview, LOC counts
- **[System Architecture](docs/system-architecture.md)** — Component topology, queue flows, state machine, diagrams (Mermaid v11)
- **[Code Standards](docs/code-standards.md)** — Naming conventions, ruff config, Lambda duplication rule, commit conventions
- **[Deployment Guide](docs/deployment-guide.md)** — Full deploy runbook, local setup, post-deploy verification, troubleshooting
- **[Project Roadmap](docs/project-roadmap.md)** — MVP status, post-MVP phases, timeline, known limitations

Per-app documentation in `apps/{app}/docs/` covers app-specific architecture and requirements.

## Getting Started

### Prerequisites

- Node.js ≥ 20 and npm
- Python 3.12
- Docker (for local PostgreSQL)
- An AWS account + AWS CLI (for deployment)
- Android Studio with a Google APIs emulator image (for the DPC client)

### Local development

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL (Docker) and run migrations
npm run db:up
npm run db:migrate          # alembic upgrade head — also seeds states/actions/templates
npm run db:fixtures         # optional: load local sample data, if available

# 3. Run the admin console
cp apps/fluxion-platform-frontend/.env.example apps/fluxion-platform-frontend/.env
npm --workspace apps/fluxion-platform-frontend run codegen   # generate GraphQL types
npm --workspace apps/fluxion-platform-frontend run dev        # http://localhost:5173
```

The local database is reachable at `postgresql+psycopg://fluxion:fluxion@localhost:5432/fluxion`.

### Android DPC client

```bash
cd apps/fluxion-platform-client
cp local.properties.example local.properties      # set sdk.dir, DPC_BASE_URL, DPC_INTERNAL_API_KEY
# place app/google-services.json (Firebase config) — gitignored
./gradlew :app:assembleDebug
./gradlew :app:installDebug
./scripts/adb-enroll.sh                            # sets the app as Device Owner
```

> The emulator must use a **Google APIs** system image — not Google Play (preinstalls an account
> that blocks Device Owner) and not AOSP (no Play Services, hence no FCM).

## Deployment

```bash
cd infra
npm install
npx cdk bootstrap --profile fluxion-dev
npx cdk deploy   --profile fluxion-dev
```

After the first deploy, populate the `fluxion/firebase-service-account` secret, create an admin user
via an admin-user provisioning script, and copy the stack outputs into the frontend `.env` and the
client `local.properties`. The GraphQL SDL at `infra/schema/appsync.graphql` is the single source of
truth for both AppSync and frontend code generation.

## Verification

There is no automated Python unit-test suite; end-to-end correctness is validated by
an end-to-end lifecycle test, which drives every endpoint against a **deployed** stack and asserts:

- the canonical ten-milestone lifecycle trail,
- the concurrency lock rejects parallel `dispatchAction` calls, and
- `/v1/checkin` acknowledgements are idempotent.

The frontend has unit tests (`npm --workspace apps/fluxion-platform-frontend run test`) covering
action-availability logic and milestone grouping.

## Scope & Limitations

- **Provisioning** — demonstrated via emulator Device Owner; production QR-code provisioning is designed
  but not part of the demo build.
- **Real-time updates** — admin pages poll every 10 s; GraphQL subscriptions are out of scope for the MVP.
- **IMEI on emulators** — derived from `Settings.Secure.ANDROID_ID` (no SIM), so the operator must upload
  that exact derived value before enrolling.
- **Internal API key** — the DPC uses a shared key in `BuildConfig`, acceptable for the demo build; Play
  Integrity attestation is the post-MVP hardening path.

## Future Work

- QR-code / NFC zero-touch provisioning for production fleets
- GraphQL subscriptions to replace 10 s polling
- Per-tenant Firebase projects and stricter service isolation
- Play Integrity attestation in place of the static internal API key
- RDS access hardening (bastion / SSH tunnel automation)
