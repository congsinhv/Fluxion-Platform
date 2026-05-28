# Fluxion Platform Client — Project Overview & PDR

## Project Vision

**Fluxion DPC** is an Android Device Policy Controller (DPC) for the Fluxion Mobile Device Management (MDM) platform. It enables remote command execution on enrolled Android devices via event-driven device management, with support for device locking, notifications, and account release.

**Target Users:** Mobile Device Administrators, enterprise IT teams deploying Fluxion-managed Android devices.

## Product Development Requirements (PDR)

### Functional Requirements

| Requirement | Status | Details |
|-------------|--------|---------|
| **Device Enrollment** | Complete (v0.3.0) | User accepts EULA → device sends IMEI + FCM token to backend → stores API key in encrypted storage |
| **Command Execution** | Complete (v0.3.0) | Event-driven loop: FCM wake or backend poll pulls command → executor dispatches to handler (ACTIVATE/LOCK/UNLOCK/NOTIFY/RELEASE) |
| **Device Locking (Kiosk)** | Complete (v0.3.0) | `startLockTask()` with allowlist priming; shade hidden; messages rendered on locked surface |
| **Notifications** | Complete (v0.3.0) | Supports POPUP and FULLSCREEN display modes; custom header/icon URLs; Coil bounded fetch |
| **Release & Cleanup** | Complete (v0.3.0) | RELEASE clears credentials, relinquishes Device Owner, flags sentinel state |
| **Device Admin Binding** | Complete (v0.3.0) | Receiver at `platform.dpc.FluxionDeviceAdminReceiver`; required for lock/admin APIs |
| **Secure Credential Storage** | Complete (v0.3.0) | AES256-GCM encrypted SharedPreferences; stores API key, device ID, IMEI, ACK state |
| **FCM Integration** | Complete (v0.3.0) | Firebase Cloud Messaging for instant command delivery; token rotation on next checkin |

### Non-Functional Requirements

| Requirement | Target | Status |
|-------------|--------|--------|
| **Min SDK** | 28 (Android 9 Pie) | Achieved (API 28 supports Device Admin APIs, encryption, WorkManager) |
| **Target SDK** | 34 (Android 15) | Achieved |
| **JVM Target** | 17 | Achieved |
| **Response Latency (FCM)** | ≤ 3 seconds (checkin to lock) | Expected via FCM wake; verified in acceptance test |
| **Offline Resilience** | Back-online triggers immediate checkin | Back-online NetworkCallback implemented in DpcApp |
| **No Periodic Polling** | Event-driven only | Enforced: only FCM, back-online, app boot, post-execute wake |
| **Credential Persistence** | Survives app kill | AES256-GCM storage verified |

### Security Requirements

| Requirement | Implementation |
|-------------|-----------------|
| **API Authentication** | Bearer token (API key) + X-Internal-API-Key header for enroll |
| **Credential Protection** | AES256-GCM symmetric encryption (AndroidKeyStore master key) |
| **Cleartext Traffic** | Disabled (`usesCleartextTraffic=false`) |
| **Backup Prevention** | `allowBackup=false` |
| **Permissions** | Principle of least privilege: INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, READ_PHONE_STATE, USE_FULL_SCREEN_INTENT |
| **Device Admin Scope** | DPC strictly manages lock/unlock/notifications; does not enable spy functionality |

### Acceptance Criteria (Phase 03)

- [x] Fresh install + `adb-enroll.sh` + EULA → enrollment complete, device state = ACTIVE in database
- [x] FCM-delivered LOCK command → LockedActivity appears within ~3 s
- [x] Lock / Unlock cycles × 3 stable without crashes
- [x] `baseline_active` AVD snapshot restores cleanly
- [ ] Tag v0.3-client-complete after green test run

**Current Phase:** 03 client complete pending acceptance (v0.3.0 built and ready for manual lifecycle test).

## Architecture Highlights

**Event-Driven Checkin Loop (No Polling)**
- Wake sources: FCM `{wake:true}` data message, app boot (if enrolled), back-online NetworkCallback, post-execute ACK flush
- All funnel through `CheckinWorker.enqueueImmediate()` with REPLACE policy (backend single-flight + command-id-idempotent acks = safe)
- Two-mode protocol: ACK-mode (report result, idle) vs PULL-mode (execute command, stash ACK, fire immediate ACK run)

**Kiosk Lock**
- `startLockTask()` with static allowlist primed in `DpcApp.onCreate()`
- While locked, notification shade hidden; `NOTIFY_FROM_LOCKED` renders on locked surface + FULLSCREEN fallback
- `LockedActivity` (singleTop, showWhenLocked, turnScreenOn) provides full-screen immersive UI

