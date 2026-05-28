# Fluxion Platform — Project Roadmap

Current status and planned milestones for the Fluxion MDM platform.

---

## MVP Status (Capstone — Complete)

The platform successfully delivers all core functionality for managing Android DPC device fleets with state serialization, audit trails, and event-driven command delivery.

| Component | Status | Notes |
|-----------|--------|-------|
| **Backend (5 Lambdas)** | ✓ Complete | resolver, processor, enroll, checkin, applier; E2E tested |
| **Admin Console (React)** | ✓ Complete | Device listing, detail, state transitions, configuration management |
| **Android DPC Client** | ✓ Complete | Event-driven CheckinWorker; FCM wake + WorkManager triggers |
| **GraphQL API** | ✓ Complete | 7 queries, 8 mutations; Cognito auth |
| **Real-Time Subscriptions** | ✓ Complete | AppSync GraphQL subscriptions; IAM broadcast mutations; 10s polling fallback |
| **Device State Machine** | ✓ Complete | 6 states, 10 actions, configuration-driven |
| **Audit Trail** | ✓ Complete | Immutable milestones with actor, timestamp, payload |
| **Single-Flight Lock** | ✓ Complete | Database-level concurrency control via FOR UPDATE |
| **FCM Push Delivery** | ✓ Complete | ~3s end-to-end latency |
| **Enroll/Checkin APIs** | ✓ Complete | HTTP endpoints for device onboarding and command ACKs |
| **E2E Testing** | ✓ Complete | lifecycle-test.py validates 10-milestone trail, concurrency, idempotency |

**Capstone Grade:** All requirements met. System is production-ready at MVP scope.

---

## Development Phases (Completed)

### Phase 0: Research & Planning
- **Dates:** Capstone project start
- **Deliverables:** Requirements doc, architecture design, state machine specification
- **Status:** ✓ Complete

### Phase 1: Database & Backend Infrastructure
- **Dates:** Capstone project timeline
- **Deliverables:** PostgreSQL schema (9 tables), Alembic migrations (0001–0006), RDS provisioning
- **Status:** ✓ Complete

### Phase 2: Core Backend Lambdas
- **Dates:** Capstone project timeline
- **Deliverables:** Resolver, Processor, Applier (sole transition writer), lock serialization
- **Status:** ✓ Complete

### Phase 3: Device APIs & Enroll/Checkin
- **Dates:** Capstone project timeline
- **Deliverables:** HTTP API Gateway, Enroll Lambda (/v1/enroll), Checkin Lambda (/v1/checkin), IMEI validation
- **Status:** ✓ Complete

### Phase 4: Admin Console
- **Dates:** Capstone project timeline
- **Deliverables:** React UI for device listing, detail, state transitions, configuration; Cognito auth
- **Status:** ✓ Complete

### Phase 5: Android DPC Client
- **Dates:** Capstone project timeline
- **Deliverables:** Kotlin/Compose app, FCM wake + CheckinWorker, DevicePolicyManager integration
- **Status:** ✓ Complete

### Phase 6: End-to-End Testing & Deployment
- **Dates:** Capstone project timeline
- **Deliverables:** lifecycle-test.py (canonical 10-milestone trail, concurrency lock, idempotent acks), CDK infrastructure, deployment runbook
- **Status:** ✓ Complete

### Phase 7: Real-Time Subscriptions (Admin Console Push)
- **Dates:** 2026-06-19
- **Deliverables:** AppSync GraphQL subscriptions with IAM broadcast mutations; backend publishers (Resolver, Processor, Applier); Apollo WebSocket client; frontend `useSubscription` hooks on 3 polling pages; 10s polling fallback
- **Status:** ✓ Complete (code + reviewed; pending CDK deploy)
- **Notes:** Lightweight scalar change-events used as refetch signals; IAM-only broadcast mutations; never-raise policy for publish failures

---

## Post-MVP Roadmap

### Phase 8: QR-Code / NFC Zero-Touch Provisioning (Priority: HIGH)

**Goal:** Enable production-scale fleet enrollment without emulator adb commands.

**User Story:** As a fleet ops manager, I want to provision 1000 devices via QR-code scanning so that I don't have to manually configure each device via ADB.

**Deliverables:**
- QR-code payload generation (enroll endpoint → QR with api_key + base URL)
- Device-side QR-code scanner (Kotlin Camera2 or ML Kit) → parses enrollment URL
- Pre-provisioning workflow (validate QR, confirm enrollment)
- E2E test for QR → provisioning path

**Estimated effort:** 2–3 weeks

**Acceptance criteria:**
- User can scan QR-code on fresh Android device
- Device receives api_key and auto-enrolls
- Enrollment appears in admin console with state trail
- No manual ADB required

**Dependencies:** Completed MVP (all backend + client already deployed)

---

### Phase 9: Multi-Tenancy & Per-Tenant Isolation (Priority: MEDIUM)

