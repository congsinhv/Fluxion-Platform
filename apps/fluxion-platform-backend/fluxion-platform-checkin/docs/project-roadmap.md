# Project Roadmap

## Current Status

**Module:** Fluxion Checkin Lambda  
**Version:** 0.2  
**Status:** Production (deployed, E2E tested)  
**Last Updated:** 2026-06-07

## Phase 1: Core Functionality (✅ Complete)

Device heartbeat (PULL) and command acknowledgment (ACK) via POST /v1/checkin.

- [x] Bearer token authentication (SHA-256 hash)
- [x] IMEI header cross-check
- [x] Device state validation (reject RELEASED)
- [x] Heartbeat updates (last_checkin_at, device_info)
- [x] Command fetch from pending milestones
- [x] ACK validation and idempotency (REQUESTED-scoped)
- [x] SQS enqueue to applier (after transaction commit)
- [x] Notification template resolution
- [x] Error handling with retry strategy
- [x] E2E lifecycle test coverage

## Phase 2: Security Hardening (🔄 Planned)

### P2.1: Play Integrity Attestation
**Priority:** High  
**Effort:** 2-3 sprints  
**Status:** Design phase  

Replace static `DPC_SHARED_KEY` with dynamic Play Integrity API attestation:
- Device sends signed attestation token in POST /v1/checkin header
- Checkin Lambda validates token (timing, device binding, app signature)
- Reject checkins without valid attestation

**Impact:** Authenticates genuine Kotlin DPC client; prevents spoofing.

**File Changes:**
- `auth.py` — add `validate_play_integrity_token()`
- `routes/checkin_route.py` — extract + validate attestation before bearer check
- `requirements.txt` — add Google Play Integrity Python client

**Blocked by:** Secrets Manager setup for Play Integrity API credentials (platform CDK).

### P2.2: RDS Hardening
**Priority:** Medium  
**Effort:** 1 sprint (platform-level)  
**Status:** Backlog  

Platform-level CDK improvements (not module-specific):
- VPC endpoint for RDS (private subnet)
- RDS encryption at rest
- IAM-based auth (replace password)

**Impact on Checkin:** None (transparent); credentials updated via Secrets Manager.

## Phase 3: QR-Code Provisioning (📋 Planned)

**Priority:** Medium  
**Effort:** 2-3 sprints  
**Status:** Design phase  

Add device provisioning via QR code (reduces manual enrollment friction):
- Device scans QR → pre-populated enrollment form
- QR contains: enrollment token (short-lived, one-time-use)
- Checkin validates token before device transitions from IDLE

**Impact:** Faster device onboarding; one-time enrollment links.

**New Endpoint:**
- `POST /v1/enroll-validate?token=<one-time-token>` — validate enrollment token
- Returns: enrollment status, next steps

**File Changes:**
- `routes/` — add `enrollment_validate_route.py`
- `auth.py` — add `validate_enrollment_token()`
- Database schema — add `enrollment_tokens` table (token, device_id, expires_at)

**Blocked by:** Admin UI support for QR generation (not in checkin scope).

## Phase 4: Platform-Level Features (📋 Planned)

These are not checkin-specific but affect the platform's interaction with checkin:

### P4.1: GraphQL Subscriptions
**Priority:** Medium  
**Effort:** 2-3 sprints (platform resolver, not module)  
**Status:** Backlog  

Real-time device status updates via GraphQL subscriptions (admin console):
- Admin subscribes to device state changes
- Checkin publishes state changes to EventBridge
- Resolver broadcasts via AppSync subscriptions

**Impact on Checkin:** None (sidestep; applier publishes events, not checkin).

### P4.2: FCM Token Rotation
**Priority:** Low  
**Effort:** 1 sprint  
**Status:** Backlog  

Rotate FCM tokens periodically (security best practice):
- Device sends fresh FCM token on each checkin
- Checkin updates `devices.fcm_token`
- Processor uses latest token for FCM dispatch

