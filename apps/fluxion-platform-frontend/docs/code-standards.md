# Code Standards & Conventions

## File Organization

### Directory Layout
```
src/
├── apollo/           # GraphQL client & config
├── auth/             # Auth context, Cognito wrapper, route guards
├── components/       # React components (UI + business logic)
├── graphql/          # GraphQL operations & generated types
├── pages/            # Page-level components (routes)
├── styles/           # Tailwind layers & tokens
├── test/             # Test setup & utilities
├── App.tsx           # Router setup
├── env.ts            # Env var centralization
└── main.tsx          # React root
```

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| React components | PascalCase.tsx | DeviceDetailPage.tsx, Shell.tsx |
| Utilities & services | kebab-case.ts | action-availability.ts, jwt-store.ts |
| GraphQL | descriptive.graphql | queries.graphql, mutations.graphql |
| Tests | {subject}.test.ts(x) | Shell.test.tsx, action-availability.test.ts |
| Config | descriptive.{ts,js,cjs} | vite.config.ts, tailwind.config.ts |
| Styles | tokens.css, globals.css | tokens.css |

**Rule:** Self-documenting names that LLM tools (Grep, Glob) can parse at a glance. Long names are preferred over acronyms.

---

## Component Guidelines

### Size & Structure
- **Target:** Keep all component files ≤ 200 LOC.
- **Rationale:** Easier to understand, test, and maintain; fits typical context windows.
- **When to Split:** If a component hits 200 LOC, extract child components or helpers.

### Naming & Props
```typescript
// ✓ Good: Clear intent, focused responsibility
export function DeviceStateBadge({ state }: { state: DeviceState }) {
  return <span className={getStateClass(state)}>{state.name}</span>;
}

// ✗ Avoid: Vague naming, unclear props
export function Badge({ d }: { d: any }) {
  // ...
}
```

### Hooks & State
- Use `useAuth()` for session context (from `src/auth/AuthContext.tsx`).
- Use `useQuery()` / `useMutation()` from Apollo Client for GraphQL.
- Keep state logic in custom hooks when reusable (e.g., `useDeviceFilter`).
- Local `useState` for UI-only state (modals, dropdowns, forms).

### Imports & Aliases
- Absolute imports via `@` alias: `import { Shell } from "@/components/Shell"`.
- Never relative imports across directories: avoid `../../../components/Shell`.
- Group imports: React → external libs → local.

```typescript
// ✓ Good
import { useState } from "react";
import { useLazyQuery } from "@apollo/client";
import { Shell } from "@/components/Shell";
import { env } from "@/env";

// ✗ Avoid
import Shell from "../../../components/Shell";
import env from "../../env";
```

---

## TypeScript

### Strict Mode
- **Enabled:** tsconfig.json has strict: true.
- All files must be .ts or .tsx (no implicit any).
- No `any` without `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment and justification.

### Generated Types
- GraphQL operations generate typed-document-nodes in `src/graphql/generated/` via codegen.
- Always use generated types for queries/mutations.
- **Example:** `ConfigMetadataQuery`, `ListDevicesDocument`, etc.

### Type Definitions
```typescript
// ✓ Good: Explicit, reusable types
type Device = NonNullable<DeviceDetailQuery["device"]>;
interface ActionFilterOptions {
  actor?: "OPERATOR" | "SYSTEM";
  service?: ServiceType;
}

// ✗ Avoid: Implicit or overly generic
const device: any = someQuery.device;
type Config = Record<string, unknown>;
```

---

## Error Handling

### Environment Variables
- Centralized in `src/env.ts`.
- Build fails loud if required vars are missing (required() function throws).
- Never ship placeholders or defaults for missing env vars.

```typescript
// ✓ From src/env.ts
function required(name: string): string {
  const v = import.meta.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}
```

### GraphQL Errors
- Apollo errorLink logs graphQL errors to console (guarded by eslint-disable).
- 401 errors trigger JWT clear + redirect to /login.
- Application should handle network errors gracefully (show toast, retry UI).

### Component-Level Error Boundaries
- Use React ErrorBoundary for catastrophic failures (optional in MVP).
- Catch and log Cognito auth errors (e.g., "New password required").
- Show user-friendly error messages in modals/toasts.

---

## State Management

### React Context
- **AuthContext:** Session, signIn, signOut, loading.
- Use sparingly; prefer local state + prop drilling for simple apps.

### Apollo Cache
- InMemoryCache typePolicies for list fields (listDevices, listMilestones, listTacs, listDeviceUploads).
- watchQuery fetchPolicy: `cache-and-network` (no `nextFetchPolicy: 'cache-first'` — would kill polling).
- Refresh queries manually after mutations (cache may not auto-update).

### Form State
- Use local `useState` for form inputs.
- On submit, call mutation via Apollo useMutation.
- Reset form state on success; show error toast on failure.

---

## Testing

### Setup
- vitest + jsdom (browser-like environment).
- Test setup in `src/test/setup.ts`.
- Colocate tests with sources: `Shell.test.tsx` sits next to `Shell.tsx`.

### Writing Tests
```typescript
// ✓ Good: Clear test name, arrange-act-assert
it("should disable dispatch button when assignedAction is non-null", () => {
  const device = { assignedAction: { id: "123", type: "LOCK" } };
  expect(isDispatchDisabled(device)).toBe(true);
});

