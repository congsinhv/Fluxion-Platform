# Fluxion Platform — Code Standards & Conventions

## Naming Conventions

### Python (Backend Lambdas)
- **Directories + top-level files:** kebab-case (e.g., `fluxion-platform-resolver/`, `sqs_client.py`).
- **Inside Python packages** (`routes/`, `resolvers/`): snake_case (import requirement, e.g., `checkin_route.py`, `device.py`).
- **Classes:** PascalCase (e.g., `AppError`, `FluxionDevice`).
- **Functions/methods:** snake_case (e.g., `update_device_fields`, `acquire_lock`).
- **Constants:** UPPER_SNAKE_CASE (e.g., `SYSTEM_ACTIONS`, `DATABASE_URL`).
- **Private:** Prefix with `_` (e.g., `_validate_imei`).

### TypeScript/JavaScript (Frontend, Infra)
- **Files:** kebab-case (e.g., `action-availability.ts`, `fluxion-stack.ts`).
- **Components:** PascalCase (e.g., `DeviceDetail.tsx`, `MilestoneTimeline.tsx`).
- **Utilities/services:** kebab-case or camelCase (e.g., `jwt-store.ts`, `apiClient.ts`).
- **Constants:** UPPER_SNAKE_CASE or camelCase enum members (e.g., `const MAX_DEVICES = 100`, `export const DevicePhase { EULA, ENROLLING, ACTIVE }`).

### Kotlin (Android Client)
- **Files:** PascalCase (e.g., `MainActivity.kt`, `CheckinWorker.kt`).
- **Classes/objects:** PascalCase.
- **Functions:** camelCase.
- **Constants:** UPPER_SNAKE_CASE (in companion object or top-level const).

### GraphQL Schema
- **Types:** PascalCase (e.g., `Device`, `Milestone`, `Action`).
- **Fields:** camelCase (e.g., `currentState`, `assignedAction`).
- **Enums:** UPPER_SNAKE_CASE (e.g., `REQUESTED`, `APPLIED`, `FAILED`).

## File Organization

### Backend Lambda Directory Structure
```
fluxion-platform-<name>/
├── CLAUDE.md
├── README.md
├── handler.py (or app.py for HTTP Lambdas)
├── config.py [DUPLICATED ACROSS ALL 5]
├── constants.py [DUPLICATED ACROSS ALL 5]
├── db.py [DUPLICATED ACROSS ALL 5]
├── errors.py [DUPLICATED ACROSS ALL 5]
├── sqs_client.py [DUPLICATED ACROSS ALL 5]
├── [optional] auth.py [DUPLICATED WHERE USED]
├── [optional] fcm_dispatcher.py [processor only]
├── routes/ (HTTP Lambdas: enroll, checkin)
│   ├── __init__.py
│   └── <route_name>.py
├── resolvers/ (resolver only)
│   ├── __init__.py (aggregates QUERY_HANDLERS/MUTATION_HANDLERS)
│   └── <entity>.py (e.g., device.py, action.py)
└── [optional] sqs_consumer.py (SQS-triggered Lambdas: processor, applier)
```

### Frontend Structure
```
src/
├── apollo/
│   └── client.ts
├── auth/
│   ├── cognito.ts
│   ├── AuthContext.tsx
│   ├── ProtectedRoute.tsx
│   └── jwt-store.ts
├── pages/
│   ├── LoginPage.tsx
│   ├── DeviceListPage.tsx
│   ├── DeviceDetailPage.tsx
│   └── [other pages]
├── components/
│   ├── Shell.tsx (sidebar layout)
│   ├── [feature].tsx (< 200 lines each)
│   ├── action-availability.ts (domain logic, no JSX)
│   └── icons.tsx (inline SVG only)
├── graphql/
│   ├── *.graphql (operation files)
│   └── generated/ (codegen output, gitignored)
├── styles/
│   ├── tokens.css (custom Tailwind tokens)
│   └── [other CSS as needed]
├── env.ts (centralized import.meta.env)
├── test/
│   └── setup.ts
└── App.tsx
```

