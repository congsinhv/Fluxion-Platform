# Deployment Guide — Fluxion DPC Client

**Version:** 0.3.0 | **Target:** Android 9+ (minSdk 28) | **Tested:** Pixel 6 API 34 Google APIs

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [One-Time Local Setup](#one-time-local-setup)
3. [Build & Install](#build--install)
4. [Device Owner Activation](#device-owner-activation)
5. [Manual Lifecycle Test](#manual-lifecycle-test)
6. [Troubleshooting](#troubleshooting)
7. [Production Rollout (Future)](#production-rollout-future)

---

## Prerequisites

### Development Machine
- **Android Studio:** 2024.1 or later (Arctic Fox+)
- **Java:** OpenJDK 17+ (jvm target)
- **Gradle:** 8.7+ (installed via Android Studio or `gradle wrapper --gradle-version 8.7`)
- **Android SDK:** API 34 + build tools 34.0.0+
- **Git:** Latest (for version control, tags)

### Android Device / Emulator
- **API Level:** 34 (Android 15) recommended; tested on Pixel 6 API 34
- **System Image:** **Google APIs** (required for FCM; NOT Google Play, NOT AOSP)
  - Google Play image: Preinstalled account blocks `set-device-owner` (blocks enrollment)
  - AOSP image: No FCM support
  - Download via Android Studio AVD Manager: `system-images;android-34;google_apis;arm64-v8a` (Apple Silicon)
- **Storage:** ≥ 2 GB free
- **RAM:** ≥ 4 GB (emulator)

### Backend Configuration
- **API Endpoint:** Deployed DPC API Gateway (e.g., `https://abc123.execute-api.ap-southeast-1.amazonaws.com`)
- **Internal API Key:** X-Internal-API-Key value from Lambda configuration
- **Device Pre-Registration:** IMEI uploaded to backend (or derivable via `uploadImei` GraphQL mutation)

---

## One-Time Local Setup

### 1. Clone Repository & Navigate

```bash
git clone https://github.com/your-org/Fluxion-Platform.git
cd Fluxion-Platform/apps/fluxion-platform-client
```

### 2. Create Local Configuration File

Copy the example template:
```bash
cp local.properties.example local.properties
```

Edit `local.properties`:
```properties
sdk.dir=/path/to/Android/sdk
DPC_BASE_URL=https://abc123.execute-api.ap-southeast-1.amazonaws.com
DPC_INTERNAL_API_KEY=your-internal-api-key-value
```

**Where to find values:**
- `sdk.dir` — Android Studio SDK path (typically `~/Library/Android/sdk` on macOS, `~\AppData\Local\Android\Sdk` on Windows)
- `DPC_BASE_URL` — CDK stack output or CloudFormation console (API Gateway HTTP endpoint)
- `DPC_INTERNAL_API_KEY` — Lambda environment variable or Secrets Manager (ask backend team)

### 3. Firebase Configuration (Optional but Recommended)

Obtain the Firebase config file for package `com.fluxion.client`:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Add an Android app (package: `com.fluxion.client`)
4. Download `google-services.json`
5. Place at `app/google-services.json` (git-ignored)

**Note:** If missing, the app uses a fallback stub (`google-services-debug.json`), but FCM will not function on real devices. For emulators, you can proceed without it for initial testing.

### 4. Set Up Android Studio (Optional)

```bash
# Open project in Android Studio
open -a "Android Studio" .
```

Android Studio auto-syncs Gradle and generates the wrapper. Alternatively, manually:

```bash
gradle wrapper --gradle-version 8.7
```

### 5. Verify Android SDK

```bash
# Check API 34 and emulator image are installed
$ANDROID_HOME/emulator/emulator -list-avds

# If none, create via Android Studio AVD Manager or:
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "system-images;android-34;google_apis;arm64-v8a"
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n "Pixel6-API34" \
  -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_6
```

---

## Build & Install

### 1. Start Emulator (or Connect Device)

**Emulator:**
```bash
# Start AVD (background)
$ANDROID_HOME/emulator/emulator -avd Pixel6-API34 &

# Wait for boot (check with adb devices)
adb wait-for-device
adb devices
```

**Physical Device:**
- Enable USB Debugging (Settings → Developer Options → USB Debugging)
- Connect via USB
- Authorize on device

### 2. Build & Install App

```bash
# Build debug APK
./gradlew :app:assembleDebug

# Install to device/emulator
./gradlew :app:installDebug
```

**Expected Output:**
```
BUILD SUCCESSFUL in 45s
```

**Verify Installation:**
```bash
adb shell pm list packages | grep com.fluxion.client
# Output: package:com.fluxion.client
```

### 3. Check Logcat for Errors

```bash
adb logcat | grep -E "FluxionMain|FluxionApp|ERROR|Exception"
```

Expected (no errors yet):
```
FluxionApp: DpcApp.onCreate() called
```

---

## Device Owner Activation

### 1. Prerequisites for set-device-owner

**Critical:** The device must have NO preinstalled Google account (blocks Device Owner setup).

**Check Current Accounts:**
```bash
adb shell dumpsys account | grep "Accounts:"
# Should show: Accounts: 0
```

If accounts > 0 on emulator:
- **Option A:** Wipe AVD and recreate fresh (Google APIs image, not Google Play)
  ```bash
  avdmanager delete avd -n Pixel6-API34
  # Then recreate as above
  ```
- **Option B:** Manually remove: Settings → Accounts → remove Google account

### 2. Run Enrollment Script

```bash
./scripts/adb-enroll.sh
```

**Expected Output:**
```
==> Checking adb device
List of attached devices
emulator-5554          device

==> Checking for preinstalled Google account (must be empty for set-device-owner)
Accounts: 0

==> Setting com.fluxion.client as Device Owner
com.fluxion.client/.platform.dpc.FluxionDeviceAdminReceiver set as active admin
Success: Device owner set to package com.fluxion.client

==> Verifying
Device Owner: com.fluxion.client
  Device Owner: com.fluxion.client

==> Granting runtime permissions
  READ_PHONE_STATE: Granted
  POST_NOTIFICATIONS: Granted

Done. Launch the DPC app and accept the EULA.
```

**Verify Device Owner Status:**
```bash
adb shell dumpsys device_policy | grep -A2 "Device Owner"
```

### 3. Troubleshooting Device Owner Setup

| Issue | Cause | Fix |
|-------|-------|-----|
| `Error: Device owner can only be set on an unprovisioned device` | Preinstalled Google account | Wipe AVD or remove account manually |
| `Error: dpm not found` | adb not on PATH | Add `$ANDROID_HOME/platform-tools` to PATH |
| `Error: Device emulator-5554 not found` | Emulator not running | Start AVD: `emulator -avd Pixel6-API34 &` |
| `Permission denied` | adb socket issue | Restart adb: `adb kill-server && adb devices` |

---

## Manual Lifecycle Test

### Phase 1: Prepare Backend

1. **Derive Emulator IMEI** from ANDROID_ID (if using IMEI fallback):
   ```bash
   adb shell settings get secure android_id
   # Example output: b3a2c1d8e7f6a5b4
   
   # Convert to 15-digit IMEI (Python):
   python3 -c "import sys,re; s=sys.argv[1]; d=re.sub(r'[^0-9]','',s); print((d.rjust(15,'0'))[:15])" b3a2c1d8e7f6a5b4
   # Output: 123456789012345
   ```

2. **Pre-Register Device** (if not auto-uploading):
   ```graphql
   mutation {
     uploadImei(imei: "123456789012345")
   }
   ```

3. **Dispatch REGISTER Action:**
   ```graphql
   mutation {
     dispatchAction(deviceId: "device-123", actionType: "REGISTER")
   }
   ```

### Phase 2: Enroll & Activate

1. **Clear Previous State** (if retesting):
   ```bash
   adb shell pm clear com.fluxion.client
   ```

2. **Launch App:**
   ```bash
   adb shell am start -n com.fluxion.client/.MainActivity
   ```

3. **Accept EULA:**
   - App displays EULA screen
   - Tap "Accept"
   - Watch logcat:
     ```bash
     adb logcat -e "FluxionMain" &
     ```
   - Expected: `Enroll POST request...` → `Enroll success, device_id=...`

4. **Verify Enrolled State:**
   - App shows "Enrolling..." spinner (briefly)
   - Database updates to REGISTERED state
   - Backend dispatches ACTIVATE automatically (or manually):
     ```graphql
     mutation {
       dispatchAction(deviceId: "device-id", actionType: "ACTIVATE")
     }
     ```

5. **Verify ACTIVE State:**
   - App receives ACTIVATE command via FCM
   - Shows welcome notification
   - Transitions to ActiveWelcomeScreen (4 s animation)
   - Settles to ActiveScreen with last template
   - Database state = ACTIVE

### Phase 3: Lock Test

1. **Dispatch LOCK:**
   ```graphql
   mutation {
     dispatchAction(deviceId: "device-id", actionType: "LOCK")
   }
   ```

2. **Verify Lock Appearance:**
   - Watch logcat:
     ```bash
     adb logcat -e "FluxionCommand" &
     ```
   - Expected: `Execute command_id=... action=LOCK`
   - LockedActivity appears within **≤ 3 seconds** (FCM → checkin → handler)
   - Screen is full-screen immersive (no notification shade)
   - Device is unresponsive to Home/Back/Recents buttons

3. **Note Timestamp** for latency verification

### Phase 4: Unlock & Cycle

1. **Dispatch UNLOCK:**
   ```graphql
   mutation {
     dispatchAction(deviceId: "device-id", actionType: "UNLOCK")
   }
   ```

2. **Verify Unlock:**
   - LockedActivity dismissed
   - App shows WelcomeBackScreen (transient, 4 s)
   - Settles to ActiveScreen
   - Device is responsive again

3. **Repeat Lock/Unlock 3× Cycles:**
   - All cycles must be stable (no crashes, no ANRs)
   - Latencies consistent (≤ 3 s)

### Phase 5: Release

1. **Dispatch RELEASE:**
   ```graphql
   mutation {
     dispatchAction(deviceId: "device-id", actionType: "RELEASE_FROM_ACTIVE")
   }
   ```

2. **Verify Release:**
   - Command executes
   - Device Owner status revoked (verify: `adb shell dumpsys device_policy | grep "Device Owner"` → should show none or different package)
   - App transitions to ReleasedScreen
   - Ack flushed (logcat: `Release ack flushed`)
   - SecureStorage cleared (no more api_key, device_id)

### Phase 6: Verify Snapshot

1. **Create Snapshot** (after ACTIVE state, before RELEASE):
   - Android Studio Emulator → Snapshots → "Take Snapshot"
   - Name: `baseline_active`

2. **Restore Snapshot:**
   - Close emulator
   - Emulator → Snapshots → select `baseline_active` → Load
   - App re-launches to ActiveScreen (persisted state)
   - App is still enrolled (api_key exists)

### Logcat Audit

Monitor all phases with:
```bash
adb logcat -v threadtime > /tmp/fluxion-lifecycle-test.log &
# Run test above
# Stop: Ctrl+C
# Review: less /tmp/fluxion-lifecycle-test.log
```

**Expected Sequence:**
```
FluxionMain: MainActivity.onCreate()
FluxionMain: startEnroll() → POST /v1/enroll
FluxionApp: DpcApp.onCreate() → set allowlist
FluxionCheckin: CheckinWorker.doWork() PULL-mode → POST /v1/checkin
FluxionCommand: Execute command_id=... action=ACTIVATE
FluxionCommand: persistActivePhase() + launchWelcome()
FluxionCommand: Execute command_id=... action=LOCK
FluxionCommand: LockedActivity.start()
FluxionCommand: Execute command_id=... action=UNLOCK
FluxionCommand: LockedActivity.dismiss()
FluxionCommand: Execute command_id=... action=RELEASE_FROM_ACTIVE
FluxionCommand: clearDeviceOwnerApp() (relinquish)
FluxionCommand: deviceId = RELEASED_SENTINEL
FluxionCheckin: Ack-mode: release ack flushed → clearing credentials
FluxionMain: (cold reopen lands on ReleasedScreen or EULA if storage cleared)
```

---

## Troubleshooting

### App Crashes on Launch

**Symptom:** App force-closes immediately after install.

**Diagnosis:**
```bash
adb logcat -e "Exception|ERROR" | head -20
```

**Common Causes:**

1. **Missing `google-services.json`:**
   - Create fallback: `touch app/google-services-debug.json`
   - Content (minimal):
     ```json
     {}
     ```
   - Rebuild: `./gradlew :app:installDebug`

2. **Invalid `local.properties`:**
   - Check format: `sdk.dir`, `DPC_BASE_URL`, `DPC_INTERNAL_API_KEY`
   - Verify no trailing spaces
   - Rebuild: `./gradlew clean :app:assembleDebug`

3. **Gradle sync failure:**
   - Clear Gradle cache: `rm -rf ~/.gradle`
   - Resync: `./gradlew sync`

### Enroll Fails (HTTP 401/403/404)

**Symptom:** POST /v1/enroll returns error; EULA shows "Error" state.

**Diagnosis:**
```bash
adb logcat -e "FluxionMain" | grep -i error
```

**Common Causes:**

1. **401 INVALID_API_KEY:**
   - Check `DPC_INTERNAL_API_KEY` in `local.properties`
   - Verify against backend Lambda environment variable
   - Rebuild with correct value: `./gradlew :app:installDebug`

2. **403 DEVICE_RELEASED:**
   - Device already enrolled and released
   - Backend state is RELEASED or unknown
   - Reset: Clear app data and backend record
   ```bash
   adb shell pm clear com.fluxion.client
   # Delete backend device record or set state = REGISTERED
   ```

3. **404 NOT_FOUND (IMEI not registered):**
   - Backend has no matching IMEI
   - Pre-register via `uploadImei` GraphQL mutation:
     ```graphql
     mutation {
       uploadImei(imei: "123456789012345")
     }
     ```

### Lock Doesn't Appear (or Appears Slowly)

**Symptom:** LOCK command dispatched; lock screen takes > 3 s or doesn't appear.

**Diagnosis:**
```bash
# Check FCM connectivity
adb shell am get-inactive-user

# Monitor latency
adb logcat -e "FluxionCommand" | grep "Execute.*LOCK"
adb logcat -e "FluxionCheckin" | grep "POST.*checkin"
adb shell getprop debug.atrace.tags.enableflags
```

**Common Causes:**

1. **FCM Not Connected:**
   - Emulator: Ensure Google APIs image (not AOSP/Google Play)
   - Check: `adb shell getprop ro.kernel.android.checkjni`
   - Recovery: Wipe AVD, recreate from Google APIs image

2. **Slow Network:**
   - Emulator network latency (DNS/WiFi)
   - Increase timeout: Not configurable (fixed 15 s connect, 30 s read in ApiClient.kt)
   - Recovery: Verify backend latency with `curl -w "@/tmp/curl-format.txt" <URL>`

3. **Missing Device Owner:**
   - LockedActivity requires Device Owner to call `startLockTask()`
   - If no DO: Activity starts but lock task fails silently
   - Recovery: Run `./scripts/adb-enroll.sh` again

### Release Doesn't Clear Credentials

**Symptom:** After RELEASE, SecureStorage still contains api_key.

**Diagnosis:**
```bash
# Check storage (requires root or test APK)
adb shell su -c "sqlite3 /data/data/com.fluxion.client/shared_prefs/fluxion_secure.xml"
# or
adb shell cat /data/data/com.fluxion.client/shared_prefs/fluxion_secure.xml
```

**Common Causes:**

1. **ACK Not Flushed:**
   - RELEASE command executes, sets RELEASED_SENTINEL
   - But ACK-mode run crashes before clearing
   - Check logcat: `FluxionCheckin: release ack flushed`
   - Recovery: Restart app to trigger cold-start cold-read (should see ReleasedScreen)

2. **Storage Corruption:**
   - Decryption fails on next read
   - Check: `FluxionMain: SecureStorage read failed`
   - Recovery: Clear app data: `adb shell pm clear com.fluxion.client`

### Snapshot Restore Fails

**Symptom:** `baseline_active` snapshot doesn't restore; app shows black screen or crashes.

**Diagnosis:**
- Check AVD storage (insufficient space)
- Check snapshot file integrity: `ls -lh ~/.android/avd/Pixel6-API34/snapshots/`

**Recovery:**
- Delete snapshot: `avdmanager delete-snapshot -n Pixel6-API34 -s baseline_active`
- Recreate: Run lifecycle test again to ACTIVE state, take snapshot

---

## Production Rollout (Future)

### Phase 1: Staging Environment

1. **Backend Staging:** Deploy API to staging endpoint
2. **Test Fleet:** 10–50 real devices (mix of OEMs, Android versions 9–15)
3. **Manual Test:** Full lifecycle on each device, capture metrics (latency, crash-free hours)
4. **Approval:** Security review, legal review (Device Owner implications)

### Phase 2: Phased Rollout

1. **Early Adopter Cohort:** 5–10 organizations, 100–500 devices
2. **Monitor:** Crash rates, enrollment success, lock latency, credential security
3. **Gradual Expansion:** 20%, 50%, 100% rollout over weeks

### Phase 3: Production Support

1. **OEM Compatibility:** Test on Samsung, Google, OnePlus, etc.
2. **Fallback Handling:** If Device Owner revocation breaks, provide re-enrollment path
3. **Metrics Dashboard:** FCM reliability, command latency, crash-free rate
4. **Carrier IMEI:** Partner with carriers for production IMEI path (post-MVP)

---

## Quick Reference

### Common Commands

| Task | Command |
|------|---------|
| Start emulator | `$ANDROID_HOME/emulator/emulator -avd Pixel6-API34 &` |
| List connected devices | `adb devices` |
| Build debug APK | `./gradlew :app:assembleDebug` |
| Install app | `./gradlew :app:installDebug` |
| View logs | `adb logcat \| grep FluxionMain` |
| Clear app data | `adb shell pm clear com.fluxion.client` |
| Revoke Device Owner | `adb shell dpm remove-active-admin com.fluxion.client/.platform.dpc.FluxionDeviceAdminReceiver` |
| Uninstall app | `adb uninstall com.fluxion.client` |
| Get IMEI (emulator) | `adb shell settings get secure android_id` |
| Take snapshot | (Android Studio Emulator UI) → Snapshots → Take Snapshot |

### Environment Variables

```bash
# Add to ~/.zshrc or ~/.bashrc for convenience
export ANDROID_HOME="$HOME/Library/Android/sdk"  # macOS
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export JAVA_HOME="/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home"  # macOS
```

### Project Structure Quick Lookup

| Component | File |
|-----------|------|
| Main entry point | `app/src/main/java/com/fluxion/client/MainActivity.kt` |
| Checkin loop | `app/src/main/java/com/fluxion/client/work/CheckinWorker.kt` |
| Command handlers | `app/src/main/java/com/fluxion/client/command/CommandExecutor.kt` |
| Encryption | `app/src/main/java/com/fluxion/client/data/SecureStorage.kt` |
| API client | `app/src/main/java/com/fluxion/client/data/ApiClient.kt` |
| Lock activity | `app/src/main/java/com/fluxion/client/ui/LockedActivity.kt` |
| Device Admin | `app/src/main/java/com/fluxion/client/platform/dpc/FluxionDeviceAdminReceiver.kt` |
| Enrollment script | `scripts/adb-enroll.sh` |

---

## Support & Escalation

| Issue | Contact | Expected Response |
|-------|---------|-------------------|
| Build failures | DevOps / CI/CD team | Fix gradle/SDK issues within 24 h |
| API authentication errors | Backend team | Provide correct DPC_BASE_URL + DPC_INTERNAL_API_KEY |
| Device Owner setup blocked | Android team | Troubleshoot account removal, system image selection |
| Emulator performance issues | Infrastructure team | Allocate more RAM/CPU or use physical device |
| Production incident (high crash rate) | Incident commander | Page on-call, investigate within 30 min |

---

**Last Updated:** 2026-06-07 | **Version:** 0.3.0  
**Maintained By:** Fluxion Platform Team  
**Test Frequency:** Manual lifecycle test per release; automated post v0.4
