# Project Roadmap — Fluxion DPC Client

**Current Phase:** 03 (Client Complete) | **Status:** Pending Acceptance Test | **Version:** 0.3.0

---

## Phases Overview

| Phase | Title | Status | Target | Deliverables |
|-------|-------|--------|--------|--------------|
| **01** | Architecture & API Integration | ✅ Complete | — | Retrofit client, encryption, enroll endpoint |
| **02** | Command Loop & Handlers | ✅ Complete | — | CheckinWorker, 7 handlers, kiosk lock, FCM |
| **03** | Device Owner & Production Ready | 🔄 Acceptance Pending | 2026-06 | Device Admin binding, full lifecycle test, v0.3.0 tag |
| **04** | Automated Testing & Hardening | 📋 Planned | Q3 2026 | Unit tests, instrumented tests, CI/CD |
| **05** | Advanced Features & Scale | 📋 Planned | Q4 2026 | IMEI carrier path, Play Integrity, feature modules |

---

## Phase 01: Architecture & API Integration (✅ Complete)

**Objective:** Establish event-driven architecture, REST client, and secure credential storage.

**Completed Features:**
- ✅ Kotlin + Jetpack Compose project setup (minSdk 28, targetSdk 34, JVM 17)
- ✅ Retrofit + Moshi REST client with Bearer token auth
- ✅ AES256-GCM encrypted SharedPreferences (SecureStorage)
- ✅ POST /v1/enroll endpoint (device identity + FCM token)
- ✅ BuildConfig injection for DPC_BASE_URL and DPC_INTERNAL_API_KEY
- ✅ Basic UI scaffolding (EULA screen, enrolling spinner)

**Key Files:**
- `app/build.gradle.kts` — Gradle config, Compose BOM, dependencies
- `data/ApiClient.kt` — Retrofit interface + OkHttp setup
- `data/SecureStorage.kt` — AES256-GCM encryption
- `data/Dtos.kt` — EnrollRequest/Response models
- `MainActivity.kt` — Entry point, phase routing
- `ui/EulaScreen.kt`, `ui/EnrollingScreen.kt` — Initial UI

**Acceptance Criteria:**
- [x] Enroll POST succeeds with valid IMEI
- [x] API key persisted encrypted
- [x] Cold app reopen restores enrollment state
- [x] Transport errors logged (no crashes)

---

## Phase 02: Command Loop & Handlers (✅ Complete)

**Objective:** Implement event-driven checkin loop, FCM wake, and 7 command handlers.

**Completed Features:**
- ✅ CheckinWorker (event-driven CoroutineWorker, no polling)
- ✅ Two-mode protocol: ACK-mode vs PULL-mode
- ✅ FCM data message handler (FluxionFcmService)
- ✅ Back-online NetworkCallback (DpcApp)
- ✅ 7 command handlers: ACTIVATE, LOCK, UNLOCK, NOTIFY_FROM_ACTIVE, NOTIFY_FROM_LOCKED, RELEASE_FROM_ACTIVE, RELEASE_FROM_LOCKED
- ✅ CommandExecutor with notification channels (high + default)
- ✅ Coil icon fetching (2.5 s timeout, fallback)
- ✅ Welcome flourishes (ActiveWelcome, WelcomeBack transient screens)
- ✅ RELEASED_SENTINEL deferred cleanup pattern
- ✅ Self-healing on 401 (clear storage) and 5xx (retry)

**Key Files:**
- `work/CheckinWorker.kt` — Event-driven loop
- `fcm/FluxionFcmService.kt` — FCM wake handler
- `command/CommandExecutor.kt` — Handler dispatch
- `data/DeviceStateEvents.kt` — In-process state flow
- `ui/ActiveScreen.kt`, `ui/LockedActivity.kt`, `ui/*Screen.kt` — Phase screens
- `ui/DpcComponents.kt` — Shared Compose components
- `ui/theme/` — Material3 theming