**Goal:** Support multiple organizations within a single Fluxion deployment.

**User Story:** As a cloud provider, I want to run Fluxion for multiple customers without risk of cross-tenant data leakage.

**Deliverables:**
- Database schema: add `tenant_id` to all tables
- Cognito: customer-specific user pools or custom claims
- AppSync: row-level security via resolver `ctx.identity.claims.tenant_id`
- RLS (Row-Level Security) at DB: PostgreSQL policies per tenant
- Secrets: per-tenant Firebase projects

**Estimated effort:** 3–4 weeks

**Acceptance criteria:**
- Tenant A cannot see Tenant B's devices or milestones
- Cognito sign-in targets customer-specific pool
- AppSync resolvers enforce `tenant_id` checks
- Database policies prevent cross-tenant queries

**Dependencies:** None (can be added post-MVP)

**Note:** Significantly increases operational complexity. Recommended only if multi-tenant SaaS is the target market.

---

### Phase 10: Play Integrity Attestation (Priority: MEDIUM)

**Goal:** Replace static shared API key with cryptographic device attestation.

**User Story:** As a security officer, I want device authentication to be based on Google Play Integrity token (not a static key) so that only legitimate devices can enroll.

**Deliverables:**
- Device-side: integrate Play Integrity API (or Google SafetyNet), generate token on each API call
- Enroll Lambda: validate Play Integrity token via Google API
- Accept/reject based on risk verdict (MEET_DEVICE_INTEGRITY, MEET_BASIC_INTEGRITY, etc.)
- Revoke compromised devices via Applier

**Estimated effort:** 2–3 weeks

**Acceptance criteria:**
- Device sends Play Integrity token on `/v1/enroll`
- Enroll Lambda rejects token if risk verdict fails
- Rooted/compromised devices denied enrollment
- Legitimate emulator (low risk) still accepted in dev

**Dependencies:** MVP (already using static key). Android 5+ with Google Play Services.

**Note:** Increases security posture; MVP static key acceptable for capstone demo.

---

### Phase 11: RDS Hardening & Bastion Access (Priority: MEDIUM)

**Goal:** Move RDS from public-accessible to private subnet + bastion host.

**User Story:** As a security/ops team, I want the database to be unreachable from the internet so that only authorized personnel (via bastion SSH tunnel) can access it.

**Deliverables:**
- VPC: private subnet for RDS (no public route)
- Bastion EC2 instance in public subnet (t3.micro cost-optimized)
- SSH key pair management (AWS Systems Manager Parameter Store)
- Terraform/CDK update to wire Lambda VPC endpoints to RDS private subnet
- SSH tunnel automation (optional: ssm-ssh script)
- Monitoring: CloudWatch alarms on bastion login attempts

**Estimated effort:** 2–3 weeks (mostly VPC/networking)

**Acceptance criteria:**
- RDS endpoint not publicly routable
- Bastion accepts SSH from trusted IPs only
- Lambda functions can connect to RDS (via VPC endpoint)
- Operators can SSH to bastion, then psql to RDS via tunnel

**Dependencies:** Deployed MVP (can retrofit existing stack)

**Note:** Required for production compliance (PCI-DSS, SOC 2); optional for capstone.

---

### Phase 12: Device Compliance Reporting (Priority: LOW)

**Goal:** Generate compliance reports on device security posture (lock status, firmware, enrollment path, etc.).

**User Story:** As a compliance officer, I want to generate a report showing which devices are locked, which are outdated, and audit trail of state changes for SOC 2 evidence.

**Deliverables:**
- New GraphQL query: `deviceComplianceReport(dateRange)` → aggregate metrics
- Admin console: **Reports** tab with date-range picker, export to CSV
- Applier: track firmware version on checkin (metadata field)
- Resolver: compute aggregates (total devices, locked count, overdue-enroll count)

**Estimated effort:** 1–2 weeks

**Acceptance criteria:**
- Compliance report shows device count by state
- Audit trail exportable to CSV for auditors
- Report includes enrollment date, last state change, locked/unlocked duration
- Filters by service (INVENTORY vs. DEVICE_FINANCING)

**Dependencies:** MVP + admin console

**Note:** Nice-to-have; low priority unless compliance is a go-to-market requirement.

---

### Phase 13: CLI Provisioning Tool (Priority: LOW)

**Goal:** Enable bulk device enrollment via command-line tool (not just admin console).

**User Story:** As a fleet ops engineer, I want to upload a CSV of IMEIs and automatically enroll them via CLI so that I don't have to click through the admin console 1000 times.

**Deliverables:**
- Python CLI tool: `fluxion-cli enroll --csv devices.csv --api-key <KEY>`
- Bulk endpoint or idempotent repeated calls to GraphQL `uploadImei` + `dispatchAction(ENROLL)`
- Progress bar + retry logic
- Output: CSV with IMEI, api_key, status

**Estimated effort:** 1–2 weeks

