# Codebase Summary — Fluxion DPC Client

**Version:** 0.3.0 | **Total Lines:** ~1,800 Kotlin + 300 XML/Gradle | **No tests directory**

## Quick Navigation

- **Core Loop:** `work/CheckinWorker.kt` → `command/CommandExecutor.kt` → handlers
- **UI Routing:** `MainActivity.kt` → phase-based screen selection
- **Secure Storage:** `data/SecureStorage.kt` (AES256-GCM encrypted)
- **REST Contract:** `../../Artifacts/mdm-rest-api-dpc.html`

---

## Source Tree Overview

### Root Level
```
app/
├── build.gradle.kts                    [98 lines] — minSdk 28, targetSdk 34, JVM 17
├── google-services.json                [gitignored] Firebase config
├── google-services-debug.json          [fallback stub]
├── proguard-rules.pro                  [minimal, no obfuscation]
└── src/main/
    ├── AndroidManifest.xml             [63 lines] — perms, activities, receiver, FCM service
    ├── res/
    │   ├── xml/
    │   │   ├── device_admin.xml        [minimal Device Admin declaration]
    │   │   └── data_extraction_rules.xml
    │   └── values/
    │       ├── colors.xml              [Material 3 palette]
    │       ├── strings.xml             [app_name, UI strings]
    │       ├── themes.xml              [Theme.Fluxion, Theme.Fluxion.Lock]
    │       └── dimens.xml              [padding/spacing]
    └── java/com/fluxion/client/
        ├── MainActivity.kt             [292 lines] ⭐ Main entry, phase routing
        ├── DpcApp.kt                   [82 lines] ⭐ Application class, allowlist
        ├── data/
        │   ├── ApiClient.kt            [71 lines] Retrofit + Moshi + auth
        │   ├── Dtos.kt                 [81 lines] Request/response DTOs (snake_case JSON)
        │   ├── SecureStorage.kt        [86 lines] ⭐ AES256-GCM encryption
        │   └── DeviceStateEvents.kt    [27 lines] In-process state flow
        ├── work/
        │   └── CheckinWorker.kt        [156 lines] ⭐ Event-driven checkin loop
        ├── fcm/
        │   └── FluxionFcmService.kt    [25 lines] FCM wake → enqueueImmediate
        ├── command/
        │   └── CommandExecutor.kt      [295 lines] ⭐ 7 action handlers
        ├── ui/
        │   ├── EulaScreen.kt           [64 lines] EULA acceptance
        │   ├── EnrollingScreen.kt      [29 lines] Spinner during enroll POST
        │   ├── ActiveScreen.kt         [58 lines] Steady state with template
        │   ├── ActiveWelcomeScreen.kt  [~35 lines] Transient welcome (ACTIVATE)
        │   ├── WelcomeBackScreen.kt    [~20 lines] Transient welcome (UNLOCK)
        │   ├── ReleasedScreen.kt       [19 lines] Post-release terminal state
        │   ├── DpcComponents.kt        [169 lines] Shared Compose components
        │   ├── LockedActivity.kt       [294 lines] ⭐ Kiosk via startLockTask
        │   └── theme/
        │       ├── Color.kt            [24 lines] Material3 seed color
        │       ├── Type.kt             [10 lines] Typography (Poppins)
        │       └── Theme.kt            [44 lines] FluxionTheme, Lock theme
        └── platform/dpc/
            └── FluxionDeviceAdminReceiver.kt [26 lines] DeviceAdminReceiver stub
scripts/
└── adb-enroll.sh                       [41 lines] ⭐ dpm set-device-owner + perms
local.properties.example                Template: sdk.dir, DPC_BASE_URL, DPC_INTERNAL_API_KEY
```

---

## File-by-File Inventory (Core Components)

### ⭐ Critical Files (Read First)

#### `MainActivity.kt` (292 lines)
**Purpose:** Main entry point; routes UI based on enrollment phase.

**Key Classes:**
- `MainActivity(ComponentActivity)` — singleTask launcher; consumes transition intent extras
- `MainViewModel(ViewModel)` — manages UiState flow; reads SecureStorage on init + onResume
- `UiState(sealed)` — Eula, Enrolling, ActiveWelcome, Active, WelcomeBack, Released, Error

**Key Methods:**
- `onCreate()` — sync MainViewModel, request notification perm, check cold-start transition extra
- `onNewIntent()` — handle singleTask re-launch while warm; route transition
- `consumeTransitionIntent()` — check for TRANSITION_ACTIVATE_WELCOME / TRANSITION_UNLOCK_WELCOME extras
- `startEnroll()` — POST /v1/enroll with IMEI + FCM token
- `readImei()` — prefers `TelephonyManager.deviceId`, falls back to ANDROID_ID digits padded/trimmed to 15