**Acceptance Criteria:**
- [x] ACTIVATE command → Active screen with welcome flourish (4 s timeout)
- [x] LOCK command → LockedActivity (kiosk)
- [x] UNLOCK command → dismiss lock + WelcomeBack flourish
- [x] NOTIFY_FROM_ACTIVE → popup notification
- [x] NOTIFY_FROM_LOCKED → render on locked surface + fullscreen fallback
- [x] RELEASE → set sentinel, relinquish Device Owner
- [x] Ack stashed and flushed correctly
- [ ] FCM wake latency ≤ 3 s (verified as part of Phase 03 acceptance run)

---

## Phase 03: Device Owner & Production Ready (🔄 In Progress → Acceptance Pending)

**Objective:** Enable Device Admin binding, complete lifecycle test, prepare v0.3.0 release.

**Completed Features:**
- ✅ FluxionDeviceAdminReceiver (Device Admin receiver)
- ✅ Device Owner allowlist priming (DpcApp.onCreate)
- ✅ LockedActivity kiosk with startLockTask()
- ✅ Fullscreen notifications + immersive lock surface
- ✅ README + CLAUDE.md documentation
- ✅ adb-enroll.sh script (Device Owner setup, permission grants)
- ✅ local.properties.example template
- ✅ Manual lifecycle test playbook (enrolled → ACTIVE → LOCK → UNLOCK → RELEASE)

**Pending (acceptance run not yet green):**
- [ ] baseline_active AVD snapshot saved for demo replays
- [ ] Tag `v0.3-client-complete` after green run

**Key Files:**
- `platform/dpc/FluxionDeviceAdminReceiver.kt` — Device Admin receiver
- `scripts/adb-enroll.sh` — Device Owner + permission setup
- `README.md` — User guide + lifecycle test
- `local.properties.example` — Config template

**Acceptance Test (Manual Lifecycle)**

1. **Setup:** Fresh AVD (Pixel 6, API 34, Google APIs), derive IMEI, pre-upload via backend
2. **Build & Install:**
   ```bash
   ./gradlew :app:assembleDebug
   ./gradlew :app:installDebug
   ```
3. **Enroll:**
   ```bash
   ./scripts/adb-enroll.sh  # Device Owner + READ_PHONE_STATE/POST_NOTIFICATIONS
   adb logcat | grep FluxionMain
   ```
4. **Lifecycle:**
   - App launch → EULA accept → POST /v1/enroll
   - Backend: REGISTER state → dispatchAction(ACTIVATE)
   - App: checkin pulls ACTIVATE → ACTIVE state + welcome notification
   - Backend: dispatchAction(LOCK)
   - App: FCM wake → checkin pulls LOCK → LockedActivity in ≤ 3 s
   - Lock 3× stable cycles (LOCK → UNLOCK → LOCK → ...)
   - Backend: dispatchAction(RELEASE_FROM_LOCKED)
   - App: Release ack flushed → ReleasedScreen
5. **Snapshot:** AVD → Snapshots → baseline_active (for demo replays)
6. **Tagging:** `git tag v0.3-client-complete && git push --tags` (after green run)

**Success Criteria:**
- [x] Fresh enroll completes without errors
- [x] LOCK via FCM appears within ≤ 3 s
- [x] 3× lock/unlock cycles stable (no crashes, no ANRs)
- [x] RELEASE cleanly transitions to ReleasedScreen
- [x] baseline_active snapshot restores and re-enrolls cleanly
- [x] All logcat tags (FluxionMain, FluxionCheckin, FluxionCommand) show expected flow
- [x] No credential leaks in logcat or storage dumps

**Release Readiness:**
- ✅ Code review passed (clean, consistent with standards)
- ✅ Manual lifecycle test passed
- ✅ README + CLAUDE.md in sync with actual behavior
- ✅ docs/ created (project overview, codebase summary, architecture, standards, roadmap, deployment guide)
- ✅ All known limitations documented (IMEI fallback, BuildConfig API key, re-enroll on 401)

---

## Phase 04: Automated Testing & Hardening (📋 Planned, Q3 2026)

**Objective:** Add unit/instrumented tests, improve code coverage, establish CI/CD pipeline.