**Acceptance criteria:**
- CLI reads CSV of IMEIs
- Enrolls each device in batch (parallel or serial)
- Outputs success/failure per IMEI
- Retries failed enrollments with exponential backoff
- Distributable as PyPI package or Docker image

**Dependencies:** MVP + GraphQL API

**Note:** Useful for DevOps workflows; low priority if console UI is sufficient.

---

## Known Limitations (MVP, Not Bugs)

These are intentional scope boundaries, not defects:

| Limitation | Reason | Post-MVP Solution |
|-----------|--------|-------------------|
| **Polling instead of subscriptions** | Subscriptions add latency risk in 3s delivery window; polling is simpler | Phase 8: Subscriptions |
| **Static shared API key** | Sufficient for demo; no production attestation required | Phase 10: Play Integrity |
| **Public RDS** | Dev-only acceptable; bastion required for production | Phase 11: RDS hardening |
| **Emulator provisioning via adb** | MVP scope; QR pre-designed but not implemented | Phase 7: QR provisioning |
| **Single-tenant** | Capstone project; multi-tenancy SaaS is post-MVP | Phase 9: Multi-tenancy |
| **No device onboarding firmware check** | MVP doesn't validate firmware version; easy to add | Future enhancement |
| **No device deprovisioning lifecycle** | RELEASED state is terminal; device can't re-enroll | Easy to extend post-MVP |

---

## Success Metrics (MVP)

| Metric | Target | Achieved |
|--------|--------|----------|
| **Command delivery latency** | <3s (FCM wake + checkin) | ✓ Yes (measured in E2E tests) |
| **Audit trail completeness** | 10 canonical milestones per device | ✓ Yes (lifecycle-test.py validates) |
| **Concurrency enforcement** | No parallel actions per device | ✓ Yes (concurrency test passes) |
| **Idempotency** | Device ACK retries safe | ✓ Yes (idempotency test passes) |
| **Uptime** | Serverless → no server ops | ✓ Yes (managed AWS services) |
| **Deployment independence** | Each Lambda independently deployable | ✓ Yes (separate CDK assets) |

---

## Risk Register (Post-MVP)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Subscription latency impact** | Medium | Medium | Phase 8 testing must verify <1s latency; fallback to polling if needed |
| **Multi-tenancy complexity** | Medium | High | Phase 9 requires thorough RLS testing; recommend external audit |
| **Play Integrity attestation delays** | Low | Low | Phase 10 can use async token validation; device waits 1–2s extra |
| **Bastion SSH key management** | Low | High | Phase 11 uses AWS Secrets Manager + IAM-based access; no static SSH keys |
| **CLI tool adoption** | Low | Low | Phase 13 optional; provided as convenience, not required for MVP |

---

## Roadmap Timeline

```
MVP (Complete)
├─ Phase 0–6: Capstone project
└─ Status: All core features shipped & tested

Post-MVP (Planned)
├─ Phase 7: QR provisioning (HIGH, 2–3 weeks)
├─ Phase 8: Subscriptions (HIGH, 1–2 weeks)
├─ Phase 9: Multi-tenancy (MEDIUM, 3–4 weeks)
├─ Phase 10: Play Integrity (MEDIUM, 2–3 weeks)
├─ Phase 11: RDS hardening (MEDIUM, 2–3 weeks)
├─ Phase 12: Compliance reporting (LOW, 1–2 weeks)
└─ Phase 13: CLI tool (LOW, 1–2 weeks)

Estimated post-MVP effort: 14–22 weeks (one feature track)
```

---

## Stakeholder Expectations

**Capstone Grading Criteria:** All met
- ✓ Core functionality (device state machine, audit trail, FCM delivery)
- ✓ Clean code, well-documented
- ✓ E2E testing (lifecycle-test.py)
- ✓ Deployment runbook
- ✓ Security baseline (Cognito auth, encrypted secrets)

**Production-Readiness (Post-MVP):**
- QR provisioning (fleet scale)
- RDS hardening (data privacy)
- Multi-tenancy (SaaS model)
- Play Integrity attestation (device security)

---

## How to Update This Roadmap

After each phase completion:
1. Move phase from "Post-MVP" to completed section
2. Update success metrics
3. Mark phase status as ✓ Complete
4. Link to PR/commit that shipped the phase
5. Note any changes to subsequent phases (dependencies, scope adjustments)

Example update:
```
### Phase 7: QR-Code Provisioning ✓ Complete (2026-07-15)
- PR: github.com/...
- Commits: abc123, def456
- Changes to Phase 8: None (independent)
```

---

## Related Documentation

- **`docs/project-overview-pdr.md`** — MVP scope and value propositions
- **`docs/system-architecture.md`** — Current architecture (applies to MVP)
- **`docs/deployment-guide.md`** — MVP deployment runbook
- **Per-app roadmaps** — See `apps/{app}/docs/project-roadmap.md` for app-specific post-MVP items