**Implementation:** Update `devices` table with new FCM token on PULL.

**File Changes:**
- `routes/checkin_route.py` — extract fcm_token from request body (optional)
- `db.py` — update whitelist to include fcm_token (already done)

**Status:** Minor; low effort; can land in next sprint.

## Future Considerations (⚠️ Out of Scope)

### Device Offline Queue
**Status:** Not planned  
**Reason:** Fluxion uses FCM for wake; device always online after initial REGISTER.

If offline support needed in future:
- Device would need local SQLite queue for milestones
- Checkin would need conflict-resolution (device may have stale action_id)
- Applier would need idempotency window extension

### Custom Command Payloads
**Status:** Not planned  
**Reason:** Current design uses action.default_template_id + milestone.template_id.

If custom payloads needed (e.g., NOTIFY with dynamic text):
- Extend milestone.payload to include custom JSON
- Checkin merges template + payload in response
- Device renders template with payload interpolation

### Polling Fallback (No FCM)
**Status:** Not planned  
**Reason:** Kotlin DPC has FCM; emulators don't need real notifications.

If polling needed (offline network, edge case):
- Device polls /v1/checkin every N seconds (configurable)
- Checkin returns same command until ACK received
- Would require device-side state machine for stale detection

### IMEI Emulator Derivation
**Status:** Known limitation  
**Reason:** Emulator ANDROID_ID is non-deterministic per device startup.

Fix (low priority):
- Store derived IMEI in device after first checkin
- Use stored IMEI for subsequent IMEI header checks
- Already partially implemented; just needs documentation

## Success Metrics

### Availability
- Checkin Lambda uptime: >99.99% (SLA)
- P99 latency: <200ms (in-region, warm invocation)
- Cold start: <500ms

### Reliability
- ACK idempotency: 100% (no duplicate state transitions)
- E2E lifecycle test: passes on every deploy
- Error rate (4xx + 5xx): <0.1% of requests

### Security
- Zero successful device impersonation (auth bypass)
- Zero SQL injection (parameterized queries)
- Zero plaintext secrets in logs

## Deprecations & Breaking Changes

### Stale Parent README
**Status:** Acknowledged  
**Artifact:** `../README.md` describes 4-Lambda layout with dual-mode checkin (sqs_consumer.py).

**Reality:** Applier split is current. Checkin is HTTP-only.

**Action:** Update parent README in next maintenance sprint.

### Removed: SQS Event Source
**Status:** Complete  
**Date:** ~Q2 2026  
**Was:** Checkin Lambda consumed applier queue (sqs_consumer.py path).  
**Now:** Applier Lambda handles all state transitions; checkin HTTP-only.

**Clients affected:** None (internal refactor; API stable).

## Testing & Validation

### Current Test Coverage
- E2E lifecycle test (an end-to-end lifecycle test) — validates 10-milestone flow
- Manual checkin via curl (DEV env)
- CloudWatch Logs inspection for debugging

### Future Test Improvements
- Load testing (K6) — P99 latency under peak load
- Chaos engineering — network latency injection
- Security scanning — SAST/DAST tools

## Documentation

### Current Coverage
- `README.md` — quick start, env vars, endpoints
- `project-overview-pdr.md` — requirements, constraints
- `codebase-summary.md` — per-file breakdown, request flow
- `code-standards.md` — conventions, patterns
- `system-architecture.md` — component diagram, state machine
- `project-roadmap.md` — this document

### Planned Updates
- After Play Integrity: update `auth.py` docstring + README
- After QR provisioning: add `POST /v1/enroll-validate` to API docs
- After FCM token rotation: update codebase-summary.md (device row fields)

## Next Immediate Action Items

| Item | Priority | Owner | Est. Time |
|------|----------|-------|-----------|
| FCM token rotation support | Medium | Backend | 1-2 days |
| Play Integrity design doc | High | Architect | 3 days |
| Update parent README | Low | Docs | 2 hours |
| Load test against prod | Medium | DevOps | 2 days |