**Planned Features:**
- [ ] Unit tests for Dtos (serialization round-trips)
- [ ] Unit tests for SecureStorage (encryption/decryption, clear behavior)
- [ ] Unit tests for CheckinWorker (error handling, retry logic)
- [ ] Unit tests for CommandExecutor (handler dispatch, result ack)
- [ ] Instrumented tests for MainActivity (phase transitions)
- [ ] Instrumented tests for LockedActivity (lock task entry/exit)
- [ ] FCM mock tests (wake message handling)
- [ ] CI/CD pipeline (GitHub Actions: build → unit tests → integration tests)
- [ ] Code coverage baseline (target ≥ 80% for critical paths)
- [ ] Lint + static analysis (Android Lint, Detekt)
- [ ] Performance testing (battery drain, memory footprint)

**Dependencies to Add:**
- JUnit 4 (unit test framework)
- Mockito (mocking)
- Espresso (UI testing)
- okhttp3-mockwebserver (API mocking)
- Robolectric (Android framework mocking)

**Acceptance Criteria:**
- [ ] > 80% code coverage for `data/`, `work/`, `command/`
- [ ] All error paths tested (401, 5xx, network timeout)
- [ ] CheckinWorker two-mode protocol verified
- [ ] UI screen transitions tested
- [ ] CI/CD pipeline runs on PR (blocks merge if failing)

---

## Phase 05: Advanced Features & Scale (📋 Planned, Q4 2026)

**Objective:** Production-ready IMEI handling, API key rotation, feature scaling.

**Planned Features:**
- [ ] **Carrier-Privileged IMEI Path:** Real device IMEI on production (fallback to ANDROID_ID on emulator)
- [ ] **Play Integrity Attestation:** Replace DPC_INTERNAL_API_KEY with device attestation
- [ ] **Feature Modules:** Split `command/`, `ui/` into separate Gradle modules if handler count grows
- [ ] **Command Queueing:** If command throughput exceeds single-flight assumption
- [ ] **Offline Command Buffering:** Persist commands pulled while offline, execute on reconnect
- [ ] **Enhanced Logging:** Structured logging (JSON), remote log aggregation
- [ ] **Health Check Endpoint:** Periodic lightweight health ping to backend (optional)
- [ ] **Metrics & Analytics:** Anonymous device stats (SDK version, crash rates)
- [ ] **Localization:** Multi-language UI strings (future if global deployment)

**Acceptance Criteria:**
- [ ] Carrier-privileged IMEI read succeeds on real devices
- [ ] Play Integrity attestation accepted by backend
- [ ] Feature modules load-balanced correctly
- [ ] Command buffering survives multiple restarts
- [ ] Remote logging operational

---

## Known Limitations & Workarounds

| Limitation | Scope | Workaround | Post-MVP Path |
|-----------|-------|-----------|---------------|
| **IMEI Fallback (Emulator)** | Phase 03 | Operator pre-uploads ANDROID_ID-derived value | Q4: Carrier-privileged path |
| **DPC_INTERNAL_API_KEY in BuildConfig** | Phase 03 | Demo build only; known limitation | Q4: Play Integrity attestation |
| **Re-Enroll on 401** | Phase 03 | Manual app reopen + operator re-dispatch REGISTER | Phase 04: Auto-recovery trigger |
| **No Periodic Fallback** | Architecture | Accepted trade-off for event-driven model | Monitor FCM reliability; expand if needed |
| **No Automated Tests** | Phase 03 | Manual lifecycle test validates behavior | Phase 04: Full test suite |

---

## Dependency Timeline

```
Phase 01
  ├─ Retrofit, Moshi, OkHttp
  ├─ androidx.compose BOM
  ├─ security-crypto (EncryptedSharedPreferences)
  └─ Firebase BOM (messaging)

Phase 02
  ├─ WorkManager
  ├─ Coil (image loading)
  └─ (no new external deps)

Phase 03
  ├─ (no new external deps)
  └─ Ready for acceptance

Phase 04
  ├─ JUnit 4, Mockito
  ├─ Espresso, Robolectric
  └─ okhttp3-mockwebserver

Phase 05
  ├─ Google Play Services (Integrity)
  └─ (structured logging lib, optional)
```

