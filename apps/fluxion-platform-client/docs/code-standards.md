# Code Standards & Codebase Structure

## Overview

This document defines the code standards observed in the Fluxion DPC codebase and establishes expectations for future contributions.

**Language:** Kotlin + Jetpack Compose UI
**Build System:** Gradle (Android)
**Target:** minSdk 28, targetSdk 34, JVM 17

---

## Directory Structure

```
app/
├── build.gradle.kts                 # Gradle build config
├── proguard-rules.pro               # (minimal, no obfuscation for debug)
└── src/main/
    ├── AndroidManifest.xml          # App permissions, activities, services
    ├── java/com/fluxion/client/
    │   ├── MainActivity.kt           # Entry point, phase routing
    │   ├── DpcApp.kt                 # Application class, system hooks
    │   ├── data/                     # Data layer
    │   │   ├── ApiClient.kt          # REST API (Retrofit + Moshi)
    │   │   ├── Dtos.kt               # Request/response models
    │   │   ├── SecureStorage.kt      # Encrypted SharedPreferences
    │   │   └── DeviceStateEvents.kt  # In-process state flow
    │   ├── work/                     # Background work
    │   │   └── CheckinWorker.kt      # Event-driven checkin loop
    │   ├── fcm/                      # FCM integration
    │   │   └── FluxionFcmService.kt  # Message handler
    │   ├── command/                  # Command execution
    │   │   └── CommandExecutor.kt    # Handler dispatch
    │   ├── ui/                       # Compose UI
    │   │   ├── MainActivity.kt       # (routes from MainActivity.kt)
    │   │   ├── *Screen.kt            # Phase-specific screens
    │   │   ├── LockedActivity.kt     # Kiosk lock activity
    │   │   ├── DpcComponents.kt      # Shared components
    │   │   └── theme/                # Material3 theming
    │   └── platform/dpc/
    │       └── FluxionDeviceAdminReceiver.kt  # Device Admin receiver
    ├── res/
    │   ├── xml/
    │   │   ├── device_admin.xml      # Device Admin capabilities
    │   │   └── data_extraction_rules.xml
    │   └── values/
    │       ├── colors.xml            # Material3 colors
    │       ├── strings.xml           # UI strings
    │       ├── themes.xml            # Theme definitions
    │       └── dimens.xml            # Dimensions
    └── res/drawable*, res/mipmap*    # Icons, drawables
scripts/
└── adb-enroll.sh                     # Device Owner activation
```

### File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Kotlin class | PascalCase | `CheckinWorker.kt`, `CommandExecutor.kt` |
| Kotlin file | PascalCase | `EulaScreen.kt`, `SecureStorage.kt` |
| Resource file | snake_case | `device_admin.xml`, `data_extraction_rules.xml` |
| Gradle config | snake_case | `build.gradle.kts` |
| Shell script | kebab-case | `adb-enroll.sh` |

---

## Kotlin Coding Standards

### Package Organization

```kotlin
com.fluxion.client
├── MainActivity, DpcApp (root)
├── data.*          # Data layer: API client, DTOs, storage
├── work.*          # Background workers
├── fcm.*           # FCM service
├── command.*       # Command execution
├── ui.*            # Compose screens, components
└── platform.dpc.*  # System integration (Device Admin)
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `CheckinWorker`, `CommandExecutor` |
| Functions | camelCase | `enqueueImmediate()`, `handleLock()` |
| Properties | camelCase | `apiKey`, `deviceId` |
| Constants | UPPER_SNAKE_CASE | `UNIQUE_NAME`, `CHANNEL_HIGH` |
| Sealed classes | PascalCase variant | `UiState.Active`, `UiState.Released` |

### Import Organization

```kotlin
// 1. Android framework
import android.content.Context
import android.util.Log

// 2. AndroidX
import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel

// 3. External libraries
import com.squareup.retrofit2.*
import com.squareup.moshi.*

