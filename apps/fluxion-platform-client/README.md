# Fluxion Platform Client — Android DPC

Android Device Policy Controller (DPC) for Fluxion MDM. **Kotlin + Jetpack Compose** | **minSdk 28** | **targetSdk 34** | **JVM 17** | **v0.3.0**

Event-driven command execution via Firebase Cloud Messaging (FCM) — NO periodic polling.

## Quick Start

**Documentation:** See `docs/` folder for full details:
- `docs/project-overview-pdr.md` — Project vision, requirements, success metrics
- `docs/system-architecture.md` — Architecture diagrams (Mermaid), checkin loop, handlers
- `docs/codebase-summary.md` — File-by-file inventory and patterns
- `docs/code-standards.md` — Kotlin conventions, error handling, testing
- `docs/deployment-guide.md` — Local setup, build, Device Owner activation, lifecycle test
- `docs/project-roadmap.md` — Phase 01–05 milestones, known limitations

**REST API Contract:** [`Artifacts/mdm-rest-api-dpc.html`](../../Artifacts/mdm-rest-api-dpc.html)

## Architecture Overview

```
EULA → POST /v1/enroll (IMEI + FCM token) → AES256-GCM encrypted storage
                                           ↓
                    ┌─────────────────────┴─────────────────────┐
                    │                                           │
            FCM {wake:true}                          Back-online / App boot
                    │                                           │
                    └─────────────────────┬─────────────────────┘
                                          ↓
                    CheckinWorker.enqueueImmediate() (REPLACE policy)
                                          ↓
                              POST /v1/checkin (ACK + pull)
                                          ↓
                              CommandExecutor (switch on action_type)
                                          ↓
                    ACTIVATE / LOCK / UNLOCK / NOTIFY* / RELEASE
```

## Source Layout

```
app/src/main/java/com/fluxion/client/
├── MainActivity.kt              # Phase routing (EULA/Enrolling/Active/Released)
├── DpcApp.kt                    # Application class, lock-task allowlist
├── data/
│   ├── ApiClient.kt             # Retrofit + Moshi + auth
│   ├── SecureStorage.kt         # AES256-GCM encrypted SharedPreferences
│   ├── Dtos.kt                  # Request/response models (snake_case JSON)
│   └── DeviceStateEvents.kt     # In-process state flow
├── work/
│   └── CheckinWorker.kt         # Event-driven loop (ACK vs PULL modes)
├── fcm/
│   └── FluxionFcmService.kt     # FCM wake → enqueueImmediate()
├── command/
│   └── CommandExecutor.kt       # 7 handlers (switch on action_type)
├── ui/
│   ├── EulaScreen.kt, EnrollingScreen.kt, ActiveScreen.kt, ReleasedScreen.kt
│   ├── ActiveWelcomeScreen.kt, WelcomeBackScreen.kt (transient, 4s timeout)
│   ├── LockedActivity.kt        # Kiosk lock (singleTop, startLockTask)
│   ├── DpcComponents.kt         # Shared Compose components
│   └── theme/                   # Material3 theming
└── platform/dpc/
    └── FluxionDeviceAdminReceiver.kt  # Device Admin receiver stub
```

## Local Setup (5 min)

**Prerequisites:** Android Studio 2024.1+, Java 17, Android SDK API 34, `local.properties` config.

```bash
# 1. Clone & navigate
git clone https://github.com/your-org/Fluxion-Platform.git
cd Fluxion-Platform/apps/fluxion-platform-client

# 2. Config
cp local.properties.example local.properties
# Edit: sdk.dir, DPC_BASE_URL, DPC_INTERNAL_API_KEY

# 3. Firebase (REQUIRED — FCM wake is core; build is non-functional without it)
# Download google-services.json (package com.fluxion.client) from Firebase Console,
# place at app/google-services.json (gitignored)

# 4. Build
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

**See `docs/deployment-guide.md` for detailed setup, emulator config, and troubleshooting.**

## Device Owner Setup

```bash
./scripts/adb-enroll.sh
# Sets Device Owner, grants READ_PHONE_STATE + POST_NOTIFICATIONS
```

**Critical:** Use **Google APIs** emulator image (not Google Play, not AOSP). Google Play blocks Device Owner; AOSP has no FCM.

To revoke: `adb shell dpm remove-active-admin com.fluxion.client/.platform.dpc.FluxionDeviceAdminReceiver`

## Manual Lifecycle Test

**IMEI Fallback (Emulator Only):**

Emulator has no real SIM; app derives 15-digit IMEI from `ANDROID_ID`:
```bash
adb shell settings get secure android_id
# e.g., b3a2c1d8e7f6a5b4 → "123456789012345" (digits, pad/trim to 15)

python3 -c "import sys,re; s=sys.argv[1]; d=re.sub(r'[^0-9]','',s); print((d.rjust(15,'0'))[:15])" b3a2c1d8e7f6a5b4
```

Pre-register in backend: `uploadImei(imei: "123456789012345")`

**Test Sequence:**

1. Backend: `dispatchAction(REGISTER)`
2. App: Accept EULA → enrolls
3. Backend: `dispatchAction(ACTIVATE)`
4. App: ACTIVE state + welcome notification (logcat: `FluxionMain`, `FluxionCheckin`)
5. Backend: `dispatchAction(LOCK)`
6. App: LockedActivity within ≤ 3 s (logcat: `FluxionCommand`)
7. Backend: `dispatchAction(UNLOCK)`
8. App: Kiosk dismissed, WelcomeBack flourish
9. Repeat lock/unlock 3× (all stable)
10. Backend: `dispatchAction(RELEASE_FROM_ACTIVE)`
11. App: ReleasedScreen, credentials cleared
12. Snapshot: Android Studio Emulator → Snapshots → "Take snapshot" → name `baseline_active`

**Verification:**
```bash
adb logcat -e "FluxionMain|FluxionCheckin|FluxionCommand" > /tmp/test.log
# Review: expect EULA → enroll → ACTIVATE → LOCK → UNLOCK → RELEASE sequence
```

## Known Limitations (Phase 03)

| Limitation | Workaround | Post-MVP |
|-----------|-----------|----------|
| IMEI fallback (emulator only) | Operator pre-uploads derived ANDROID_ID | Q4: Carrier-privileged path |
| DPC_INTERNAL_API_KEY in BuildConfig | Demo build acceptable | Q4: Play Integrity attestation |
| Re-enroll on 401 requires manual reopen | User sees EULA; operator re-dispatches REGISTER | Phase 04: Auto-recovery |

## Phase 03 Acceptance Criteria

- [ ] Fresh enroll → ACTIVE state in database
- [ ] LOCK appears within ~3 s via FCM
- [ ] 3× lock/unlock cycles stable
- [ ] baseline_active snapshot restores cleanly
- [ ] Tag `v0.3-client-complete` after green run

## Documentation

- **Full Setup Guide:** `docs/deployment-guide.md`
- **System Architecture:** `docs/system-architecture.md` (Mermaid diagrams)
- **Code Standards:** `docs/code-standards.md`
- **Roadmap:** `docs/project-roadmap.md` (Phase 01–05)