**Welcome Flourish Logic:**
- Transient welcome states (ActiveWelcome, WelcomeBack) persist ONLY in ViewModel memory (intent extras)
- After 4 s (WELCOME_TIMEOUT_MS), settle back to steady Active
- Kill + reopen always lands on steady state from SecureStorage

**Invariant:** Persist phase to SecureStorage BEFORE launching activity so cold reopen is consistent even if background activity-start is dropped.

---

#### `CheckinWorker.kt` (156 lines)
**Purpose:** Event-driven CoroutineWorker; NO periodic polling. Dual-mode protocol.

**Key Classes:**
- `CheckinWorker(CoroutineWorker)` — runs on WorkManager thread pool
- Two-mode logic:
  - **ACK-mode:** If `pendingAckJson` exists, report result and clear (never act on response.command)
  - **PULL-mode:** If no pending ack, execute response.command → CommandExecutor stashes ack → fire immediate ACK run

**Key Methods:**
- `doWork()` — main loop; check enrolled status, fetch pending ack, POST /v1/checkin, dispatch result
- `handleHttpError()` — retry on 5xx; self-heal on INVALID_CREDENTIALS/MISSING_API_KEY (clear storage); DEVICE_RELEASED (clear + cancel work); UNKNOWN_COMMAND_ID (drop ack)
- `enqueueImmediate(context)` — unique work "fluxion-checkin" with REPLACE policy; used by FCM wake, back-online, app boot, post-execute
- `stashAck()` — serialize CommandResultDto to JSON, store in pendingAckJson

**Wake Sources:** FCM {wake:true}, app boot, back-online NetworkCallback, post-execute ack flush. All funnel through enqueueImmediate() — safe because backend is single-flight per device + acks are command_id-idempotent.

**RELEASE Deferred Cleanup:** ACK-mode success checks if `deviceId == RELEASED_SENTINEL` → wipes storage + cancels work.

---

#### `CommandExecutor.kt` (295 lines)
**Purpose:** Switch on action_type; dispatch to 7 handlers; stash ack for next checkin.

**Key Classes:**
- `CommandExecutor(context)` — instantiated per command in CheckinWorker.PULL-mode

**Handler Methods:**
1. `handleActivate(notification)` — post welcome notification, persist ACTIVE phase, launch ActivityWelcome
2. `handleLock(notification)` — start LockedActivity (new task, clear task); post fullscreen notification
3. `handleUnlock(notification)` — dismiss LockedActivity, post unlock notification, persist ACTIVE, launch WelcomeBack
4. `handleNotify(notification)` — post custom notification (POPUP or FULLSCREEN mode); stay in current phase
5. `handleNotifyFromLocked(notification)` — special: render message on locked surface (LockedActivity.update) + FULLSCREEN fallback
6. `handleRelease()` — clear credentials (optional; app re-enrolls on next boot if dropped), relinquish Device Owner, set deviceId = RELEASED_SENTINEL
7. `handleReleaseFromLocked()` — same as handleRelease

**Notification Channels:**
- `fluxion_high` — IMPORTANCE_HIGH (ACTIVATE, LOCK, UNLOCK, NOTIFY FULLSCREEN)
- `fluxion_default` — IMPORTANCE_DEFAULT (NOTIFY POPUP)

**Coil Icon Fetch:**
- Bounded to 2.5 s (blocking); stores in memory cache; sizes down large icons

**Invariant:** Persist phase/template to SecureStorage BEFORE starting activities.

---

#### `SecureStorage.kt` (86 lines)
**Purpose:** Encrypt/decrypt sensitive data using AES256-GCM.

**Key Classes:**
- `SecureStorage(context)` — wraps EncryptedSharedPreferences

**Encrypted Fields:**
- `api_key` — Bearer token for checkin; cleared on DEVICE_RELEASED
- `device_id` — assigned by backend; set to RELEASED_SENTINEL during release
- `imei` — sent in X-Device-IMEI header
- `pending_ack` — JSON-serialized CommandResultDto
- `interval_seconds` — server-provided checkin interval (default 3600 s)
- `current_phase` — EULA, ENROLLING, ACTIVE, RELEASED
- `last_template_*` — title, content, icon_url from last notification

**Encryption Config:**
- Master key: AndroidKeyStore AES256-GCM
- Pref file: "fluxion_secure"
- Key encryption: AES256_SIV
- Value encryption: AES256_GCM

**Clear Operation:**
- `clear()` — wipes all keys; used on 401 (INVALID_CREDENTIALS) and DEVICE_RELEASED

---

#### `LockedActivity.kt` (294 lines)
**Purpose:** Kiosk lock via `startLockTask()`; immersive full-screen.

**Key Classes:**
- `LockedActivity(AppCompatActivity)` — singleTop, showWhenLocked, turnScreenOn