// 4. Project-local
import com.fluxion.client.data.SecureStorage
import com.fluxion.client.ui.theme.FluxionTheme
```

### Visibility Modifiers

- **Public (default):** Top-level classes, functions, interfaces
- **Internal:** Classes shared within the package; prefer over package-private
- **Private:** Implementation details, local classes, private functions
- **Protected:** Sealed class variants extending sealed parent

**Example:**
```kotlin
// Public ctor for external callers
class CheckinWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params)

// Private helper
private fun handleHttpError(e: HttpException): Result { ... }

// Internal for same-module access
internal fun stashAck(storage: SecureStorage, result: CommandResultDto) { ... }
```

### String Formatting

- **Resource strings** for user-facing text (strings.xml)
- **Inline strings** for logs, technical messages
- **No hardcoded credentials** — use BuildConfig injection (local.properties)

**Example:**
```kotlin
// UI text from resources
val welcomeText = context.getString(R.string.welcome_message)

// Log with tag
Log.i(TAG, "Checkin completed")

// BuildConfig injection from local.properties
val baseUrl = BuildConfig.DPC_BASE_URL
```

### Error Handling

- **Explicit catch blocks** for known exceptions
- **Try-catch with Result type** for WorkManager operations
- **Log at WARN level** for expected failures (HTTP 401, 5xx)
- **Log at ERROR level** for unexpected failures with stack trace
- **Self-healing patterns** on 401 (clear storage) and 5xx (retry)

**Example:**
```kotlin
return when (errorCode) {
    "INVALID_CREDENTIALS" -> {
        storage.clear()
        Result.success() // No retry; re-enroll on next boot
    }
    "DEVICE_RELEASED" -> {
        storage.clear()
        cancelAll(applicationContext)
        Result.success()
    }
    else -> if (code in 500..599) Result.retry() else Result.success()
}
```

---

## Data Layer Standards

### Models (DTOs)

- **Moshi-serializable** data classes with snake_case JSON keys
- **Nullable fields** for optional JSON values (use `field: Type?`)
- **No default parameter values** in DTOs (let JSON deserializer set null)

**Example:**
```kotlin
@JsonClass(generateAdapter = true)
data class CheckinRequest(
    @Json(name = "command_result")
    val commandResult: CommandResultDto?
)

@JsonClass(generateAdapter = true)
data class CommandDto(
    @Json(name = "command_id")
    val commandId: String,
    @Json(name = "action_type")
    val actionType: String,
    @Json(name = "payload")
    val payload: NotificationPayload
)
```

### SecureStorage

- **AES256-GCM encryption** via AndroidKeyStore
- **Fail-safe:** Missing key → clear and re-enroll
- **Never log encrypted values**
- **Clear pattern:** `storage.clear()` wipes all keys

**Example:**
```kotlin
class SecureStorage(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(...)
    
    var apiKey: String?
        get() = prefs.getString("api_key", null)
        set(value) = prefs.edit().putString("api_key", value).apply()
}
```

### API Client

- **Retrofit interface** for type-safe API calls
- **Custom headers** for device identification (X-Device-IMEI, X-DPC-Version, User-Agent)
- **Bearer token auth** for checkin (stored in SecureStorage)
- **X-Internal-API-Key** for enroll (injected from BuildConfig)

**Example:**
```kotlin
interface FluxionApi {
    @POST("v1/enroll")
    suspend fun enroll(
        @Header("X-Internal-API-Key") apiKey: String,
        @Body body: EnrollRequest
    ): EnrollResponse

    @POST("v1/checkin")
    suspend fun checkin(
        @Header("Authorization") authorization: String,
        @Header("X-Device-IMEI") imei: String,
        @Header("X-DPC-Version") dpcVersion: String,
        @Body body: CheckinRequest
    ): CheckinResponse
}
```

---

## Async & Concurrency Standards

### WorkManager

- **CoroutineWorker** for suspend-friendly background tasks
- **Unique work with REPLACE policy** for deduplication (enqueueImmediate)
- **Result.retry()** only for transient errors (5xx, network)
- **Result.success()** for terminal states (401, DEVICE_RELEASED, command processed)

**Example:**
```kotlin
class CheckinWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // Network call
        val response = ApiClient.api.checkin(...)
        // Terminal: success
        return Result.success()
    }
}

