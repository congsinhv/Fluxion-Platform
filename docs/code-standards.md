# Fluxion Platform — Code Standards & Conventions

This document establishes shared standards across the Fluxion monorepo. Per-app standards (if stricter) are documented in `apps/{app}/docs/code-standards.md`.

---

## Naming Conventions

### Python (Backend Lambdas, Scripts)

**Ruff config (applies to `apps/` and `scripts/`):**
- Line length: 100
- Double quotes (not single)
- Python 3.12 target
- Select: E (pycodestyle), F (Pyflakes), I (isort), UP (pyupgrade), B (flake8-bugbear)
- Ignore: E501 (line too long — enforced by ruff format instead), B008 (function call in default arg)

**File naming:**
- Directories: kebab-case (`fluxion-platform-resolver/`, `fluxion-platform-processor/`)
- Top-level Python files (.py): kebab-case (`lifecycle-test.py`, `db-cleanup-devices.py`)
- Modules inside packages (`routes/`, `resolvers/`): snake_case (`device_handlers.py`, `milestone_resolver.py`)
  - Reason: Python import constraint; package files must be valid identifiers

**Code style:**
- Use `from config import logger` (importing `config.py` configures root logger as side effect)
- Bind all SQL values via `%(name)s`, never interpolated
- Use `with db.conn.transaction():` for multi-statement writes
- Raise typed `AppError` subclasses, not bare exceptions
- Log lines: `<service>.<event> key=value` (e.g., `processor.dispatch action_id=123 device_id=456`)

**Example:**
```python
# ✓ Good
from config import logger
from errors import AppError

logger.info("processor.dispatch action_id=%(action_id)s", {"action_id": action_id})
query = "UPDATE devices SET current_state_id = %(state_id)s WHERE id = %(device_id)s"
db.conn.execute(query, {"state_id": state_id, "device_id": device_id})

# ✗ Bad
logger.info(f"Processor dispatching {action_id}")
query = f"UPDATE devices SET current_state_id = {state_id} WHERE id = {device_id}"
```

---

### TypeScript/JavaScript (Frontend, Infra, Scripts)

**File naming:**
- Directories: kebab-case
- Components (`.tsx`, `.ts`): PascalCase for components (e.g., `DeviceDetail.tsx`), kebab-case for utilities (e.g., `action-availability.ts`)
- Config files: kebab-case or camelCase per convention (e.g., `tailwind.config.ts`, `vitest.config.ts`)

**Code style:**
- Use 2-space indentation
- Prefer `const` over `let`; never `var`
- Use template literals for string interpolation
- Null coalesce (`??`) and optional chaining (`?.`) for safety

**Example:**
```typescript
// ✓ Good
const fetchDevice = async (deviceId: string): Promise<Device> => {
  const response = await apollo.query({ query: GetDeviceQuery, variables: { id: deviceId } });
  return response.data?.device ?? null;
};

// ✗ Bad
var fetchDevice = function(deviceId) {
  var response = apollo.query({ query: GetDeviceQuery, variables: { id: deviceId } });
  return response.data.device;
};
```

---

### Kotlin (Android Client)

**File naming:**
- Classes: PascalCase (e.g., `CheckinWorker.kt`, `DpcPolicyManager.kt`)
- Packages: lowercase with underscores if multi-word (e.g., `com.fluxion.dpc.device_policy`)

**Code style:**
- Follow Kotlin naming conventions (camelCase for functions/variables)
- Prefer data classes for immutable models
- Use sealed classes for algebraic types (e.g., command results)

---

## GraphQL SDL (Source of Truth)

**Location:** `infra/schema/appsync.graphql`

**Principle:** This is the **single source of truth** for the GraphQL API. Changes flow downstream.

**Update workflow:**
1. Edit `infra/schema/appsync.graphql`
2. Run `npm run infra:deploy` (redeploys AppSync with new schema)
3. Run `npm --workspace apps/fluxion-platform-frontend run codegen` (regenerates TypeScript types)
4. Never hand-edit generated files in `src/graphql/generated/`

**Introspection:** Frontend should never introspect the deployed API (requires JWT). Use the SDL as the contract.

---

## Lambda Code Architecture

### Shared Modules (Intentional Duplication)

Each Lambda directory owns **full copies** of:
- `config.py` — logger setup, boto3 clients, env/Secrets Manager reading
- `constants.py` — immutable constants (action classification, state enums)
- `db.py` — psycopg connection singleton, helper queries
- `errors.py` — typed AppError exceptions
- `sqs_client.py` — SQS send_message helper
- `auth.py` (where present) — Cognito or api_key auth logic