### Android Structure
```
src/
├── main/kotlin/com/fluxion/client/
│   ├── MainActivity.kt
│   ├── DpcApp.kt
│   ├── [screens]/
│   │   ├── EnrollmentScreen.kt
│   │   ├── ActiveScreen.kt
│   │   ├── LockedActivity.kt
│   │   └── [other screens]
│   ├── work/
│   │   └── CheckinWorker.kt
│   ├── command/
│   │   └── CommandExecutor.kt
│   ├── fcm/
│   │   └── FluxionFcmService.kt
│   ├── storage/
│   │   └── SecureStorage.kt
│   ├── net/
│   │   └── CheckinApi.kt
│   ├── platform/dpc/
│   │   └── FluxionDeviceAdminReceiver.kt
│   └── [other packages]
└── google-services.json (Firebase, gitignored)
```

## Python Backend Patterns

### Database Patterns
**db.py:** Single module-global psycopg connection, configured at import.
```python
from psycopg import connection

# Module-global connection (created once, reused)
conn = None

def init_db(database_url):
    global conn
    conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=True)

def get_conn():
    return conn
```

**Query binding:** Always use `%(name)s` placeholders; never interpolate values.
```python
# GOOD
query = "SELECT * FROM devices WHERE imei = %(imei)s"
cursor.execute(query, {"imei": user_input})

# BAD (SQL injection risk)
query = f"SELECT * FROM devices WHERE imei = '{user_input}'"
```

**Transactions:** Use context manager for multi-statement writes.
```python
with db.conn.transaction():
    # Multiple statements; rolled back on exception
    db.conn.execute("UPDATE devices SET ...", ...)
    db.conn.execute("INSERT INTO milestones ...", ...)
```

### Error Handling
All errors inherit from `AppError` (defined in `errors.py`).
```python
class AppError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 500):
        self.code = code
        self.message = message
        self.http_status = http_status

class NotFound(AppError):
    def __init__(self, message: str):
        super().__init__("NOT_FOUND", message, 404)

# Usage
if not device:
    raise NotFound(f"Device {imei} not found")
```

**GraphQL error serialization (resolver):**
```python
# Resolver handler catches and serializes
except AppError as e:
    return {
        "errorType": e.__class__.__name__,
        "errorMessage": e.message,
        "extensions": {"code": e.code}
    }
```

**HTTP error serialization (enroll/checkin):**
```python
except AppError as e:
    return JSONResponse(
        {
            "error_code": e.code,
            "message": e.message,
            "retry_strategy": {
                "retryable": e.code != "INVALID_IMEI_FORMAT",
                "backoff_seconds": 5,
                "max_attempts": 3
            }
        },
        status_code=e.http_status
    )
```

### Logging
Config.py sets up root logger on import. Use `from config import logger`.
```python
from config import logger

logger.info("device.enroll imei=%s fcm_token=%s", imei, fcm_token)
logger.error("device.lock failed device_id=%s reason=%s", device_id, str(e))
```

**Log format:** `<service>.<event> key=value key=value` (no free text in structured logs).
Applier keeps historical `checkin_sqs.` prefix for log continuity.

### Single-Flight Lock Acquisition
Processor acquires the lock; applier clears it. Never acquire and release in same Lambda.
```python
# Processor only
query = """
    UPDATE devices 
    SET assigned_action_id = %(action_id)s 
    WHERE id = %(device_id)s AND assigned_action_id IS NULL
    RETURNING id
"""
rows = cursor.execute(query, {...}).fetchall()
if not rows:
    raise Conflict(f"Device {device_id} already has action in flight")
```

### Idempotent Acks
Applier checks milestone existence before writing APPLIED.
```python
# Applier
milestone_exists = cursor.execute(
    "SELECT id FROM milestones WHERE command_id = %(cmd_id)s LIMIT 1",
    {"cmd_id": command_id}
).fetchone()

if not milestone_exists:
    # Write APPLIED
    cursor.execute(
        "INSERT INTO milestones (...) VALUES (...)",
        {...}
    )
```

## TypeScript/React Frontend Patterns

### Component Size
Keep components under ~200 lines (including imports + tests).
- Exceed 200 lines → extract sub-components or move domain logic to separate `.ts` file.
- Example: If DeviceDetail exceeds 200 lines, extract MilestoneTimeline and CommandDispatch as separate files.

