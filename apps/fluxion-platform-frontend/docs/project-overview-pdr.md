# Fluxion Admin Console — Project Overview & PDR

## Overview

Fluxion Admin Console is a React 18 + Vite web application for managing Android DPC devices in the Fluxion MDM (Mobile Device Management) platform. Operators manage device provisioning, enrollment, financing, and state transitions via a modern, graph-driven interface integrated with AWS Cognito and AppSync GraphQL.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Apollo Client 3, Tailwind CSS 3, Cognito, AppSync.

**Status:** MVP complete — implements all 10 UI mockups per phase-04 of the platform implementation plan.

---

## Purpose & Users

### Purpose
Provide Fluxion operators a unified console to:
- Provision and track Android DPC fleet devices across two service models: INVENTORY (new device onboarding) and DEVICE_FINANCING (lifecycle management).
- Dispatch state-transition commands (e.g., REGISTER, ENROLL, LOCK, RELEASE) with role-based action filtering.
- Manage device metadata: TACs (Type Allocation Codes), message templates, state/action configuration.
- Monitor device state history via immutable milestone records.

### Users
- **Operators:** RBAC-gated by role (e.g., OPERATOR vs. SYSTEM actions). Sign in via seed admin credentials in dev; Cognito user pool in prod.

---

## Functional Requirements

| Feature | Details |
|---------|---------|
| **Device Listing** | View devices by service + state filter; Relay-style pagination; 10s poll for real-time updates |
| **Device Detail** | Single-device state, milestones, TAC, action history, assigned-action display |
| **State Transitions** | Dispatch OPERATOR actions; keyed by from-state + service; single-flight concurrency check |
| **Device Uploads** | Bulk IMEI upload CSV; track upload history with per-device link-back |
| **Configuration** | View/manage states, actions, message templates, TACs (admin-only) |
| **Auth** | Cognito sign-in; JWT stored in localStorage; automatic session refresh; 401 → redirect /login |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Polling Model** | 10s fetchPolicy cache-and-network (no subscriptions in MVP) |
| **Code Size** | ~2,664 LOC (src+public); largest component < 200 lines |
| **CSP** | Prod: strict (`script-src 'self'`); dev: relaxed for HMR |
| **Availability** | Single-flight concurrency: assignedAction != null blocks dispatch |
| **Type Safety** | 100% TypeScript; code-generated types from GraphQL SDL |

---

## Scope & Limitations

### In Scope (MVP)
- Device provisioning and state machine navigation.
- IMEI bulk upload and history.
- Operator action dispatch with template selection.
- Configuration UI for states/actions/templates/TACs.
- Cognito auth + JWT refresh handling.

### Out of Scope (Future Work)
- GraphQL subscriptions (currently 10s polling).
- QR-code device provisioning.
- Play Integrity attestation.
- Per-tenant Firebase integration.
- RDS hardening beyond XSS CSP mitigations.

---

## Architecture Context

**Frontend ↔ Backend Bridge:**
- GraphQL SDL at `../../infra/schema/appsync.graphql` (single source of truth).
- Code generation produces typed-document-nodes into `src/graphql/generated/` (gitignored until codegen runs).
- Apollo Client chains errorLink (401 handling) → authLink (JWT injection) → AppSync HTTP.

**Data Model:**
- Devices move through 6 states per service: IDLE (Inventory) → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED (Device Financing).
- Every transition recorded as immutable milestone.
- Actions have fromState/targetState typed by service.

---

## Success Criteria & Metrics

| Criterion | Verification |
|-----------|--------------|
| All 10 mockups functional | Manual QA pass per phase-04 checklist |
| Zero ESLint warnings | `npm run lint` passes with `--max-warnings 0` |
| Tests pass | `npm run test` on src/**/*.test.ts(x) |
| TypeScript strict | `tsc --noEmit` zero errors |
| Build succeeds | `npm run build` outputs dist/ with no warnings |

---

## Security & Compliance

### JWT Storage
- **Decision:** Cognito JWT in localStorage (XSS trade-off explicitly accepted per phase-04 security review).
- **Mitigation:** Strict CSP in production (`script-src 'self'`, no inline scripts).

### Authentication
- Cognito user pool (env vars: `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_USER_POOL_CLIENT_ID`).
- Access token refresh triggered on 401; older sync-assuming code caused spurious logouts after ~1h (fixed in cognito.ts).

### Authorization
- Role-based action filtering: availableActions() filters OPERATOR actions by device state + service.
- Single-flight enforcement: assignedAction != null disables dispatch UI.

---

## Dependencies & Configuration

| Dependency | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| Vite | 5.x | Build tool |
| Apollo Client | 3.x | GraphQL client |
| Tailwind CSS | 3.x | Styling (Editorial Cream + Terracotta tokens) |
| amazon-cognito-identity-js | latest | Cognito authentication |
| graphql-codegen | latest | Schema-driven type generation |

**Environment Variables:**
```
VITE_AWS_REGION                     # e.g., ap-southeast-1
VITE_COGNITO_USER_POOL_ID           # Cognito pool ARN
VITE_COGNITO_USER_POOL_CLIENT_ID    # Cognito app client ID
VITE_APPSYNC_URL                    # AppSync GraphQL endpoint
```

All required; build fails if any are missing (enforced in `src/env.ts`).

---

## Roadmap & Known Limitations

### Current Status
- **Phase 04 Complete:** All 10 mockups implemented and tested.
- **Polling Only:** No subscriptions; 10s cache-and-network refresh on device pages.
- **Seed Credentials:** Dev environment uses hardcoded admin user (`admin@fluxion.test`); prod uses Cognito pool.

### Known Limitations
1. No real-time subscriptions (polling is the refresh mechanism).
2. JWT stored in localStorage (XSS risk; mitigated by strict CSP).
3. No QR-code or Play Integrity provisioning in MVP.
4. Device state machine transitions are backend-driven; UI filters actions by availability only.

### Future Work
- [ ] GraphQL subscriptions for real-time device updates.
- [ ] QR-code device provisioning flow.
- [ ] Play Integrity attestation for enrollment.
- [ ] Per-tenant Firebase messaging.
- [ ] RDS connection pooling and hardening.

---

## Team & Support

- **Author:** Fluxion Development Team
- **Last Updated:** 2026-06-07
- **Plan Reference:** [Phase 04 Admin Console & Defense](../../plans/260525-1144-fluxion-mdm-platform-implementation/phase-04-admin-console-and-defense.md)