**Why duplication?** AWS CDK bundles each Lambda directory separately as a Docker image. A shared package broke asset hashing and prevented independent deploys. Duplication is intentional and necessary.

**Update rule:** When changing one of these files, **mirror the change across all sibling copies**. Drift is acceptable only where a Lambda genuinely doesn't use the code (e.g., applier doesn't need resolver-specific auth).

**Files to sync:**
```
apps/fluxion-platform-backend/
├── fluxion-platform-resolver/
│   ├── config.py ← UPDATE
│   ├── constants.py ← UPDATE
│   ├── db.py ← UPDATE
│   ├── errors.py ← UPDATE
│   ├── auth.py ← UPDATE (Cognito + resolver-specific)
│   └── sqs_client.py ← UPDATE
├── fluxion-platform-processor/
│   ├── config.py ← UPDATE
│   ├── ... (same pattern)
├── fluxion-platform-checkin/
│   ├── config.py ← UPDATE
│   ├── ... (same pattern)
├── fluxion-platform-enroll/
│   ├── config.py ← UPDATE
│   ├── ... (same pattern)
└── fluxion-platform-applier/
    ├── config.py ← UPDATE
    └── ... (same pattern)
```

### Resolver Pattern (resolver Lambda only)

Per-entity resolvers in `resolvers/{entity}.py`, each exporting:
- `QUERY_HANDLERS: dict[str, Callable]`
- `MUTATION_HANDLERS: dict[str, Callable]`

Aggregated in `resolvers/__init__.py`. Main handler (`handler.py`) dispatches by GraphQL fieldName:
```python
# handler.py
from resolvers import QUERY_HANDLERS, MUTATION_HANDLERS

def lambda_handler(event, context):
    field_name = event["fieldName"]
    if event["requestTypeId"] == "Query":
        return QUERY_HANDLERS[field_name](event)
    else:
        return MUTATION_HANDLERS[field_name](event)
```

---

## Frontend Code Architecture

### GraphQL Operations & Codegen

**Operations directory:** `src/graphql/` contains `.graphql` files with queries/mutations.

**Codegen pipeline:**
1. `src/graphql/*.graphql` — Operation definitions (QUERY, MUTATION)
2. `infra/schema/appsync.graphql` — SDL (read as introspection source)
3. `codegen.ts` — Codegen config (client preset, typed-document-node)
4. Run `npm run codegen` → outputs `src/graphql/generated/graphql.ts` (gitignored)
5. Import: `import { GetDeviceDocument } from "@/graphql/generated/graphql"`

**Never** hand-edit `src/graphql/generated/`, introspect the API, or use untyped `gql` — the codegen output is the contract.

### Apollo Client Configuration

**File:** `src/apollo/client.ts`

Key decisions:
- **Fetch policy:** `watchQuery` uses `cache-and-network` (NOT `cache-first`)
  - Reason: Device detail pages rely on 10s `pollInterval`; cache-first silently kills polling
- **Auth link:** Injects Cognito JWT from localStorage into `Authorization` header
- **Error link:** 401 → clear JWT, redirect to `/login`

### Action Availability Logic

**File:** `src/components/action-availability.ts`

Core domain: which operator actions are dispatchable given device state and service?

```typescript
// Example: canLock(device) → true if state === ACTIVE && assignedAction === null
export const canLock = (device: Device): boolean => {
  return device.currentState.id === "ACTIVE" && !device.assignedAction;
};
```

Mirrors the backend state machine; consult the root README state diagram before modifying.

---

## Commit Message Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body (optional)>

