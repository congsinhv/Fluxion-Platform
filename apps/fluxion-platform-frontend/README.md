# Fluxion Admin Console

React 18 + Vite + TypeScript + Apollo + Cognito admin UI for the Fluxion MDM platform.

Implements all 10 mockups under `Artifacts/mdm-mockup-*.html` per Phase 04 of the
[implementation plan](../../plans/260525-1144-fluxion-mdm-platform-implementation/phase-04-admin-console-and-defense.md).

## Local dev

```bash
# from repo root
npm install --workspace apps/fluxion-platform-frontend

cd apps/fluxion-platform-frontend
cp .env.example .env          # endpoints from infra/cdk-outputs.json
npm run codegen               # generates GraphQL types from infra/schema/appsync.graphql
npm run dev                   # opens http://localhost:5173
```

Sign in with an admin user you create via an admin-user provisioning script (the
password is set at creation time and is never stored in this repo).

## Architecture

```
src/
├── apollo/client.ts          # ApolloClient + Cognito JWT link + error redirect
├── auth/                     # cognito.ts wrapper + AuthContext + ProtectedRoute + jwt-store
├── components/               # Shell, StateBadge, MilestoneTimeline, Modal, Toast, icons, …
├── components/action-modal/  # ActionModal + ActionDispatchPanel
├── graphql/                  # *.graphql operations + generated/ (gitignored)
├── pages/                    # one file per route
└── styles/tokens.css         # tailwind base; tokens mirror tailwind.config.ts
```

**Polling:** every device-data page polls Apollo every 10s — no GraphQL
subscriptions in MVP.

**Auth:** Cognito JWT in `localStorage`. XSS trade-off documented in
phase-04 §Security Considerations. Strict CSP in `index.html` mitigates.

## Scripts

| Script              | Purpose                                          |
|---------------------|--------------------------------------------------|
| `npm run dev`       | Vite dev server                                  |
| `npm run build`     | `tsc` + `vite build` → `dist/`                   |
| `npm run codegen`   | Regenerate typed-document-node from local SDL    |
| `npm run typecheck` | `tsc --noEmit`                                   |
| `npm run lint`      | ESLint (max 0 warnings)                          |

## Conventions

- Component files use PascalCase (React ecosystem standard).
- Plain `.ts` utility files use kebab-case.
- No emojis in UI — inline SVG icons only (`src/components/icons.tsx`).
- All component files kept under ~200 lines per repo standard.