### Apollo Client Setup
Never add `nextFetchPolicy: 'cache-first'` — breaks 10s polling.
```typescript
// GOOD: Default cache-and-network + pollInterval
const { data } = useQuery(GET_DEVICE, {
  variables: { id },
  pollInterval: 10000
});

// BAD: cache-first kills polling
const { data } = useQuery(GET_DEVICE, {
  variables: { id },
  pollInterval: 10000,
  nextFetchPolicy: 'cache-first'  // ← BLOCKS REAL-TIME UPDATES
});
```

### GraphQL Code Generation
Edit `.graphql` operation files; run codegen; import from `generated/`.
```typescript
// src/graphql/queries.graphql
query GetDevice($id: ID!) {
  device(id: $id) { ... }
}

// After: npm run codegen
// src/components/DeviceDetail.tsx
import { GetDeviceDocument } from '@/graphql/generated/graphql';

const { data } = useQuery(GetDeviceDocument, { variables: { id } });
```

### Domain Logic (No JSX)
Separate pure logic from components.
```typescript
// src/components/action-availability.ts (no JSX)
export function getAvailableActions(device: Device): Action[] {
  if (device.assignedAction !== null) return [];
  return allowedActions[device.currentState] || [];
}

// src/components/DeviceDetail.tsx (uses above)
import { getAvailableActions } from './action-availability';

export function DeviceDetail({ device }: Props) {
  const available = getAvailableActions(device);
  return <div>...</div>;
}
```

### Testing
Colocate tests as `*.test.ts(x)`. Use Vitest.
```typescript
// src/components/action-availability.test.ts
import { describe, it, expect } from 'vitest';
import { getAvailableActions } from './action-availability';

describe('action-availability', () => {
  it('returns empty when action in flight', () => {
    const device = { currentState: 'ACTIVE', assignedAction: { id: '123' } };
    expect(getAvailableActions(device)).toEqual([]);
  });
});
```

