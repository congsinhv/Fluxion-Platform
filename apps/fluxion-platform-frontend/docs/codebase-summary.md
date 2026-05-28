# Codebase Summary

## Directory Structure

```
src/
├── apollo/
│   └── client.ts                    # ApolloClient setup: link chain, cache config, typePolicies
├── auth/
│   ├── cognito.ts                   # Cognito wrapper (currentSession, signIn, signOut)
│   ├── AuthContext.tsx              # Auth state provider (session, signIn, signOut, loading)
│   ├── ProtectedRoute.tsx           # Route guard; redirects unauthenticated users to /login
│   └── jwt-store.ts                 # localStorage JWT persistence (key: fluxion.jwt)
├── components/
│   ├── Shell.tsx                    # Main layout: sidebar + outlet; 260px grid; nav groups
│   ├── Modal.tsx                    # Reusable dialog component
│   ├── Toast.tsx                    # Toast notification component
│   ├── StateBadge.tsx               # Device state pill with color coding
│   ├── MilestoneTimeline.tsx        # Milestone history timeline (grouped by action/state)
│   ├── ActionDispatchPanel.tsx      # Action selection + dispatch UI
│   ├── action-modal/
│   │   └── ActionModal.tsx          # Confirm dispatch + template picker modal
│   ├── icons.tsx                    # 86 inline SVG icons (no emoji policy)
│   ├── PageHeader.tsx               # Consistent page title + breadcrumb
│   ├── EmptyState.tsx               # Placeholder for empty lists
│   └── ProviderBadge.tsx            # TAC provider color coding
├── graphql/
│   ├── queries.graphql              # ConfigMetadata, ListDevices, DeviceDetail, DeviceMilestones, etc.
│   ├── mutations.graphql            # UploadImei, DispatchAction, CRUD mutations
│   └── generated/                   # gitignored; populated by codegen → typed-document-node
├── pages/
│   ├── LoginPage.tsx                # Sign-in form (email + password)
│   ├── DevicesByStatePage.tsx       # Device list filtered by ?service= + ?state=
│   ├── DeviceDetailPage.tsx         # Single device: state, milestones, TAC, actions
│   ├── UploadImeiPage.tsx           # CSV upload form
│   ├── UploadHistoryPage.tsx        # Upload history with pagination
│   ├── ConfigStatesPage.tsx         # View device states by service
│   ├── ConfigActionsPage.tsx        # View actions by service
│   ├── TemplatesPage.tsx            # Message templates CRUD (Device Financing only)
│   ├── TacsPage.tsx                 # TAC lookup + details
│   ├── config-actions-format.ts     # Formatting helpers for config pages
│   └── [other pages]
├── styles/
│   └── tokens.css                   # Tailwind @layer components: .btn, .input, .card, .pill
├── test/
│   └── setup.ts                     # vitest config: jsdom, fetch polyfill
├── App.tsx                          # Router: /login (public), all else ProtectedRoute → Shell
├── env.ts                           # Centralized env var access (throws on missing)
└── main.tsx                         # React root mount

public/
├── logo.svg                         # Fluxion brand logo
└── [assets]

Configuration:
├── vite.config.ts                   # Vite: @vitejs/plugin-react, relaxCspInDev plugin, global polyfill
├── vitest.config.ts                 # jsdom; standalone (not extending vite.config)
├── tailwind.config.ts               # Editorial Cream + Terracotta tokens + extended colors
├── tsconfig.json                    # strict mode; compilerOptions target ES2020
├── postcss.config.js                # tailwindcss plugin
├── .eslintrc.cjs                    # ESLint: Airbnb + React
├── index.html                       # Entry point; strict prod CSP
├── codegen.ts                       # graphql-codegen config: SDL → typed-document-node
└── package.json                     # Workspace member; scripts, dependencies
```

---

## Module Summaries

### Apollo Client (`src/apollo/client.ts`, 55 LOC)
- **Purpose:** Configure Apollo Client with Cognito JWT auth + error handling.
- **Key Features:**
  - Link chain: errorLink (401 → clear JWT + redirect) → authLink (inject JWT) → httpLink (AppSync).
  - InMemoryCache typePolicies for list fields (listDevices, listMilestones, listTacs, listDeviceUploads).
  - watchQuery fetchPolicy: `cache-and-network` (no `nextFetchPolicy: 'cache-first'` — would kill polling).
