# Project Roadmap — Processor Lambda

MVP status and post-MVP items from the Fluxion platform backlog.

## Current status

**Phase:** MVP (Feature-Complete)  
**Version:** 1.0  
**Last updated:** 2026-06-07

| Component | Status | Notes |
|-----------|--------|-------|
| SQS consumer | ✅ Complete | Handles processor queue, skips non-processor messages |
| Per-device lock | ✅ Complete | FOR UPDATE on devices row, idempotent redeliveries |
| REQUESTED milestone | ✅ Complete | Single write per origination, audit trail |
| SYSTEM_ACTIONS routing | ✅ Complete | REGISTER, ENROLL → checkin queue |
| DEVICE_BOUND_ACTIONS routing | ✅ Complete | ACTIVATE, LOCK, UNLOCK, NOTIFY, RELEASE → FCM |
| Firebase integration | ✅ Complete | Lazy init, permanent mock fallback |
| Error handling | ✅ Complete | batchItemFailures, partial retry |
| CDK deployment | ✅ Complete | Single `cdk deploy` command |
| Documentation | ✅ Complete | PDR, code standards, architecture, deployment |

**What's NOT in MVP:**
- FAILED milestone writes (Applier's responsibility)
- State machine transitions (Applier's responsibility)
- Device polling (event-driven only)
- GraphQL mutations (Resolver's responsibility)

## Post-MVP roadmap

### Phase 2: Advanced provisioning (Q3 2026)

#### QR provisioning

**Status:** Planned  
**Description:** Allow admins to provision devices via QR code scans at setup.

**Scope:**
- Generate per-device QR codes containing DPC provisioning payload
- Distribute via admin UI or email
- Device scans QR, initiates enrollment flow
- Processor routes to Enroll Lambda (same as POST /v1/enroll)

**Impact on Processor:** None (Enroll Lambda handles QR → SQS enqueue)

#### Private RDS

**Status:** Planned  
**Description:** Move RDS into private subnet; add VPC endpoint for Lambda access.

**Scope:**
- Remove RDS public accessibility
- Add VPC endpoint for Secrets Manager (credential fetch)
- Update security groups for Lambda → RDS connectivity
- Database URL via Secrets Manager only (no local DATABASE_URL)

**Impact on Processor:**
- ENV var: `DB_SECRET_ARN` becomes mandatory (already supported)
- No code changes; psycopg connection logic unchanged
- Slightly higher latency (VPC routing) — acceptable (<100ms)

### Phase 3: Real-time sync (Q4 2026)

#### GraphQL subscriptions

**Status:** Planned  
**Description:** Stream device state changes to admin UI in real-time via GraphQL subscriptions.

**Scope:**
- Processor publishes milestone to Kinesis/EventBridge on each REQUESTED write
- GraphQL subscription layer (Apollo Server) subscribes to stream
- Admin UI receives state updates without polling

**Impact on Processor:**
```python
# Add after milestone insert
from aws_lambda_powertools.utilities.parser import EventBridgeEvent
import json

# Emit to EventBridge
events_client.put_events(
    Entries=[
        {
            "Source": "processor",
            "DetailType": "MilestoneCreated",
            "Detail": json.dumps({
                "device_id": device_id,
                "event_type": "REQUESTED",
                "action_id": action_id,
                "timestamp": datetime.utcnow().isoformat(),
            }),
        }
    ]
)
```

**Code changes:**
- Import `aws_lambda_powertools`
- Add EventBridge client to config.py
- Call put_events after milestone insert (still inside transaction scope)
- No changes to lock, routing, or milestone write logic

### Phase 4: Enhanced observability (Q4 2026)

#### X-Ray tracing

**Status:** Planned  
**Description:** Add distributed tracing for action lifecycle (Resolver → Processor → Checkin → Device → Applier).

**Scope:**
- Enable X-Ray on Processor Lambda
- Trace database queries (psycopg integration)
- Trace SQS sends (boto3 integration)
- Correlate with upstream Resolver and downstream Checkin traces

**Impact on Processor:**
```python
from aws_lambda_powertools.tracing import Tracer

tracer = Tracer()

@tracer.capture_lambda_handler
def lambda_handler(event: dict, _context) -> dict:
    ...

# Automatic tracing of AWS SDK calls + downstream services
```

#### Structured logging enhancement

**Status:** Planned  
**Description:** Upgrade to AWS Lambda Powertools Logger (replaces raw logging).

**Scope:**
- Migrate from `logging.getLogger()` to `Logger()`
- Structured logging + JSON formatting
- Automatic request ID correlation (X-Ray)
- Log levels per environment (DEBUG local, INFO prod)

**Impact on Processor:**
```python
from aws_lambda_powertools.logging import Logger

logger = Logger()
logger.info("processor.routed", extra={"device_id": device_id, "action": action_type})
```

### Phase 5: Applier integration (2027)

#### FAILED milestone writes

**Status:** Blocked (Applier responsibility)  
**Description:** Processor does NOT write FAILED. Applier writes FAILED after device timeout.

**Current:** If device doesn't ACK within timeout (e.g., 24h), Applier writes FAILED milestone.

**Future enhancement:**
- Processor could set a TTL on assigned_action_id (expires if device doesn't ACK)
- Applier clears the expired lock and writes FAILED
- Processor optionally re-enqueues auto-retry (per action config)

**Impact on Processor:** Minimal (only if implementing auto-retry)

### Phase 6: Multi-region (2027)

**Status:** Speculative  
**Description:** Replicate Processor to additional regions for disaster recovery.

**Scope:**
- Global RDS read replica (async replication)
- Regional SQS queues + DLQ
- Cross-region failover (Route 53 health checks)

**Impact on Processor:** None (stateless Lambda, database handles replication)

## Backlog (lower priority)

| Item | Rationale | Notes |
|------|-----------|-------|
| Async/await refactor | Code simplicity | Python 3.12 supports; SQLAlchemy async models not yet stable |
| Custom metrics | Observability | CloudWatch metrics sufficient for MVP; X-Ray tracing in Phase 4 |
| Processor-to-Applier direct feedback | Observability | Event-driven via milestones sufficient; no tight coupling needed |
| Bulk action dispatch | Performance | SQS handles batches efficiently; no throughput bottleneck observed |
| Action deduplication | Idempotency | Not needed; same action dispatched many times per device (intentional) |

## Success metrics (MVP)

- **Action coverage:** All 9 action types route correctly
- **Lock contention:** Device-busy messages dropped silently, no errors
- **Milestone audit trail:** 10-milestone canonical lifecycle completes with full payload
- **Idempotency:** SQS redelivery of same action_id = idempotent (no double REQUESTED)
- **FCM resilience:** Failures logged, not retried, next checkin proceeds
- **Deployment:** Single `cdk deploy` from infra/, no manual steps
- **Latency:** Batch of 10 messages <5s
- **Error rate:** <0.1% (excludes device-busy silent drops)

## Dependency graph

```
Phase 2 (QR provisioning)
  ↓
  └─ Depends on: Enroll Lambda (already ships QR parsing)
  
Phase 2 (Private RDS)
  ↓
  └─ Depends on: Infrastructure team (VPC, security groups)
  
Phase 3 (GraphQL subscriptions)
  ↓
  ├─ Depends on: Phase 2 complete (stable infra)
  └─ Depends on: Resolver Lambda (subscription schema)
  
Phase 4 (X-Ray + Powertools Logger)
  ↓
  └─ Depends on: Phase 3 complete (all Lambdas instrumented)
  
Phase 5 (Applier integration)
  ↓
  └─ Depends on: Applier Lambda (already ships timeout logic)
  
Phase 6 (Multi-region)
  ↓
  └─ Depends on: All phases complete + ops team
```

## Notes

- **Processor is stable MVP.** No breaking changes expected until Phase 5 (Applier integration).
- **Shared files sync required.** When edits are made to config.py, constants.py, db.py, errors.py, sqs_client.py, sync to sibling Lambdas (Resolver, Checkin, Enroll, Applier).
- **Post-MVP focus:** Observability (X-Ray, structured logging), multi-region HA, GraphQL subscriptions.