<footer (optional, e.g., Closes #123)>
```

**Types:**
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation-only changes
- `refactor:` — code restructuring (no behavior change)
- `test:` — test-only changes
- `chore:` — tooling, dependencies, CI/CD (not user-facing)

**Scope** (optional but recommended):
- `resolver`, `processor`, `checkin`, `enroll`, `applier` — for backend
- `frontend`, `client` — for frontend/Android
- `infra` — for CDK/infrastructure
- `db` — for database migrations

**Subject:**
- Imperative mood ("add feature" not "added feature")
- No period at end
- Lowercase
- ~50 characters max

**Body:**
- Wrap at 72 characters
- Explain *why*, not *what* (what is visible in the diff)
- Separate from subject by blank line

**Example:**
```
feat(processor): add FCM delivery retry logic

Processor now retries FCM push up to 3 times with exponential
backoff when Firebase returns transient errors. This improves
delivery reliability in environments with spotty connectivity.

Device-side checkin polling remains the fallback.
```

**NOT in commit messages:**
- Plan phase references (`phase-01`, `phase-02`)
- Finding codes (`F13`, `CU2`)
- AI references ("Claude added", "AI-generated")

---

## Database Migrations (Alembic)

**Location:** `scripts/db/migrations/`

**Naming:**
- Format: `NNNN_descriptive_slug.py` (e.g., `0001_init_schema.py`, `0005_seed_actions.py`)
- Use snake_case for multi-word slugs
- No phase references in migration names

**Pattern:**
```python
"""Add device_uploads table for bulk IMEI tracking."""

from alembic import op
import sqlalchemy as sa

revision = "0006_fix_actor"
down_revision = "0005_seed_actions"

def upgrade():
    # Your migration logic here
    pass

def downgrade():
    # Reverse logic (rarely used in production)
    pass
```

---

## API Response Contracts

### HTTP API (Enroll, Checkin)

**Success (2xx):**
```json
{
  "data": { /* response payload */ },
  "error": null
}
```

**Error (4xx/5xx):**
```json
{
  "data": null,
  "error": {
    "code": "DEVICE_LOCKED",
    "message": "Another action is in-flight for this device",
    "retry_strategy": "exponential_backoff"
  }
}
```

### GraphQL (AppSync)

**Success:**
```json
{
  "data": { /* query/mutation result */ }
}
```

**Error:**
```json
{
  "errors": [
    {
      "message": "User not authorized",
      "extensions": {
        "code": "UNAUTHORIZED"
      }
    }
  ]
}
```

---

## Testing Strategy

### Backend

**No unit-test suite.** E2E validation via an end-to-end lifecycle test against a **deployed** stack:
- Validates canonical 10-milestone lifecycle trail
- Asserts concurrency lock rejects parallel `dispatchAction`
- Verifies `/v1/checkin` acknowledgements are idempotent
- Polls 600ms/20s timeout (accounts for eventual consistency)

> Note: operational scripts (E2E lifecycle test, admin-user provisioning, device cleanup) are kept local and are not part of the public repository.

### Frontend

**Vitest unit tests** (`npm --workspace apps/fluxion-platform-frontend run test`):
- Action-availability logic (`action-availability.test.ts`)
- Milestone grouping
- Auth state transitions

**No E2E tests** (would require Cognito + deployed backend).

### Android

**Manual testing:**
1. Build APK via `./gradlew :app:assembleDebug`
2. Install on emulator (must use Google APIs image with FCM)
3. Provision as Device Owner via `scripts/adb-enroll.sh`
4. Trigger enrollment from admin console
5. Verify milestone trail in console

---

## Configuration Management

### Environment Variables

**Frontend:** `apps/fluxion-platform-frontend/.env` (loaded via Vite)
```
VITE_COGNITO_REGION=ap-southeast-1
VITE_COGNITO_CLIENT_ID=...
VITE_GRAPHQL_ENDPOINT=...
VITE_CSP_REPORT_URI=...
```

**Backend:** `DATABASE_URL` (local) or `DB_SECRET_ARN` + `DB_ENDPOINT` (deployed)

**Android:** `local.properties` (gitignored)
```
sdk.dir=/path/to/android-sdk
DPC_BASE_URL=...
DPC_INTERNAL_API_KEY=...
```

**Secrets Manager (deployed):**
- `fluxion/firebase-service-account` — FCM service account key (JSON)
- `fluxion/dpc-shared-api-key` — Shared DPC authentication key

**Never commit** `.env`, `local.properties`, or actual secrets to git.

---

## File Size Targets

- **Python files:** <200 LOC per file (refactor into modules if exceeding)
- **React components:** <200 LOC per component (extract hooks/utilities)
- **Lambdas:** Each directory is one deployable asset; split into `resolvers/`, `routes/` subdirs as needed

---

## Linting & Formatting

### Python (Ruff)

```bash
npm run lint              # ruff check apps/ scripts/
npm run lint:fix          # ruff check --fix
npm run fmt               # ruff format
npm run fmt:check         # ruff format --check (CI)
```

### TypeScript/JavaScript (ESLint, Prettier)

**Frontend:**
```bash
npm --workspace apps/fluxion-platform-frontend run lint      # eslint --max-warnings 0
npm --workspace apps/fluxion-platform-frontend run typecheck # tsc --noEmit
```

**Zero-warning policy:** `--max-warnings 0` enforced. No warnings allowed in main branch.

### Kotlin (Android)

**Build-time checks:** `./gradlew lint`

---

## Related Documentation

- **`docs/system-architecture.md`** — Component topology, flows
- **`docs/deployment-guide.md`** — Deploy procedure, post-deploy steps
- **`docs/project-overview-pdr.md`** — Platform scope and requirements
- **Per-app standards** — `apps/{app}/docs/code-standards.md` for app-specific patterns