- **Exports:** apolloClient (singleton instance).

### Authentication (`src/auth/`, 4 files, ~110 LOC)

| File | LOC | Purpose |
|------|-----|---------|
| cognito.ts | 64 | amazon-cognito-identity-js wrapper; currentSession() is async (refresh round-trip) |
| AuthContext.tsx | 52 | React context provider; manages session state, signIn/signOut |
| ProtectedRoute.tsx | ~15 | Route guard component; redirects to /login if no session |
| jwt-store.ts | ~10 | localStorage JWT I/O (key: `fluxion.jwt`) |

**Critical:** currentSession() is async because expired access tokens trigger a refresh round-trip. Earlier sync-assuming code caused spurious 1h logouts.

### Components (`src/components/`, ~850 LOC)

| Component | LOC | Purpose |
|-----------|-----|---------|
| Shell.tsx | 195 | Main layout: sidebar nav, collapsible groups, state/action links, footer |
| MilestoneTimeline.tsx | 127 | Grouped milestone history with action/state labels |
| ActionModal.tsx | 158 | Dispatch confirm + template selection modal |
| ActionDispatchPanel.tsx | 125 | Action dropdown + dispatch button (disabled if assignedAction) |
| StateBadge.tsx | ~30 | Pill badge for device state (color-coded per state) |
| icons.tsx | 86 | 30+ inline SVG icons (no emoji policy) |
| Modal.tsx, Toast.tsx, PageHeader.tsx, EmptyState.tsx, ProviderBadge.tsx | ~150 | Shared UI components |

**Convention:** Keep all files under ~200 LOC; split large components into smaller pieces.

### Pages (`src/pages/`, ~1,100 LOC)

| Page | LOC | Purpose |
|------|-----|---------|
| DevicesByStatePage.tsx | 145 | Relay-paginated device list; filters by ?service=&state=; 10s poll |
| TacsPage.tsx | 199 | TAC search + detail view; largest page file |
| TemplatesPage.tsx | 164 | Message template CRUD (Device Financing service only) |
| ConfigActionsPage.tsx | 87 | Actions view by service; action-detail with rules |
| UploadImeiPage.tsx | 104 | CSV upload form; device count validation |
| UploadHistoryPage.tsx | 90 | Upload history pagination; links back to devices |
| DeviceDetailPage.tsx | 103 | Single device: full state, milestones, action dispatch |
| LoginPage.tsx | 77 | Cognito sign-in form |
| ConfigStatesPage.tsx | 58 | States view by service |
| config-actions-format.ts | ~40 | Helper: format actor, templateRequired, etc. |

### GraphQL Operations (`src/graphql/`)

**Queries (9 operations, 2,578 chars):**
- ConfigMetadata: services, states, actions (single fetch for config UI)
- ListDevices: Relay-paginated; filters: serviceType, stateType, search
- DeviceDetail: Single device full detail
- DeviceMilestones: Paginated milestone history
- ListMessageTemplates: Service-scoped templates
- ListTacs: TAC search with pagination
- ListDeviceUploads: Upload history with status filter

**Mutations (3 operations, 1,158 chars):**
- UploadImei: Bulk IMEI CSV upload
- DispatchAction: Send action to device (optionally select template)
- MessageTemplate/Tac CRUD (create, update, delete)

**Code Generation:**
- `codegen.ts` reads SDL at `../../infra/schema/appsync.graphql` + `src/graphql/*.graphql`.
- Outputs typed-document-node into `src/graphql/generated/` (gitignored; nothing compiles until codegen runs).
- Scalars: AWSDateTime, AWSJSON → string.

### Styling & Design System

**Files:**
- `tailwind.config.ts`: Editorial Cream + Terracotta palette; extended colors for states + UI.
- `src/styles/tokens.css`: @layer components (mirrored with tailwind.config).