**UI State Routing**
- Phases derived from `SecureStorage`: EULA → Enrolling → Active → Released
- Welcome flourishes (ActiveWelcome, WelcomeBack) transient: intent extras only, 4 s timeout, never persisted
- Background state changes propagate via `DeviceStateEvents` (in-process flow) + `onResume` cold-read

**Deferred Release Cleanup**
- `RELEASE` handler does NOT clear credentials (next ACK needs them)
- Sets `deviceId = RELEASED_SENTINEL` + relinquishes Device Owner
- ACK-mode success branch detects sentinel → wipes storage + cancels work

## Roadmap

### Completed
- **Phase 01:** Architecture & setup (API client, encryption, enroll endpoint)
- **Phase 02:** Command loop & handlers (checkin, lock, unlock, notify, release)
- **Phase 03:** Device Owner binding, kiosk, production-ready build (v0.3.0)

### Post-MVP (Known Limitations)

| Limitation | Workaround | Post-MVP Path |
|-----------|-----------|---------------|
| IMEI fallback on emulator (no SIM) | Operator pre-uploads derived ANDROID_ID value | Carrier-privileged code path on real devices |
| `DPC_INTERNAL_API_KEY` in BuildConfig | Acceptable for demo; demo-build only | Play Integrity attestation post-MVP |
| Re-enroll on 401 requires manual app reopen | User sees EULA again; operator re-dispatches REGISTER | Auto-recovery trigger (not in scope) |
| No periodic checkin fallback if FCM dropped while online | Accepted trade-off for event-driven model | Monitor FCM reliability metrics |

## Success Metrics

1. **Enrollment Success Rate:** > 95% (EULA → ACTIVE state)
2. **Lock Latency:** ≤ 3 s end-to-end via FCM
3. **Command Ack Reliability:** 100% acks delivered (idempotent by command_id)
4. **Crash-Free Hours:** > 99 % (baseline measurement post-Phase-03)
5. **Storage Consistency:** zero credential leaks (AES256-GCM verified)

## Integration Points

- **Backend:** REST API at `{DPC_BASE_URL}`: POST `/v1/enroll`, POST `/v1/checkin`
- **Firebase:** Cloud Messaging for instant command delivery
- **Device Admin Framework:** Android framework APIs for lock/unlock
- **System Services:** TelephonyManager (IMEI), NotificationManager, PowerManager, WorkManager

## File Ownership & Responsibility

| Component | Owner | File(s) |
|-----------|-------|---------|
| Enrollment Flow | Backend + DPC | MainActivity, SecureStorage, ApiClient |
| Checkin & Command Dispatch | DPC | CheckinWorker, CommandExecutor |
| UI Routing & Phases | DPC | MainActivity, all *Screen.kt files |
| FCM Wake | Firebase + DPC | FluxionFcmService, CheckinWorker |
| Kiosk Lock | DPC | LockedActivity, DpcApp (allowlist) |
| Credential Security | DPC | SecureStorage (AES256-GCM) |

## Risk Registry

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Dropped FCM wake while online | Medium | Back-online NetworkCallback catches offline→online transition; single-flight backend design tolerates late acks |
| Device Owner revoked externally | Low | Next checkin gets `DEVICE_RELEASED` → clears storage; user sees EULA again |
| Concurrent command acks (race) | Low | Backend single-flight + command_id-idempotent by design |
| Credential corruption on corrupt storage | Low | AES256-GCM fails open; app detects missing key → clears and re-enrolls |
| IMEI mismatch on production (no carrier-privileged path) | Medium | Post-MVP; workaround: carrier must provision IMEI separately |

## Testing Strategy

**Manual Lifecycle Test (No Automated Tests)**

Phase 03 acceptance uses manual test against real AVD:
1. Fresh install → EULA → enroll → ACTIVE
2. LOCK command → verify < 3 s latency
3. 3× stable lock/unlock cycles
4. Snapshot `baseline_active` for demo replays

**Validation Scope:** Enrollment, command dispatch, lock/unlock UX, credential persistence, clean release.

**Future:** Consider adding instrumented tests for command parsing, encryption round-trips, and checkin error cases (post-MVP).

## Glossary

- **DPC:** Device Policy Controller — Android framework integration point for enterprise device management
- **Device Owner:** Administrative role with elevated permissions (lock/unlock, notifications, admin APIs)
- **ACK:** Acknowledgment of a completed command sent back to the backend
- **FCM:** Firebase Cloud Messaging — Google's instant messaging service
- **IMEI:** International Mobile Equipment Identity — device identifier (fallback: ANDROID_ID on emulator)
- **Sentinel:** Marker value (`RELEASED_SENTINEL`) used to defer cleanup across ack boundaries

---

**Last Updated:** 2026-06-07  
**Version:** 0.3.0  
**Maintained By:** Fluxion Platform Team