**Configuration:**
- Allowlist primed in `DpcApp.onCreate()` via `DevicePolicyManager.setLockTaskPackages()`
- While locked, notification shade hidden, home/back/recents disabled
- FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK ensures single instance

**Display Logic:**
- Header icon + title + content rendered on locked surface
- If `displayMode == "FULLSCREEN"`, also post a fullscreen notification as fallback (survives Doze)
- Static methods `dismiss(context)` and `update(context, ...)` for safe manipulation from CommandExecutor

**Intent Extras (from CommandExecutor):**
- `EXTRA_TITLE` — lock screen title
- `EXTRA_CONTENT` — lock screen body
- `EXTRA_ICON` — header icon URL (fetched by Coil)

**Invariant:** Lock state persists across kills via SecureStorage phase. If device killed while locked, next boot re-reads phase and may re-launch if still ACTIVE (cold boot logic).

---

#### `DpcApp.kt` (82 lines)
**Purpose:** Application class; prime lock-task allowlist; register back-online NetworkCallback.

**Key Methods:**
- `onCreate()` — set allowlist via `DevicePolicyManager.setLockTaskPackages([PKG])` (Device Owner only)
- `registerNetworkCallback()` — detect back-online (ConnectivityManager.NetworkCallback) → enqueueImmediate

**Boot Logic:**
- If enrolled (api_key exists), trigger immediate checkin to fetch any pending commands
- If not enrolled, app lands on EULA screen

---

#### `ApiClient.kt` (71 lines)
**Purpose:** Retrofit + Moshi + OkHttp; configure API endpoints and authentication.

**Key Interfaces:**
- `FluxionApi` — POST /v1/enroll, POST /v1/checkin

**Authentication:**
- Enroll: X-Internal-API-Key header
- Checkin: Bearer token (api_key)

**Headers:**
- X-Device-IMEI — device identifier
- X-DPC-Version — app version (BuildConfig.VERSION_NAME)
- User-Agent — "Fluxion-DPC/{version}"

**Timeouts:**
- Connect: 15 s
- Read: 30 s

**Logging:**
- OkHttp body logging in debug builds

---

#### `FluxionFcmService.kt` (25 lines)
**Purpose:** Handle FCM data messages; trigger immediate checkin on wake.

**Key Methods:**
- `onMessageReceived(remoteMessage)` — check for "wake" key in data → enqueueImmediate
- Token rotation: new token picked up at next checkin (no forced re-enroll)

---

#### `Dtos.kt` (81 lines)
**Purpose:** Request/response data classes; Moshi-serializable (snake_case JSON).

**Key Types:**
- `EnrollRequest` (imei, fcmToken, deviceInfo)
- `EnrollResponse` (apiKey, deviceId, intervalSeconds, registrationState)
- `CheckinRequest` (commandResult: CommandResultDto)
- `CheckinResponse` (command: CommandDto)
- `CommandDto` (commandId, actionType, payload: NotificationPayload)
- `CommandResultDto` (status: SUCCESS/FAILED, errorCode, errorMessage)
- `NotificationPayload` (displayMode POPUP/FULLSCREEN, title, content, headerIconUrl, notificationIconUrl)
- `ApiError` (errorCode)
- `DeviceInfoDto` (dpcVersion, androidSdk)

---

#### `DeviceStateEvents.kt` (27 lines)
**Purpose:** In-process flow signal for live state propagation.

**Key:**
- `notifyChanged()` — trigger MainViewModel foreground state refresh without persisting
- Used by CommandExecutor after executing ACTIVATE/UNLOCK to push updated template to UI live

---

### UI Screens (Compose)

#### `EulaScreen.kt` (64 lines)
- EULA text + accept button
- Error message display on 401 or transport failure
- Calls `onAccept()` → MainViewModel.startEnroll()

#### `EnrollingScreen.kt` (29 lines)
- Spinner + "Enrolling..." label during POST /v1/enroll

#### `ActiveScreen.kt` (58 lines)
- Template display: title, content, optional icon
- Steady state after ACTIVATE; persists across app kill

#### `ActiveWelcomeScreen.kt` (~35 lines, in DpcComponents.kt)
- Decorated welcome variant (flourish) on ACTIVATE
- 4 s timeout → settles to ActiveScreen

#### `WelcomeBackScreen.kt` (~20 lines, in DpcComponents.kt)
- Decorated welcome variant on UNLOCK
- 4 s timeout → settles to ActiveScreen

#### `ReleasedScreen.kt` (19 lines)
- Terminal state: "Device released" message
- Offers no action; stays until next enroll

#### `LockedActivity.kt` (294 lines)
- Kiosk lock screen (see critical files above)