**Tokens:**
- Colors: sidebar (#ebe2cc), bg (#f4f1ea), paper (#ffffff), ink (#1a1a1a), accent (#c44a2c terracotta).
- States: idle, registered, enrolled, active, locked, released (+ matching -bg tints).
- Fonts: Inter (sans), JetBrains Mono (mono).
- Components: .btn, .btn-primary, .btn-secondary, .btn-danger; .input, .card, .pill.

---

## Build & Development

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server (:5173); HMR with relaxed CSP |
| `npm run build` | `tsc -b` + `vite build` → dist/ |
| `npm run codegen` | Regenerate types from GraphQL SDL + operations |
| `npm run codegen:watch` | Watch mode for codegen |
| `npm run typecheck` | `tsc --noEmit` strict type check |
| `npm run lint` | ESLint (max 0 warnings); no warnings policy |
| `npm run test` | vitest run (jsdom, src/**/*.test.ts(x)) |

---

## Testing

**Setup:** `src/test/setup.ts` (vitest + jsdom + fetch polyfill).

**Test Files:**
- Shell.test.tsx (73 LOC): Nav rendering, state active detection.
- action-availability.test.ts (52 LOC): availableActions() + isDispatchDisabled() logic.
- MilestoneTimeline.test.tsx (40 LOC): Milestone grouping.
- config-actions-format.test.ts (29 LOC): Format helpers.

**Convention:** Tests colocated with sources (*.test.ts(x) siblings).

---

## Key Implementation Details

### Device State Machine & Actions
- States: IDLE (Inventory) → REGISTERED → ENROLLED → ACTIVE ⇄ LOCKED → RELEASED (Device Financing).
- Actions have actor (OPERATOR | SYSTEM), fromState, targetState, service.
- availableActions(): Filter by actor == OPERATOR && fromState.type == device.state && fromState.service == device.service (service keying lets REGISTER appear on Inventory devices).
- isDispatchDisabled(): device.assignedAction != null (single-flight gate).

### Polling & Real-Time Updates
- 10s poll only (no subscriptions in MVP).
- Apollo watchQuery fetchPolicy: cache-and-network (returns cache instantly, then refreshes).
- **Critical:** Do NOT set `nextFetchPolicy: 'cache-first'` — would short-circuit pollInterval after first response.

### CSP Strategy
- **Prod:** Strict CSP in index.html (script-src 'self', no inline).
- **Dev:** vite.config.ts relaxCspInDev plugin swaps permissive CSP during `vite serve` (HMR requires inline scripts).
- **Cognito Polyfill:** vite.config.ts defines global = globalThis (Cognito SDK CJS bundle fix).

### Authentication Flow
1. App mounts → AuthProvider calls currentSession().
2. If valid session in pool → save JWT to localStorage, set session state.
3. On sign-in → cognitoSignIn() → save JWT → update session.
4. On sign-out → cognitoSignOut() → clear JWT → clear session.
5. Apollo authLink injects JWT into Authorization header.
6. If 401 → errorLink clears JWT + redirects to /login.
7. Token refresh triggered on demand by Cognito (async).

### Routing & Deep-Linking
- ProtectedRoute gates all non-/login routes.
- Shell wraps authenticated routes; Outlet renders nested content.
- Device listing deep-links: /devices?service=INVENTORY&state=IDLE (Shell nav uses URL params to determine active state).
- Config pages: /config/states?service=DEVICE_FINANCING (service derived from query param).

---

## LOC Statistics

**Total (src + public, excl. generated):** ~2,664 lines

**Top Files by LOC:**
1. icons.tsx — 86 (SVG defs)
2. Shell.tsx — 195 (main layout)
3. TacsPage.tsx — 199 (largest page)
4. DevicesByStatePage.tsx — 145
5. TemplatesPage.tsx — 164
6. ActionModal.tsx — 158
7. DeviceDetailPage.tsx — 103

**Tests:** ~200 lines across 4 files.

---

## Dependencies

**Runtime:**
- react, react-dom (18.x)
- react-router-dom (for routing)
- @apollo/client (3.x)
- amazon-cognito-identity-js (Cognito auth)
- tailwindcss (3.x)

**Dev:**
- vite (5.x)
- typescript (5.x)
- vitest, jsdom (testing)
- graphql-codegen (type generation)
- eslint, @vitejs/plugin-react

See `package.json` for full list and versions.

---

## Conventions & Style

| Convention | Rule |
|-----------|------|
| Component files | PascalCase (React standard) |
| Plain utility files | kebab-case |
| File size | < 200 LOC (split large components) |
| Icons | Inline SVG only; no emojis in UI |
| Naming | Self-documenting; LLM-searchable (Grep/Glob) |
| Testing | Colocated *.test.ts(x) with sources |
| Imports | @-aliased (@ = src/) |
| Errors | Loud errors on missing env vars (env.ts) |
| Linting | ESLint --max-warnings 0 (zero-warning policy) |

---

## Last Updated

2026-06-07
