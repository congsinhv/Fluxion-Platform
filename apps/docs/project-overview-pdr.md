# Fluxion Platform — Project Overview & PDR

## What is Fluxion?

Fluxion is an **AWS-native Android MDM (Mobile Device Management)** platform for managing corporate Device Owner (DPC) fleets. Deployed in `ap-southeast-1`, serverless with no long-running servers.

**User roles:**
- **Operators** (admin console users): View enrolled devices, dispatch commands (LOCK/UNLOCK/notify), manage templates and device TACs (Trusted App Catalog).
- **Devices** (Android DPC clients): Receive commands via FCM, report state via heartbeat check-ins, apply device policies.

## Functional Requirements

### Device Onboarding (MVP Complete)
- **IMEI enrollment**: Single-device upload or bulk batch (batch deferred post-MVP).
- **State transitions**: IDLE → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED.
- **Canonical 10-milestone lifecycle**: UPLOAD, REGISTER, ENROLL, ACTIVATE, LOCK (on operator command), plus auto-transitions.
- **Idempotent acks**: Device can re-send command results without double-applying state changes.

### Operator Control
- **Device management**: List devices (with state/service filters), view details including milestone history.
- **Command dispatch**: Lock/unlock, release, send notifications (for app-store prompts, etc.).
- **Configuration**: Manage message templates, TAC entries, read state/action metadata.
- **Upload interface**: Single IMEI form + history tracker.

### Command Execution
- **Device-bound actions**: LOCK (kiosk mode), UNLOCK, NOTIFY.
- **FCM wake**: Device receives data push, checks in to fetch commands.
- **Fallback**: If device is offline, applier re-enqueues; eventually-consistent delivery.

### Non-Functional Requirements
- **Single-flight lock**: Only one action in-flight per device (prevents race conditions).
- **Eventually-consistent state**: No synchronous transitions; dispatchAction enqueues only.
- **Idempotent transitions**: All state changes are idempotent on command_id (device-bound) or action_id (system-bound).
- **10s polling frontend**: No GraphQL subscriptions; admin console polls every 10 seconds for real-time visibility.
- **E2E lifecycle test**: An end-to-end lifecycle test validates 10-milestone trail, lock rejection, ack idempotency against deployed stack.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│  React Admin Console (frontend)                             │
│  - Device list, detail, dispatch actions, config CRUD      │
│  - Polls GraphQL every 10s (no subscriptions)              │
└─────────────────────────────────────────────────────────────┘
                            │
                     AppSync GraphQL (Cognito auth)
                            │
┌─────────────────────────────────────────────────────────────┐
│  AWS Lambda: resolver (AppSync dispatch)                    │
│  - QUERY: listDevices, getDevice, listMilestones, etc.     │
│  - MUTATION: uploadImei (inline), dispatchAction (enqueue) │
└─────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴────────┐
                    │                │
            SQS processor queue  HTTP enroll/checkin
                    │                │
    ┌───────────────┴────┐    ┌──────┴──────────┐
    │                    │    │                 │
 processor Lambda    enroll/checkin Lambda  Device (Kotlin DPC)
 (REQUESTED only)    (enroll: api_key)      (FCM wake + checkin)
    │                    │    │                 │
    └────────┬────────────┴────┴──────────┐    │
             │                            │    │
          SQS checkin queue        [device ack]─┘
             │
    applier Lambda (APPLIED/FAILED + state flip)
             │
    PostgreSQL 15 (device state + milestone audit log)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Admin Console** | React 18 + Vite + TypeScript + Apollo Client + Cognito |
| **GraphQL API** | AWS AppSync + 5 Python 3.12 Lambdas |
| **Device Client** | Kotlin 1.9 + Jetpack Compose + DPC (Device Owner) |
| **Database** | PostgreSQL 15 (local Docker) + Alembic migrations |
| **Messaging** | SQS (2 queues) + FCM data push |
| **Infrastructure** | AWS CDK (TypeScript) deployed via `fluxion-dev` profile |
| **Region** | `ap-southeast-1` |

## Known Demo Limitations (Accepted Trade-offs)

| Item | Current State | Reason |
|------|---|---|
| CSV batch IMEI upload | Single IMEI only (deferred) | MVP scope |
| GraphQL subscriptions | Polling every 10s | No subscriptions; eventually consistent |
| Frontend pagination | First 100–200 devices, no next-page button | MVP scope |
| DPC API authentication | Static shared key in BuildConfig | Demo only; production would use external key loader |
| JWT storage | localStorage (XSS trade-off) | Accepted; production would move to secure storage |
| FCM wake recovery | Dropped wake while online not recovered | Accepted; device ack from next wake will recover |
| Python testing | E2E only (end-to-end lifecycle test) | No unit test suite |
| Android testing | Manual (no instrumented/unit tests) | Manual lifecycle validation |
| DB fixtures | `npm run db:fixtures` broken (missing SQL) | Deferred; not blocking MVP |

## Capstone Context

Fluxion is an academic capstone project with the following guardrails:
- **Single-developer focus**: Designed for clear ownership and straightforward debugging.
- **AWS-native, serverless**: No ops burden; pay-per-request model aligns with capstone constraints.
- **Eventually-consistent architecture**: Simplifies race-condition handling vs. strong consistency.
- **Manual validation**: E2E script + manual mobile testing, no CI/CD matrix testing.

## Success Criteria

✅ Device enrollment and state transitions work idempotently end-to-end.
✅ Operator can dispatch commands and see device state in admin console.
✅ FCM wake and checkin correctly apply device-borne and server-borne actions.
✅ State machine is seeded from DB (not hardcoded) and mutable via migrations.
✅ E2E lifecycle test passes against deployed stack.
✅ No broken dependencies on non-existent code paths (verified by code review).

## Future Work (Post-MVP)

1. **CSV batch IMEI import** — Bulk device enrollment.
2. **GraphQL subscriptions** — Real-time admin console updates.
3. **Python unit tests** — Per-Lambda test suites.
4. **Pagination cursors** — Full device list navigation.
5. **Android instrumented tests** — Emulator-driven validation.
6. **Production auth** — External API key loader; remove static BuildConfig key.
