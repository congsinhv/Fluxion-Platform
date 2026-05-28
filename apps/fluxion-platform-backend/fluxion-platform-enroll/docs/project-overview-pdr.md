# Fluxion Enroll — Project Overview & PDR

## Module Purpose

Fluxion Enroll Lambda handles device enrollment in the Fluxion DPC fleet management platform. It exposes a single HTTP endpoint (`POST /v1/enroll`) where devices submit enrollment requests during the EULA acceptance flow after factory reset. The handler issues per-device api keys, validates device state, and enqueues the ENROLL action to the SQS processor pipeline for downstream consumption.

**Service Role:** Device-initiated enrollment gateway (HTTP-only, no SQS consumer).

## Functional Requirements

1. **IMEI Validation** — Accept POST /v1/enroll with 15-digit IMEI. Reject invalid format with 400 INVALID_IMEI_FORMAT.
2. **Device Lookup** — Query `devices` table by IMEI with FOR UPDATE lock. Return 404 DEVICE_NOT_FOUND if missing.
3. **State Guard** — Device must be in REGISTERED state. Return 409 INVALID_STATE if ENROLLED/ACTIVE/LOCKED/RELEASED.
4. **API Key Generation** — Generate `mdm_live_<32-char-token>`, store SHA-256 hash only. Return plaintext to client exactly once.
5. **Device Metadata Update** — Atomically update device fields in single transaction: api_key_hash, fcm_token, info dict, first_checkin_at (if unset), last_checkin_at.
6. **Pipeline Enqueue** — After commit, enqueue ENROLL action to processor queue with target_service=processor, no pre-set assigned_action_id (processor originates the lock).
7. **Response Format** — Return device_id, api_key (plaintext), checkin_endpoint, checkin_interval (3600), server_time (ISO 8601).

## Non-Functional Requirements

- **Transaction Safety:** All device updates in one FOR UPDATE + transaction block. SQS enqueue outside transaction (fire-and-forget after commit).
- **Idempotency:** Not idempotent. Enroll operates on REGISTERED devices only; re-enrollment returns 409 (safe by DPC policy preventing app uninstall/factory reset after EULA accept).
- **Performance:** Millisecond latency expected; one device lookup + one SQS message per request.
- **Logging:** Log enrollment success (device_id, IMEI), enqueue success (SQS MessageId), and all errors with retry_strategy.

## Acceptance Criteria

- [x] POST /v1/enroll accepts valid IMEI + device_info + optional fcm_token.
- [x] Validates IMEI is exactly 15 digits; rejects malformed with 400.
- [x] Device lookup returns 404 if IMEI not in devices table.
- [x] State validation returns 409 if device not in REGISTERED state.
- [x] api_key issued as mdm_live_<32-char>, hash stored, plaintext returned once.
- [x] device.api_key_hash, fcm_token, info, timestamps updated atomically.
- [x] ENROLL enqueued to processor with branch=enroll extra.
- [x] Response includes device_id, api_key, checkin_endpoint, interval, server_time.
- [x] Errors return structured JSON with error_code, message, retry_strategy.
- [x] GET /v1/health and /healthz health checks return status + service + version + timestamp.

## Scope Boundaries

### Does NOT

- Write milestones (processor originates REQUESTED; applier writes APPLIED).
- Flip device state (applier — sole consumer of the checkin queue — applies REGISTERED→ENROLLED transition).
- Set assigned_action_id / single-flight lock (processor sets under its own FOR UPDATE).
- Chain ACTIVATE (auto-chained by applier after ENROLL APPLIED).
- Support re-enrollment (returns 409 for ENROLLED/ACTIVE devices; safe by DPC EULA policies).
- Consume SQS messages (HTTP-only entry point).
- Send FCM notifications (processor's responsibility).

### Does

- Validate IMEI format and device existence + state.
- Generate and store hashed api_keys.
- Update device metadata (fcm_token, device_info, timestamps) in one transaction.
- Enqueue ENROLL to processor with target_service label.
- Return structured error responses with HTTP status + error_code + retry_strategy.

## Architecture Context

**Position in SQS Pipeline:**
```
Device POST /v1/enroll
  ↓
Enroll Lambda (this module)
  ├─ validate + lock device (FOR UPDATE)
  ├─ issue api_key
  ├─ update device fields
  └─ enqueue ENROLL to processor queue
       ↓
       Processor Lambda
         ├─ lock device (FOR UPDATE)
         ├─ write REQUESTED milestone
         ├─ set assigned_action_id
         └─ enqueue to checkin queue
              ↓
              Applier Lambda (sole consumer of checkin queue)
                ├─ read ENROLL + device state
                ├─ write APPLIED milestone
                ├─ flip REGISTERED→ENROLLED
                └─ auto-chain ACTIVATE enqueue (back into processor queue)
```

**Data Model Touchpoints:**
- `devices` table: locked by IMEI, updated (api_key_hash, fcm_token, info, first_checkin_at, last_checkin_at, service_id sync).
- `states` table: lookup REGISTERED state.
- `actions` table: lookup ENROLL action.
- `milestones` table: NOT written by enroll (processor writes REQUESTED; applier writes APPLIED/FAILED).

## Version & Status

- **Version:** 0.1 (initial release, single POST /v1/enroll endpoint)
- **Status:** Stable for REGISTERED→ENROLLED transition. Re-enrollment explicitly unsupported by design.

## Known Limitations

1. **No unit tests** — E2E tested via an end-to-end lifecycle test.
2. **No re-enrollment support** — Safe only while DPC policy hard-disables app uninstall + factory-reset on EULA accept.
3. **No api_key rotation** — Future feature; deferred pending DPC shared key integration.
4. **Plaintext api_key returned once** — Device must store it locally; no recovery path if lost (must factory reset).

## Dependencies

- **PostgreSQL 15+** — devices, states, actions, milestones tables.
- **SQS** — processor queue for ENROLL action enqueue.
- **AWS Secrets Manager** — DB credentials (DB_SECRET_ARN), optionally DPC shared key (DPC_SHARED_KEY_SECRET_ARN).
- **FastAPI 0.115+** — HTTP framework.
- **psycopg 3.2+** — PostgreSQL driver (asyncio + dict_row).
- **boto3 1.34+** — AWS SDK (SQS, Secrets Manager).

## Success Metrics

- Enrollment latency < 100ms (device perceives immediate checkin endpoint delivery).
- 99.9% uptime (single Lambda, no downstream dependencies blocking request).
- Zero api_key collisions (32-char token + SHA-256 uniqueness).
- 100% state validation (no ENROLLED device re-enrolls via 409 guard).
