# Project Roadmap

## Current Status

**Phase:** MVP Complete (Phase 04 of platform implementation).

**Completion Date:** 2026-06-07

**All 10 Mockups Implemented:**
- Device list by state + service ✓
- Device detail view ✓
- Device state transitions (action dispatch) ✓
- Upload IMEI (bulk) ✓
- Upload history ✓
- Configuration: States ✓
- Configuration: Actions ✓
- Message templates (CRUD) ✓
- TACs (lookup + detail) ✓
- Authentication + session management ✓

---

## Completed Milestones

### Phase 01: Environment & Setup
- [x] Vite + React 18 + TypeScript 5 scaffolding.
- [x] Tailwind CSS with Editorial Cream + Terracotta tokens.
- [x] ESLint (zero-warning policy) + Vitest (jsdom).
- [x] GraphQL codegen pipeline (SDL → typed-document-node).
- [x] Apollo Client setup (JWT auth link, 10s polling, error handling).

### Phase 02: Authentication & Routing
- [x] Cognito SDK integration (async token refresh).
- [x] AuthContext + ProtectedRoute.
- [x] JWT localStorage persistence + clearance on 401.
- [x] React Router nested layout (Shell + page routes).
- [x] Deep-linking: /devices?service=X&state=Y contract.

### Phase 03: Device Management Core
- [x] Device list query (Relay-style pagination, filters, 10s poll).
- [x] Device detail view (state, milestones, TAC, actions).
- [x] Action availability filtering (by device state + service).
- [x] State transition dispatch (single-flight concurrency gate).
- [x] Milestone timeline (grouped history).

### Phase 04: Admin Console & Defense
- [x] Upload IMEI (CSV bulk upload, validation).
- [x] Upload history (pagination, device link-back).
- [x] Configuration UI (States, Actions by service).
- [x] Message Templates (CRUD, Device Financing only).
- [x] TACs (search + detail view).
- [x] Shell sidebar navigation (collapsible groups, state links).
- [x] Strict CSP (prod) + relaxed CSP (dev for HMR).
- [x] Zero eslint warnings policy.
- [x] Unit tests (action-availability, MilestoneTimeline, config-actions-format, Shell).
- [x] TypeScript strict mode + tsc check.

---

## Known Limitations (MVP)

### Polling Only (No Real-Time Subscriptions)
- Device-data pages refresh every 10s — not instant.
- Acceptable latency for operator workflows; subscriptions deferred (complexity + cost).

### JWT in localStorage
- XSS risk: any injected script can read the JWT.
- Mitigation: strict CSP in production (`script-src 'self'`).
- Trade-off explicitly accepted in the platform security review.
- Alternative (HttpOnly cookie) requires backend session management.

### Manual IMEI Upload Only
- Devices enter the system via CSV/manual IMEI upload.
- On emulators, IMEI is derived from `ANDROID_ID` — the operator must upload that exact derived value before enrolling.
- QR-code provisioning is designed but not in the demo build.

### Admin Users
- Provisioned via an admin-user provisioning script; passwords are set at creation
  time and never stored in this repo.

### No Frontend Hosting Infra
- Console runs locally (`npm run dev` / `npm run preview`) against the deployed AWS backend.
- `dist/` is fully static; hosting is post-MVP and would live in `infra/`.

---

## Future Work

Items below come from the platform-level future-work list (root `README.md`). No schedule or effort estimates exist; ordering reflects the platform README, not committed priority.

### GraphQL Subscriptions (frontend + backend)
Replace 10s polling with AppSync subscriptions. Frontend impact: subscription documents, WebSocket link in Apollo, rethink `pollInterval` usage. Blocked by backend AppSync subscription support.

### QR-Code / NFC Zero-Touch Provisioning (mostly client + backend)
Production device provisioning path replacing emulator `dpm set-device-owner`. Frontend impact not yet designed (possibly QR generation/display in console).

### Per-Tenant Firebase Projects (backend/infra)
Tenant isolation for FCM delivery. No frontend impact identified.

### Play Integrity Attestation (client + backend)
Replace the static internal API key on the DPC client. Possible frontend impact: surface attestation status on device detail (not designed).

### RDS Access Hardening (infra)
Bastion / SSH tunnel automation. No frontend impact.

### Frontend Hosting (infra)
S3/CloudFront (or equivalent) static hosting for the console; CI pipeline for typecheck/lint/test/build.

---

## Verified Quality Gates (MVP)

| Gate | Status |
|------|--------|
| `npm run lint` (`--max-warnings 0`) | Passing |
| `npm run typecheck` (strict mode) | Passing |
| `npm run test` (4 test files: action-availability, MilestoneTimeline, config-actions-format, Shell) | Passing |
| Component file size | All under ~200 lines |

No coverage percentage, bundle-size budget, accessibility audit, or latency SLO has been measured — do not cite numbers for these until they are.

---

## Known Technical Debt

| Item | Impact | Notes |
|------|--------|-------|
| Polling instead of subscriptions | 10s update latency | Future work: subscriptions |
| JWT in localStorage | XSS exposure (CSP-mitigated) | Needs backend session work to change |
| Static internal API key on DPC client | Demo-only acceptable | Play Integrity is the hardening path (client-side) |
| No hosting/CI for console | Manual local runs | Future infra work |

---

## Release Notes

### Version 0.1.0 (2026-06-07) — MVP

**Features:**
- Device list with state + service filtering.
- Device detail with milestones + action dispatch.
- Bulk IMEI upload + history.
- Configuration UI (states, actions, templates, TACs).
- Cognito authentication (SRP via amazon-cognito-identity-js) + async token refresh.
- Shell sidebar with deep-linking support.

**Non-Functional:**
- ~2,664 lines of code (src + public, excluding generated).
- Tailwind + Editorial Cream + Terracotta design, no UI library.
- Zero ESLint warnings; TypeScript strict.
- 10s polling (no subscriptions).
- Strict CSP (production) + relaxed CSP (dev only).

---

## References

**Implementation Plan:** [Phase 04: Admin Console & Defense](../../../plans/260525-1144-fluxion-mdm-platform-implementation/phase-04-admin-console-and-defense.md)

**Platform Overview:** [Root README](../../../README.md) — architecture, state machine, future work.

---

## Last Updated

2026-06-07