### Content Security Policy
Production CSP is strict: `script-src 'self'` (no `unsafe-inline`). Vite plugin relaxes during dev only.
- Do NOT inject inline scripts in production build.
- Cognito SDK is CJS; vite.config.ts defines `global: "globalThis"` to bridge.
- Tests use jsdom with `css: false` (vitest.config.ts is standalone, doesn't inherit vite CSP relaxation).

### Design Tokens
Mirror custom Tailwind tokens in both `tailwind.config.ts` and `src/styles/tokens.css` (keep in sync).
```typescript
// tailwind.config.ts
const theme = {
  colors: {
    'editorial-cream': '#f5f1e8',
    'terracotta': '#c9735f'
  }
};

// src/styles/tokens.css
:root {
  --color-editorial-cream: #f5f1e8;
  --color-terracotta: #c9735f;
}
```

### No Emojis in UI
Use inline SVG icons only (`src/components/icons.tsx`).

## Kotlin Android Patterns

### Secure Storage
Use EncryptedSharedPreferences (AES256-GCM).
```kotlin
val encryptedPrefs = EncryptedSharedPreferences.create(
    context,
    "fluxion_secure_prefs",
    MasterKey.Builder(context).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
```

### Persist Before Launch
Write state to SecureStorage BEFORE starting activities.
```kotlin
// CommandExecutor
SecureStorage.setPhase(context, Phase.ACTIVE)
SecureStorage.setLastTemplate(context, template)
// THEN start activity
context.startActivity(Intent(context, ActiveScreen::class.java))
```

### Retry Strategy
Transport/5xx errors → `Result.retry()`; auth errors → wipe storage.
```kotlin
val response = apiClient.checkin(...)
return when {
    response.isSuccessful -> Result.success()
    response.code() in 500..599 -> Result.retry()  // 5xx
    response.code() == 403 -> {  // Auth error
        SecureStorage.clear(context)
        Result.success()  // Let MainActivity re-route to EULA
    }
    else -> Result.failure(Exception(response.message()))
}
```

### Two-Mode CheckinWorker Protocol
ACK-mode if `pendingAckJson` exists; PULL-mode otherwise.
```kotlin
val pendingAck = SecureStorage.getPendingAck(context)
if (pendingAck != null) {
    // ACK-MODE: report result, clear, done
    checkinApi.checkin(pendingAckJson = pendingAck)
    SecureStorage.clearPendingAck(context)
} else {
    // PULL-MODE: get command, execute, stash ack, re-enqueue ACK run
    val response = checkinApi.checkin()  // no body
    val command = response.command
    CommandExecutor.execute(context, command)
    SecureStorage.setPendingAck(context, ackJson)
    CheckinWorker.enqueueImmediate(context)  // ACK run
}
```

### All Wake Paths Funnel to CheckinWorker
```kotlin
// fcm/FluxionFcmService.kt
override fun onMessageReceived(remoteMessage: RemoteMessage) {
    if (remoteMessage.data["wake"] == "true") {
        CheckinWorker.enqueueImmediate(context)
    }
}

// DpcApp.kt (NetworkCallback)
override fun onAvailable(network: Network) {
    CheckinWorker.enqueueImmediate(context)
}

// CommandExecutor.kt (post-execute)
CommandExecutor.handleCommand(context, command)
CheckinWorker.enqueueImmediate(context)  // ACK run
```

## Linting & Formatting

### Python
**Tool:** Ruff (py312, line length 100, rules E/F/I/UP/B).
```bash
npm run lint / lint:fix   # ruff check / ruff check --fix
npm run fmt / fmt:check   # ruff format / ruff format --check
```

**Pre-commit check (recommended):**
```bash
python3 -m py_compile <changed_files>  # Syntax only; no unit tests
```

### TypeScript/JavaScript (Frontend)
**Tool:** ESLint with zero-warning policy.
```bash
npm --workspace apps/fluxion-platform-frontend run lint
npm --workspace apps/fluxion-platform-frontend run typecheck
```

### Kotlin (Android)
No linter in this project. Manual review. Respect Kotlin conventions (PascalCase classes, camelCase functions).

## Testing Strategy

### Python Backend
**No unit tests exist.** E2E validation only: an end-to-end lifecycle test against a deployed stack.
- Asserts canonical 10-milestone trail, lock rejection, idempotent acks.
- Polls (eventually consistent).
- Run after deploy for confidence.

### Frontend
**Vitest unit tests** for domain logic:
- `action-availability.test.ts` — Action dispatch gates.
- `MilestoneTimeline.test.tsx` — Milestone grouping.
- Run before committing: `npm run test`.

### Android
**No tests.** Manual lifecycle validation (see README.md).

## GraphQL & Schema

### Source of Truth
`infra/schema/appsync.graphql` is the single source of truth.
- Changes here → redeploy infra (`npm run infra:deploy`) AND re-run frontend codegen (`npm run codegen`).
- Never introspect deployed API (requires JWT; breaks codegen).

### Case Convention
- **Types:** PascalCase (e.g., `type Device { ... }`).
- **Fields:** camelCase (e.g., `device(id: ID!): Device`).
- **Enums:** UPPER_SNAKE_CASE (e.g., `enum MilestoneStatus { REQUESTED, APPLIED, FAILED }`).

## Intentional Duplication

**Do NOT extract a shared package.** config.py / constants.py / db.py / errors.py / sqs_client.py / auth.py (where used) are copied into every Lambda dir.

**Reason:** CDK Docker-bundles each dir as one self-contained asset. A `shared/` package breaks asset hashing and independent deploys.

**When changing:** Mirror the change across all sibling copies. Drift is acceptable only where a Lambda genuinely doesn't need the code.

## Comments & Code Clarity

### When to Comment
- **Why**, not what: "Optimizer rejects `order by assigned_action_id IS NULL` syntax, so we check after SELECT" (better than "Check if action in flight").
- Race conditions / invariants: "Only applier writes APPLIED milestones (processor writes REQUESTED only); ensures single writer."
- Non-obvious logic: Complex query builder, state machine transitions, etc.

### Avoid
- Paraphrasing variable names ("get the device" for `get_device()`).
- Stating the obvious (comments on simple assignments, loops, standard patterns).
- Plan/finding references (phase numbers, audit codes, etc.) — changes are unstable.

## Pre-Commit Checklist

Before committing:
- [ ] No syntax errors: `python3 -m py_compile` (Python) or Kotlin IDE check.
- [ ] Linting passes: `npm run lint` (TypeScript), `npm run fmt:check` (Python).
- [ ] Tests pass: `npm run test` (frontend).
- [ ] No secrets/credentials in code (no `.env` files, API keys, tokens).
- [ ] GraphQL changes → redeploy infra + re-run codegen.
- [ ] Duplicated Lambda files updated consistently.
- [ ] Commit message follows conventional commits (feat:, fix:, docs:, refactor:, test:).