// Enqueue with REPLACE
fun enqueueImmediate(context: Context) {
    val request = OneTimeWorkRequestBuilder<CheckinWorker>().build()
    WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_NAME,
        ExistingWorkPolicy.REPLACE,
        request
    )
}
```

### StateFlow & LiveData

- **StateFlow** for observable state (ViewModel)
- **In-process Flow** for state propagation (DeviceStateEvents)
- **Collect in Compose** via `collectAsState()`
- **Never mutate state** — use MutableStateFlow/LiveData for writes

**Example:**
```kotlin
class MainViewModel(context: Context) : ViewModel() {
    private val _state = MutableStateFlow<UiState>(UiState.Eula)
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun startEnroll() {
        _state.value = UiState.Enrolling
        viewModelScope.launch {
            ApiClient.api.enroll(...)
            _state.value = UiState.Active(template)
        }
    }
}
```

### Coroutines

- **viewModelScope** in ViewModels (auto-cancel on destroy)
- **LaunchedEffect** in Compose for effects tied to composition
- **withContext(Dispatchers.IO)** for network calls (Retrofit does this automatically)

---

## UI / Compose Standards

### Screen Functions

- **Separate screen composables** per phase (EulaScreen, EnrollingScreen, ActiveScreen, etc.)
- **Pass data via parameters**, not global state
- **Callbacks for user actions** (onAccept, onDismiss)
- **Material3 theme** via FluxionTheme

**Example:**
```kotlin
@Composable
fun EulaScreen(
    errorText: String? = null,
    onAccept: () -> Unit
) {
    FluxionTheme {
        Column(modifier = Modifier.fillMaxSize()) {
            Text("EULA content")
            if (errorText != null) {
                Text(errorText, color = Color.Red)
            }
            Button(onClick = onAccept) {
                Text("Accept")
            }
        }
    }
}
```

### Components

- **Reusable components** in DpcComponents.kt (WelcomeTemplate, FluxionButton, FluxionText)
- **Consistent spacing** via `Poppins` typography and Material3 spacing
- **Dark mode support** via FluxionTheme (automatic via Material3)

### Activities (Non-Compose)

- **LockedActivity** uses `startLockTask()` for kiosk lock
- **Flags:** singleTop, showWhenLocked, turnScreenOn
- **Static helpers:** `dismiss(context)`, `update(context, ...)`

---

## Security Standards

### Encryption

- **AES256-GCM** for all sensitive data (api_key, device_id, ack)
- **AndroidKeyStore** master key (automatic rotation)
- **EncryptedSharedPreferences** for convenience

### Permissions

- **Principle of least privilege:** only request needed permissions
- **Current perms:** INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, READ_PHONE_STATE, USE_FULL_SCREEN_INTENT
- **No spy permissions** (camera, location, contacts)
- **Runtime request** for POST_NOTIFICATIONS (API 33+)

### Network

- **Cleartext traffic disabled:** `usesCleartextTraffic=false` in manifest
- **HTTPS only**
- **Certificate pinning** (future enhancement, post-MVP)
- **Bearer token** (not Basic auth)

### Device Admin

- **Only use for lock/unlock, notifications, admin APIs**
- **No camera, contacts, location, or file system access**
- **Device Owner revocation** permitted (user can disable at setup)

---

## Logging Standards

### Log Tags

| Component | Tag | File |
|-----------|-----|------|
| MainActivity, MainViewModel | FluxionMain | MainActivity.kt |
| CheckinWorker | FluxionCheckin | CheckinWorker.kt |
| CommandExecutor | FluxionCommand | CommandExecutor.kt |
| DpcApp, system hooks | FluxionApp | DpcApp.kt |
| FCM service | FluxionFcm | FluxionFcmService.kt |

### Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| **ERROR** | Unexpected failures, stack trace | Deserialization error, constraint violation |
| **WARN** | Expected failures, self-healing | 401 (clear storage), 5xx (retry), dropped ack |
| **INFO** | Lifecycle, important milestones | "Enrolled", "Release ack flushed", "LOCK command executed" |
| **DEBUG** | (not used in current codebase) | — |
| **VERBOSE** | (not used in current codebase) | — |

**Example:**
```kotlin
Log.i(TAG, "Execute command_id=${command.commandId} action=${command.actionType}")
Log.w(TAG, "Checkin HTTP $code error=$errorCode")
Log.e(TAG, "Failed to fetch icon", exception)
```

---

## Testing Standards

### Current State

**No automated tests.** Manual lifecycle test validates:
1. Fresh enroll → ACTIVE state
2. LOCK command latency ≤ 3 s
3. 3× stable lock/unlock cycles
4. Snapshot restore

### Future Standards (Post-MVP)

- **Unit tests** for DTOs, SecureStorage encryption round-trips, checkin error cases
- **Instrumented tests** for WorkManager + content provider integration
- **UI tests** for screen transitions, input validation
- **Test coverage:** ≥ 80% for critical paths (enroll, checkin, release)

---

## Build & Dependency Standards

### Gradle Configuration

- **minSdk:** 28 (required for Device Admin APIs, encryption)
- **targetSdk:** 34 (current stable, Material3 recommended)
- **JVM:** 17 (modern Kotlin, future-proof)
- **Compose:** BOM 2024.06.00
- **Kotlin compiler extension:** 1.5.14

### Dependency Selection

| Responsibility | Library | Rationale |
|---|---|---|
| **REST API** | Retrofit 2.11.0 + Moshi 1.15.1 | Type-safe, JSON serialization, minimal boilerplate |
| **Encryption** | security-crypto 1.1.0-alpha06 | AndroidKeyStore integration, AES256-GCM |
| **Background work** | WorkManager 2.9.1 | Event-driven, deferrable, respects battery constraints |
| **Messaging** | Firebase Cloud Messaging 33.1.2 | Instant delivery, integrated with Google Play |
| **Compose UI** | androidx.compose 2024.06.00 | Modern declarative UI, Material3 design system |
| **Icons** | Coil 2.7.0 | Lightweight image loading, Compose integration |

### Avoiding External Dependencies

- **No HTTP client besides OkHttp** (Retrofit uses it)
- **No JSON library besides Moshi** (Retrofit uses it)
- **No DI framework** (manual construction in DpcApp, ViewModelFactory)
- **No third-party encryption** (use AndroidKeyStore + security-crypto)

---

## Common Patterns

### Two-Mode Protocol (CheckinWorker)

```kotlin
val pendingAck = storage.pendingAckJson?.let { ... }

