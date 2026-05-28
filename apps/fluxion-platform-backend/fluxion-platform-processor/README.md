# Fluxion Processor Lambda

SQS consumer that claims single-flight per-device concurrency lock, originates REQUESTED milestones, and routes action side effects (FCM wake-push or server-applied re-enqueue).

## What it does

- Consumes `fluxion-action-processor` SQS queue
- Acquires `SELECT ... FOR UPDATE` per-device lock
- Initiates actions with idempotent REQUESTED milestone writes
- Routes SYSTEM_ACTIONS (REGISTER, ENROLL) → checkin queue
- Routes DEVICE_BOUND_ACTIONS → FCM data-only wake-push
- Returns batchItemFailures for partial SQS retry

**Critical invariant:** Processor only writes REQUESTED milestones. Applier owns APPLIED/FAILED writes and state transitions.

## File map

| File | Role | LOC |
|------|------|-----|
| `handler.py` | SQS consumer, transaction control, routing logic | 152 |
| `db.py` | psycopg wrapper, FOR UPDATE lock, milestone inserts | 175 |
| `fcm_dispatcher.py` | Firebase Admin init & dispatch, permanent mock fallback | 85 |
| `config.py` | Env vars, lazy AWS clients, root logger | 58 |
| `constants.py` | Action classification, SQS routing labels, tuning | 51 |
| `errors.py` | Typed AppError base + subclasses | 54 |
| `sqs_client.py` | SQS enqueue helper, queue URL routing | 53 |

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `LOG_LEVEL` | INFO | Root logger level |
| `AWS_REGION` | ap-southeast-1 | AWS region (override: `AWS_REGION_OVERRIDE`) |
| `DATABASE_URL` | unset | Local psycopg URL (takes precedence if set) |
| `DB_ENDPOINT` | unset | Prod RDS endpoint (requires `DB_SECRET_ARN`) |
| `DB_SECRET_ARN` | unset | Secrets Manager ARN for DB credentials |
| `FIREBASE_SECRET_ARN` | unset | Secrets Manager ARN for Firebase service account (empty = permanent mock) |
| `PROCESSOR_QUEUE_URL` | unset | SQS queue to consume |
| `CHECKIN_QUEUE_URL` | unset | SQS queue for server-applied actions |
| `CHECKIN_PUBLIC_URL` | https://api.mdm.dev/v1/checkin | Device checkin endpoint (in FCM payload) |

## Local development

**Setup:**
```bash
# Install deps
pip install -r requirements.txt

# Set DATABASE_URL for local PostgreSQL
export DATABASE_URL="postgresql://fluxion:fluxion@localhost:5432/fluxion"
export LOG_LEVEL=DEBUG

# Unset Secrets Manager env vars to use env vars only
unset DB_SECRET_ARN DB_ENDPOINT FIREBASE_SECRET_ARN
```

**Test locally against deployed stack:**
```bash
# From monorepo root
npm run test:processor
```

## Deployment

Handled by CDK from `infra/`:
```bash
cd infra
npx cdk deploy --profile fluxion-dev
```

See [deployment-guide.md](./docs/deployment-guide.md) for wiring, secrets, and environment setup.

## Documentation

- **[Project Overview & PDR](./docs/project-overview-pdr.md)** — Functional/non-functional requirements, scope boundary
- **[Code Standards](./docs/code-standards.md)** — Conventions, linting, duplication (shared files)
- **[Codebase Summary](./docs/codebase-summary.md)** — Per-file module descriptions, data flow
- **[System Architecture](./docs/system-architecture.md)** — Pipeline position, concurrency model, sequence diagrams
- **[Deployment Guide](./docs/deployment-guide.md)** — CDK wiring, env vars, secrets, queue topology
- **[Project Roadmap](./docs/project-roadmap.md)** — MVP status, post-MVP items

## Related

- **Fluxion Platform:** [Monorepo README](../../../README.md)
- **Backend layout:** [Backend README](../README.md)
- **AWS infra:** [infra/](../../../infra/)