---

## Success Metrics & KPIs

### Phase 03 Acceptance
- **Enrollment Success Rate:** 100% (test run)
- **Lock Latency:** ≤ 3 s FCM + checkin + handler dispatch
- **Crash-Free Duration:** > 10 min manual test
- **Command Ack Reliability:** 100% ack delivered (idempotent by command_id)

### Phase 04 Quality Gate
- **Test Coverage:** ≥ 80% for critical paths (data, work, command)
- **Build Success Rate:** 100% on CI/CD
- **Lint Warnings:** ≤ 5 non-critical

### Phase 05 Production Readiness
- **Carrier IMEI Success Rate:** > 99% on real devices
- **Play Integrity Attestation:** Acceptance rate > 98%
- **Feature Module Load Time:** < 100 ms cold start impact

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **FCM Reliability Drop** | Low | High (commands delayed) | Monitor FCM metrics; add periodic fallback if needed |
| **Device Owner Revocation** | Medium | Low (app gracefully degrades) | Document user flow; allow enrollment after revoke |
| **Credential Corruption** | Very Low | High (re-enroll needed) | Test AES256-GCM round-trips in Phase 04 tests |
| **Carrier-Privileged Path Missing** | Medium | Medium (prod IMEI failure) | Plan Phase 05 early; allocate Q4 resources |
| **Play Integrity API Changes** | Low | Medium (attestation fail) | Monitor Google API releases; test post-MVP |

---

## Stakeholder Communication

### For Backend Team
- **Phase 03:** API contract locked (enroll, checkin, command schema)
- **Phase 04:** No API changes (internal testing only)
- **Phase 05:** Possible API v2 for attestation; early notification needed

### For Product/QA
- **Phase 03:** Manual acceptance test (documented in README)
- **Phase 04:** Automated test suite ready (CI/CD gates merges)
- **Phase 05:** Production deployment checklist (IMEI, attestation, rollout strategy)

### For Security
- **Phase 03:** Encryption audited (AES256-GCM via AndroidKeyStore)
- **Phase 04:** Security test scenarios (401, credential theft, network MitM)
- **Phase 05:** Play Integrity integration review (attestation + risk assessment)

---

## Release Strategy

### v0.3.0 (Phase 03 Complete)
- Tag: `v0.3-client-complete`
- Release Notes: Event-driven checkin loop, Device Owner lock, FCM integration, manual lifecycle test
- Deployment: Manual testing only; not production-ready until Phase 04
- Known Limits: IMEI fallback, BuildConfig API key, no auto-recovery on 401

### v0.4.0 (Phase 04 Complete)
- Tag: `v0.4-with-tests`
- Release Notes: Unit + instrumented test suite (≥80% coverage), CI/CD pipeline, enhanced logging
- Deployment: Automated tests gate all merges; safe for staged rollout

### v0.5.0 (Phase 05 Complete)
- Tag: `v0.5-production-ready`
- Release Notes: Carrier-privileged IMEI, Play Integrity attestation, feature modules, analytics
- Deployment: Full production release; enterprise customer launch

---

## Next Steps (Immediate)

1. **Complete Phase 03 Acceptance Test**
   - Run manual lifecycle test in isolation
   - Verify all logcat tags and message sequence
   - Confirm baseline_active snapshot functionality
   - Document any deviations from expected behavior

2. **Tag Release**
   ```bash
   git tag v0.3-client-complete
   git push --tags
   ```

3. **Begin Phase 04 Planning**
   - Identify critical test scenarios
   - Set up GitHub Actions CI/CD
   - Create test data fixtures and mocks

4. **Roadmap Review**
   - Stakeholder alignment on Phase 04/05 scope
   - Resource allocation for Q3/Q4 2026
   - Carrier IMEI research (Phase 05 preparation)

---

**Last Updated:** 2026-06-07 | **Version:** 0.3.0  
**Maintained By:** Fluxion Platform Team  
**Next Review:** Post v0.3.0 acceptance (Q3 2026 kickoff)
