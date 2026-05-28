# fluxion-platform-applier

The **Applier** is one of 5 self-contained Python 3.12 Lambdas in the Fluxion MDM platform. It consumes the `fluxion-action-checkin` SQS queue and is the sole writer of state transitions: the only Lambda that writes APPLIED/FAILED milestones, flips `devices.current_state_id`, and clears the single-flight lock `devices.assigned_action_id`.

## Role in the Pipeline

```
Processor or Checkin Lambda
         ↓ (enqueue)
   [fluxion-action-checkin queue]
         ↓ (this Lambda)
   ├─ Write APPLIED/FAILED milestone
   ├─ Flip device.current_state_id (on SUCCESS)
   ├─ Clear device.assigned_action_id lock
   └─ Auto-chain ENROLL → ACTIVATE (re-enqueue to processor)
```

Two message shapes arrive here:
- **Device-ack** (`extras.result` present): Device reported a command result via `POST /v1/checkin`. Write APPLIED (SUCCESS) or FAILED; flip state on SUCCESS; clear lock.
- **Server-applied** (result absent): System actions (REGISTER, ENROLL) with no device ack needed. Write APPLIED, flip state, clear lock, then auto-chain the next action.

## Message Contract

**Input (SQS queue `fluxion-action-checkin`):**
```json
{
  "target_service": "checkin",
  "device_id": "uuid",
  "action_id": "uuid",
  "command_id": "optional string (for device-ack resolution)",
  "template_id": "optional uuid",
  "requested_by_id": "optional uuid",
  "extras": {
    "result": {
      "status": "SUCCESS or FAILED",
      "executed_at": "optional ISO8601",
      "error": "optional error payload"
    },
    "branch": "optional metadata"
  }
}
```

**Processing:**
- `target_service != "checkin"` → skip (no batch failure).
- Bad JSON → batch failure (redelivery → DLQ).
- Exception → batch failure; logged with full context.
- Idempotent via `command_id` (device-ack) and APPLIED milestone check (server-applied).

**Output:** `{"batchItemFailures": []}` on success; partial batch failures allowed.

## Local Development

All tooling commands run from the monorepo root (`/Users/synhvo/RSU/Fluxion-Platform`):

```bash
npm run lint / lint:fix           # Ruff check/fix all Python
npm run fmt / fmt:check          # Ruff format (line-length 100, py312)
npm run db:up / db:down          # Local PostgreSQL (Docker)
npm run db:migrate               # Alembic upgrade + seed state machine
python3 -m py_compile handler.py # Quick syntax check
```

Local database: `postgresql+psycopg://fluxion:fluxion@localhost:5432/fluxion`

**Testing:** No unit-test suite. Verification is end-to-end via an end-to-end lifecycle test against a deployed stack (tests the 10-milestone canonical lifecycle, concurrency-lock rejection, idempotent acks). Deploy via:
```bash
cd infra && npx cdk deploy --profile fluxion-dev
```

## Key Invariants

1. **Device-ack resolution by `command_id`, not `action_id`** — device-bound actions repeat across lifecycle (LOCK → UNLOCK → LOCK reuse `action_id`). Stale SQS redeliveries of old cycles must no-op without touching live cycles' locks.
2. **Single-flight lock** — Processor acquires `assigned_action_id` (WHERE NULL); Applier clears it. Only one action in-flight per device.
3. **All state reads/writes in one transaction** — `lock_device_by_id` (SELECT FOR UPDATE) ensures consistency; side effects (SQS enqueue for auto-chain) only after commit.
4. **State machine is config-driven** — States, actions, transitions seeded by Alembic migrations, not hard-coded. Lifecycle: IDLE → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED; NOTIFY_* in-place. Canonical onboarding = exactly 10 milestones.
5. **Everything eventually consistent** — Dispatch is validate-and-enqueue only; state flips async. Clients/tests must poll.

## Code Structure

| File | Lines | Role |
|------|-------|------|
| `handler.py` | 25 | Lambda entry; validates Records, delegates to sqs_consumer |
| `sqs_consumer.py` | 262 | Core logic: branches on result (device-ack vs server-applied), locks, writes milestones, clears lock, auto-chains |
| `db.py` | 345 | psycopg wrapper: SELECT FOR UPDATE, milestone queries, state/action lookups, transaction-safe writes |
| `config.py` | 58 | Env vars, lazy boto3 clients, root logger (import side effect) |
| `constants.py` | 51 | Action classification, SQS routing labels, IMEI/API-key formats |
| `sqs_client.py` | 53 | Enqueue helper; picks queue by target_service |
| `errors.py` | 54 | Typed AppError (unused in this Lambda; mirrored across 5 Lambdas) |

**Duplicated across all 5 Lambdas:** `config.py`, `constants.py`, `db.py`, `errors.py`, `sqs_client.py` are full copies (CDK bundles each Lambda dir as self-contained asset). When editing, mirror changes across siblings (`../fluxion-platform-{resolver,checkin,enroll,processor}/`).

## Key Implementation Details

- **SQL binding:** All values `%(name)s` — never f-string interpolated.
- **Transactions:** `with db.conn.transaction():` for multi-statement writes.
- **Logging:** `checkin_sqs.<event> key=value` format (prefix historical, kept for log continuity).
- **Auto-chain:** ENROLL → ACTIVATE, only after commit with "already started" check.
- **Lock clearing:** On idempotent redelivery (APPLIED already exists) or after milestone write.

## Related Documentation

- **Module architecture & invariants:** See `docs/system-architecture.md`
- **Per-file summaries:** See `docs/codebase-summary.md`
- **Code standards & conventions:** See `docs/code-standards.md`
- **Project scope & requirements:** See `docs/project-overview-pdr.md`
- **Known limitations & roadmap:** See `docs/project-roadmap.md`
- **Monorepo context:** See the repo root `README.md` and `apps/fluxion-platform-backend/README.md`
- **Module CLAUDE.md:** This module's AI guidance (e.g., commands, pipeline diagram, invariants)