// ✗ Avoid: Vague, no setup
it("works", () => {
  expect(foo()).toBe(true);
});
```

### Coverage Targets
- Unit tests for domain logic (action-availability, format helpers).
- Component render tests for critical UI (Shell nav, MilestoneTimeline grouping).
- Integration tests for full flows (login → device list → dispatch).
- No mock data; use realistic fixtures from phase-04 test plan.

### Running Tests
```bash
npm run test              # vitest run
npm run test -- --watch  # watch mode
npm run test -- --ui     # vitest ui
```

---

## Styling & Design System

### Tailwind + Tokens
- All colors, fonts, spacing defined in `tailwind.config.ts`.
- Component classes (.btn, .input, .card) defined in `src/styles/tokens.css` (@layer components).
- **Mirror Rule:** Keep tailwind.config.ts and tokens.css in sync (single source of truth — prefer config, then mirror to CSS).

### Color Palette (Editorial Cream + Terracotta)
| Use | Value | Reason |
|-----|-------|--------|
| sidebar | #ebe2cc | Cream paper (aged) |
| bg | #f4f1ea | Light neutral background |
| paper | #ffffff | Card/modal backgrounds |
| ink | #1a1a1a | Primary text |
| ink-soft | #3a3a3a | Secondary text |
| muted | #7a7466 | Disabled/placeholder text |
| accent | #c44a2c | Primary action (terracotta) |
| state colors | varies | Device state pills (idle, active, locked, etc.) |

### Component Classes
```html
<!-- Button variants -->
<button className="btn-primary">Save</button>
<button className="btn-secondary">Cancel</button>
<button className="btn-danger">Delete</button>

<!-- Form -->
<input className="input" type="text" />

<!-- Cards & Containers -->
<div className="card">Content</div>
<span className="pill bg-state-idle text-ink">Idle</span>
```

### No Emoji Policy
- UI text: no emojis (use inline SVG icons from `src/components/icons.tsx`).
- Code comments: no emojis (keep professional).
- Rationale: Consistency, accessibility, internationalization.

---

## ESLint & Code Quality

### Configuration
- `.eslintrc.cjs`: Airbnb + React rules; max-warnings 0 (zero tolerance).
- All warnings must be fixed or explicitly disabled with comment.

### Command
```bash
npm run lint              # Check all files
npm run lint -- --fix    # Auto-fix (limited)
```

### Common Warnings & Fixes

| Warning | Fix |
|---------|-----|
| `react/no-unescaped-entities` | HTML-encode or use JSX syntax |
| `@typescript-eslint/no-explicit-any` | Use proper types or add eslint-disable comment with reason |
| `no-console` | Keep for debug logs; disable with comment: `// eslint-disable-next-line no-console` |
| `react-hooks/exhaustive-deps` | Add missing deps or document why dep is intentionally omitted |
| `react/prop-types` | Use TypeScript props interface instead |

---

## API & GraphQL Integration

### Query Structure
- Queries live in `src/graphql/queries.graphql`.
- Generated type-safe hooks via graphql-codegen.
- Always validate query params before sending.

### Mutation Patterns
```typescript
// ✓ Good: Handle loading, error, success
const [dispatchAction, { loading, error }] = useMutation(DispatchActionDocument);
const handleDispatch = async (actionId: string) => {
  try {
    await dispatchAction({ variables: { actionId } });
    showToast("Action dispatched", "success");
  } catch (err) {
    showToast("Dispatch failed: " + err.message, "error");
  }
};
```

### Polling
- Apollo watchQuery default: `cache-and-network` + no custom fetchPolicy override.
- Polling interval: 10s on device list/detail pages (explicit in query config).
- **Do NOT** set `nextFetchPolicy: 'cache-first'` — kills polling after first response.

---

## Authentication & Security

### Session Management
- Cognito JWT stored in localStorage (key: `fluxion.jwt`).
- XSS risk accepted per phase-04 security review; mitigated by strict CSP.
- On app init, `AuthProvider` checks session validity (async refresh if needed).