#### `DpcComponents.kt` (169 lines)
- `WelcomeTemplate()` — shared Compose layout (header, title, content, icon, animation)
- `FluxionButton()`, `FluxionText()` — branded Compose components
- Theme-aware styling

---

### Theme

#### `Theme.kt` (44 lines)
- `FluxionTheme(content)` — Material3 dynamic color + light/dark mode
- `Theme.Fluxion.Lock` — locked activity theme (transparent bg, no status bar)

#### `Color.kt` (24 lines)
- Material3 seed color (primary, secondary, tertiary)

#### `Type.kt` (10 lines)
- Poppins typography (Display, Headline, Title, Body, Label)

---

### Configuration & Build

#### `build.gradle.kts` (98 lines)
- Compose BOM 2024.06.00
- Networking: Retrofit 2.11.0, Moshi 1.15.1, OkHttp logging 4.12.0
- Security: security-crypto 1.1.0-alpha06
- WorkManager: 2.9.1
- Firebase: BOM 33.1.2 (messaging)
- Coil: 2.7.0
- Compiler: Kotlin 1.5.14, JVM 17
- BuildConfig injection: DPC_BASE_URL, DPC_INTERNAL_API_KEY (from local.properties)

#### `AndroidManifest.xml` (63 lines)
- Permissions: INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, READ_PHONE_STATE, USE_FULL_SCREEN_INTENT
- Activities: MainActivity (singleTask), LockedActivity (singleTop)
- Services: FluxionFcmService (FCM receiver)
- Receiver: FluxionDeviceAdminReceiver (Device Admin)
- Security: allowBackup=false, usesCleartextTraffic=false

---

### Scripts

#### `scripts/adb-enroll.sh` (41 lines)
- Idempotent Device Owner activation
- Checks for preinstalled Google account (blocks set-device-owner)
- Grants READ_PHONE_STATE and POST_NOTIFICATIONS runtime perms
- Validates Device Owner status

---

## Code Patterns & Conventions

### Logging
- `FluxionMain` — MainActivity + MainViewModel
- `FluxionCheckin` — CheckinWorker
- `FluxionCommand` — CommandExecutor
- `FluxionApp` — DpcApp
- `FluxionFcm` — FluxionFcmService

### Error Handling
- `try/catch` with Result type (WorkManager)
- Self-healing on 401 (clear storage) and 5xx (retry)
- Log at warning level for expected failures, stack trace for unexpected

### Encryption
- AES256-GCM via AndroidKeyStore
- EncryptedSharedPreferences wrapping with automatic key rotation

### Compose
- Jetpack Compose with Material3
- Reusable components in DpcComponents.kt
- Theme-aware styling via FluxionTheme

### Networking
- Retrofit with Moshi JSON serialization
- Bearer token auth + X-Internal-API-Key for enroll
- Custom User-Agent + version header

---

## Known Limitations & TODOs

| Issue | Workaround | Post-MVP |
|-------|-----------|----------|
| Emulator IMEI fallback (ANDROID_ID) | Operator pre-uploads derived value | Carrier-privileged path on real devices |
| DPC_INTERNAL_API_KEY in BuildConfig | Acceptable for demo | Play Integrity attestation |
| Re-enroll on 401 requires manual app reopen | User re-opens; operator re-dispatches REGISTER | Auto-recovery trigger |
| No periodic fallback if FCM dropped | Accepted trade-off for event-driven | Monitor FCM metrics |

---

## Dependency Graph

```
MainActivity
  ├── MainViewModel → SecureStorage, ApiClient, FirebaseMessaging, CheckinWorker
  ├── DpcApp → DevicePolicyManager (allowlist)
  ├── WorkManager → CheckinWorker
  ├── DeviceStateEvents (flow)
  └── UI Screens (EulaScreen, EnrollingScreen, ActiveScreen, etc.)

CheckinWorker
  ├── SecureStorage
  ├── ApiClient → Retrofit + Moshi
  └── CommandExecutor → handlers

CommandExecutor
  ├── SecureStorage
  ├── LockedActivity
  ├── NotificationManager
  ├── Coil (icon fetch)
  └── DeviceStateEvents

FluxionFcmService
  └── CheckinWorker.enqueueImmediate()

LockedActivity
  ├── DevicePolicyManager
  └── NotificationManager
```

---

## Statistics

| Metric | Count |
|--------|-------|
| Kotlin source files | 18 |
| Total Kotlin LOC | ~1,800 |
| XML files (manifest, resources) | 8 |
| Gradle files | 1 |
| Scripts | 1 (adb-enroll.sh) |
| Test files | 0 (manual lifecycle test only) |
| External dependencies | 15+ (Compose, Retrofit, Moshi, Firebase, Coil, WorkManager, security-crypto) |

---

**Last Updated:** 2026-06-07 | **Version:** 0.3.0