if (pendingAck != null) {
    // ACK-mode: report result, clear, idle (never pull)
    storage.pendingAckJson = null
    return Result.success()
} else {
    // PULL-mode: execute command, stash ack, fire ACK run
    response.command?.let {
        CommandExecutor(context).execute(it)
        enqueueImmediate(context)
    }
    return Result.success()
}
```

### Persist-Before-Launch

```kotlin
// Write to storage BEFORE starting activity (consistency survives dropped background start)
persistActivePhase(notification)
launchWelcome(MainActivity.TRANSITION_ACTIVATE_WELCOME, notification)
```

### Self-Healing on Auth Error

```kotlin
when (errorCode) {
    "INVALID_CREDENTIALS" -> {
        storage.clear()  // Next boot: EULA → re-enroll
        Result.success()
    }
    // ...
}
```

### Transient Welcome Flourish

```kotlin
// Transient state in ViewModel memory only (intent extras)
LaunchedEffect(state) {
    if (state is UiState.ActiveWelcome) {
        delay(WELCOME_TIMEOUT_MS)
        vm.settleToActive()  // Back to steady Active
    }
}
```

---

## Code Review Checklist

Before submitting a change, verify:

- [ ] **Naming:** PascalCase for classes, camelCase for functions, UPPER_SNAKE_CASE for constants
- [ ] **Imports:** Organized and no unused imports
- [ ] **Error handling:** Explicit catch blocks, appropriate log levels, self-healing on transient errors
- [ ] **Encryption:** Sensitive data persisted via SecureStorage only
- [ ] **Logging:** Appropriate tags and levels; no credential/token leaks
- [ ] **Async:** WorkManager Result types correct (retry vs success); viewModelScope used in ViewModel
- [ ] **Security:** No cleartext, no hardcoded secrets, minimal permissions
- [ ] **Testing:** Manual lifecycle test validates change (post-MVP: unit + instrumented tests)
- [ ] **Documentation:** Inline comments for non-obvious logic (e.g., two-mode protocol invariants)
- [ ] **Consistency:** Follows patterns established in CheckinWorker, CommandExecutor, MainActivity

---

## Prohibited Patterns

| Anti-Pattern | Why | Alternative |
|---|---|---|
| **DI framework (Hilt, Dagger)** | Overkill for single-module app; manual injection is clear | Constructor injection, ViewModelFactory |
| **Global singletons** (beyond BuildConfig) | State management complexity; hard to test | Pass context/storage as parameters |
| **SharedPreferences.apply()** instead of .commit() | Can lose writes on process death | Use EncryptedSharedPreferences which auto-syncs |
| **Hardcoded credentials in code** | Security risk; fails git scanning | Use local.properties + BuildConfig injection |
| **Periodic checkin** | Drains battery, ignores events | Event-driven: FCM, back-online, boot, post-execute |
| **Logging sensitive data** | Information disclosure | Never log api_key, deviceId, IMEI, ack |
| **Catching generic Exception** without logging | Silent failures, hard to debug | Always log catch block with full context |

---

## Refactoring & Modularization Rules

### Current State
- **Single Gradle module** `:app`
- **No feature modules** (none needed for Phase 03 scope)
- **No test modules** (manual lifecycle test only)

### If Expanding (Post-MVP)

- **Feature modules:** `feature-lock`, `feature-notify` (if complexity grows)
- **Core modules:** `core-api`, `core-storage`, `core-notification` (shared logic)
- **Max file size:** Keep under 300 LOC; split if exceeding
- **DI option:** Reconsider Hilt if 3+ feature modules introduced

---

## Documentation Standards

### Code Comments

- **WHY over WHAT:** Explain intent, not mechanics
- **Invariants:** Document assumptions that span multiple files
- **Gotchas:** Flag non-obvious behaviors (e.g., two-mode protocol, RELEASED_SENTINEL)
- **No stale comments:** Remove if code changes

**Example:**
```kotlin
// Trade-off: a dropped FCM wake while online is not recovered by a poll.
// Accepted for the event-driven model — back-online only covers the offline->online edge.
```

### Function/Class Documentation

- **KDoc** for public APIs
- **@return, @throws** only if non-obvious

**Example:**
```kotlin
/**
 * Event-driven checkin worker. No periodic polling — only woken by:
 * - FCM {wake:true} message
 * - Back-online NetworkCallback
 * - App boot (if enrolled)
 * - Post-execute ack flush
 */
class CheckinWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
```

---

## Change Management

### Backwards Compatibility

- **API versioning:** Not in scope for Phase 03 (single version per deploy)
- **Storage schema:** No migrations yet; post-MVP: add version + migrate logic if needed
- **Manifest:** Avoid removing permissions (breaks old enrollment)

### Breaking Changes

- Document in `docs/project-changelog.md`
- Tag version and release notes
- Coordinate with backend team on API contract changes

---

**Last Updated:** 2026-06-07 | **Version:** 0.3.0
