# fluxion-platform-backend

**Five** self-contained Python 3.12 Lambdas, each with its own dependency tree and intentionally duplicated copies of shared infrastructure files. Designed for independent deployment and testing via AWS CDK Docker bundling.

## Quick facts

- **Five Lambdas**: Resolver, Processor, Checkin, Enroll, Applier (the Applier was split out of Checkin's former SQS mode).
- **Design constraint**: No shared package. Each Lambda dir bundles independently via CDK. Shared files (`config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py`) are copy-pasted across all five dirs; mirror changes across siblings.
- **Two SQS queues**: Separate queues prevent ESM filtering races. Processor consumes `fluxion-action-processor`; Applier consumes `fluxion-action-checkin`.
- **State transitions**: Only the Applier Lambda writes APPLIED/FAILED milestones and flips `devices.current_state_id`. Other Lambdas enqueue only.
- **Single-flight lock**: `devices.assigned_action_id` set by Processor (SELECT FOR UPDATE + WHERE NULL), cleared by Applier.

## Lambda breakdown

| Lambda | HTTP/SQS | Responsibilities |
|--------|----------|------------------|
| **resolver** | AppSync direct | GraphQL query/mutation dispatch; `uploadImei` writes inline (sync); `dispatchAction` validates + enqueues only |
| **processor** | SQS `fluxion-action-processor` consumer | Sole request-initiator: acquires lock, writes REQUESTED milestones, routes to FCM or re-enqueue |
| **checkin** | HTTP `/v1/checkin` (FastAPI) | Device heartbeat + command pull (PULL); ack validation + enqueue (ACK); no state writes |
| **enroll** | HTTP `/v1/enroll` (FastAPI) | IMEI validation, api_key issuance, enqueue ENROLL; no state write |
| **applier** | SQS `fluxion-action-checkin` consumer | Sole transition writer: writes APPLIED/FAILED, flips state, clears lock, auto-chains (ENROLL → ACTIVATE) |

See `docs/system-architecture.md` for the full pipeline diagram and per-Lambda responsibilities.

## Why no shared package

CDK Docker bundling treats each Lambda directory as one self-contained asset. A `shared/` package requires:
- Extra Docker volume mount
- Extra pip install step  
- `assetHashType: OUTPUT` (expensive, recomputes hash on every shared change)

Duplicated shared files trade DRY for independent deploys: changing one Lambda's file rebundles only that Lambda, not all five. Acceptable because the shared code is small and stable.

**When you edit a shared file** (`config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py`), mirror the change across all siblings (`../fluxion-platform-{resolver,processor,checkin,enroll,applier}/`).

## Directory structure

```
fluxion-platform-backend/
├── docs/                              # Backend-level umbrella documentation
│   ├── project-overview-pdr.md        # Platform overview + PDR
│   ├── codebase-summary.md            # Architecture + module index
│   ├── code-standards.md              # Patterns, conventions, shared files
│   ├── system-architecture.md         # Detailed pipelines + Mermaid diagrams
│   └── project-roadmap.md             # Phases, milestones, known gaps
├── fluxion-platform-resolver/
│   ├── docs/                          # Resolver-specific module docs
│   ├── handler.py                     # AppSync dispatch (routes by GraphQL fieldName)
│   ├── resolvers/                     # Per-entity modules: device.py, milestone.py, action.py, etc.
│   ├── auth.py                        # Cognito identity → user upsert
│   ├── config.py constants.py db.py errors.py sqs_client.py  # Shared (copy)
│   └── requirements.txt
├── fluxion-platform-processor/
│   ├── docs/                          # Processor-specific module docs
│   ├── handler.py                     # SQS consumer, lock acquisition, routing logic
│   ├── fcm_dispatcher.py              # Firebase Cloud Messaging push (never raises)
│   ├── config.py constants.py db.py errors.py sqs_client.py  # Shared (copy)
│   └── requirements.txt
├── fluxion-platform-checkin/
│   ├── docs/                          # Checkin-specific module docs
│   ├── handler.py                     # Mangum entrypoint
│   ├── app.py                         # FastAPI app
│   ├── routes/checkin_route.py        # POST /v1/checkin (PULL + ACK)
│   ├── auth.py                        # DPC api_key validation (bearer token, SHA-256)
│   ├── config.py constants.py db.py errors.py sqs_client.py  # Shared (copy)
│   └── requirements.txt
├── fluxion-platform-enroll/
│   ├── docs/                          # Enroll-specific module docs
│   ├── handler.py                     # Mangum entrypoint
│   ├── app.py                         # FastAPI app
│   ├── routes/enroll.py               # POST /v1/enroll (IMEI validate, key issue, enqueue)
│   ├── auth.py                        # Api_key issuance (mdm_live_ prefix, hash stored)
│   ├── config.py constants.py db.py errors.py sqs_client.py  # Shared (copy)
│   └── requirements.txt
├── fluxion-platform-applier/
│   ├── docs/                          # Applier-specific module docs
│   ├── handler.py                     # SQS event dispatch
│   ├── sqs_consumer.py                # State transition logic (sole writer)
│   ├── config.py constants.py db.py errors.py sqs_client.py  # Shared (copy)
│   └── requirements.txt
├── CLAUDE.md                          # Backend-level guidance
└── README.md                          # This file
```

## Action classification

Actions are routed based on classification. See `constants.py` in any Lambda for the canonical source.

| Category | Actions | Path | FCM | Re-enqueue |
|----------|---------|------|-----|------------|
| **Inline** | UPLOAD | GraphQL `uploadImei` (sync) | — | — |
| **System-applied** | REGISTER, ENROLL | Processor → Applier (via checkin queue) | No | Yes |
| **Device-bound** | ACTIVATE, LOCK, UNLOCK, NOTIFY_FROM_*, RELEASE_FROM_* | Processor (FCM) → device `/v1/checkin` ack → Applier | Yes | No |

## Code conventions

- **Naming**: Directories + top-level files are kebab-case; files inside Python packages (`routes/`, `resolvers/`) are snake_case (Python imports can't use `-`).
- **DB**: Single module-global psycopg connection, `dict_row`, `autocommit=True`. Multi-statement writes in `with db.conn.transaction():`. All params via `%(name)s` (no interpolation).
- **Config**: Env vars read at import time. Importing `config.py` configures root logger (side effect). AWS clients lazy.
- **Errors**: Raise typed `AppError` subclasses (UPPER_SNAKE code). HTTP Lambdas map to JSON with `error_code` + `retry_strategy`.
- **Logging**: Format is `<service>.<event> key=value`. Applier keeps historical `checkin_sqs.` prefix for log continuity.

## Documentation structure

- **Backend-level** (`docs/` at this directory): Architecture, cross-Lambda invariants, shared patterns, status.
- **Per-Lambda** (`docs/` in each Lambda dir): Module reference, CLAUDE.md guidance specific to that Lambda.