### Protected Routes
- All non-/login routes wrapped in `<ProtectedRoute>` component.
- Redirects to /login if no session.
- Never pass sensitive data in URL (use headers/body instead).

### Token Refresh
- Cognito automatically refreshes access token on demand.
- **Critical:** currentSession() is async (refresh round-trip if needed).
- Older sync-assuming code caused spurious 1h logouts.

### 401 Handling
- Apollo errorLink detects 401 status.
- Clears JWT from localStorage.
- Redirects to /login.
- User must sign in again.

---

## Build & Deployment

### Development
```bash
# Full setup
npm install
cp .env.example .env
npm run codegen     # Generate GraphQL types
npm run dev         # Start Vite dev server
```

### Production Build
```bash
npm run build       # tsc -b + vite build → dist/
npm run typecheck   # Full type check
npm run lint        # Zero-warning check
npm run test        # Tests pass
```

### CSP Strategy
- **Production:** Strict CSP in index.html (script-src 'self').
- **Development:** Relaxed CSP for HMR (vite.config.ts relaxCspInDev plugin).
- **Cognito Fix:** global = globalThis polyfill (Cognito SDK CJS bundle).

---

## Commit Messages

### Format
Use conventional commits (no emoji):
```
feat: add device upload history page
fix: prevent dispatch when assignedAction is non-null
docs: update README with polling explanation
refactor: extract ActionModal to separate component
test: add tests for availableActions filtering
chore: update dependencies
```

### Rules
- First line: 70 chars max.
- Reference issues/PRs: "feat: X (fixes #123)".
- No plan artifact references (phase numbers, finding codes).
- Focus on what & why, not implementation details.

---

## Performance

### Code Splitting
- Routes lazy-loaded via React.lazy() (optional in MVP; not critical for small app).
- Component imports bundled together (no code splitting needed yet).

### Apollo Caching
- typePolicies reduce redundant queries.
- cache-and-network strategy returns cached result instantly, then refreshes.
- Never force refetch unless mutation affects data directly.

### Build Optimization
- Vite tree-shaking enabled by default.
- React DevTools removed in prod build.
- CSS minified by PostCSS + Tailwind.

---

## Documentation Standards

### Code Comments
- Explain **why**, not what (code shows what).
- No plan artifact references (phase numbers, finding codes).
- Stable external references only (RFC, SQLSTATE, CVE, issue #).

```typescript
// ✓ Good: Explains intent
// getSession's callback fires sync ONLY when cached tokens are still valid.
// Expired access tokens trigger async refresh — treat the whole thing as a promise.

// ✗ Avoid: Redundant or referential
// Called by AuthProvider per phase-04
// Cognito wrapper (see F13 in plan)
```

### File Headers
- No boilerplate headers (unnecessary clutter).
- Use filename + first comment line to describe purpose.

### README & Docs
- Keep codebase docs in `docs/` directory.
- Reference phase plans only for context (full paths, not artifact codes).
- Update docs when API or behavior changes.

---

## Common Patterns

### Custom Hook for Fetching Data
```typescript
function useDeviceList(service: ServiceType, state: StateType) {
  const { data, loading, error } = useQuery(ListDevicesDocument, {
    variables: { serviceType: service, stateType: state },
    pollInterval: 10000,
  });
  return { devices: data?.listDevices?.edges ?? [], loading, error };
}
```

### Modal with Form
```typescript
export function ActionModal({ isOpen, onClose, onConfirm }: Props) {
  const [templateId, setTemplateId] = useState<string>("");
  return isOpen ? (
    <Modal title="Dispatch Action" onClose={onClose}>
      <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        {/* template options */}
      </select>
      <button className="btn-primary" onClick={() => onConfirm(templateId)}>
        Dispatch
      </button>
    </Modal>
  ) : null;
}
```

### Error Boundary (Optional)
```typescript
export class ErrorBoundary extends React.Component {
  componentDidCatch(err: Error) {
    // eslint-disable-next-line no-console
    console.error("React Error:", err);
    showToast("Something went wrong", "error");
  }
  render() {
    return this.props.children;
  }
}
```

---

## Checklist Before Commit

- [ ] All files < 200 LOC (or split).
- [ ] PascalCase components, kebab-case utils.
- [ ] `npm run lint` passes (max-warnings 0).
- [ ] `npm run typecheck` passes (no errors).
- [ ] `npm run test` passes (all tests green).
- [ ] `npm run build` succeeds.
- [ ] No console.log left (use // eslint-disable-next-line no-console if needed).
- [ ] No `any` without justification.
- [ ] Comments explain **why**, not what.
- [ ] No plan artifact references in code.
- [ ] Updated relevant docs in `docs/`.

---

## Last Updated

2026-06-07
