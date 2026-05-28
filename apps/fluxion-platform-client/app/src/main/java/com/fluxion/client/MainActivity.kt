package com.fluxion.client

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.telephony.TelephonyManager
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.fluxion.client.command.CommandExecutor
import com.fluxion.client.data.ApiClient
import com.fluxion.client.data.DeviceStateEvents
import com.fluxion.client.data.SecureStorage
import com.fluxion.client.ui.ActiveScreen
import com.fluxion.client.ui.ActiveWelcomeScreen
import com.fluxion.client.ui.EnrollingScreen
import com.fluxion.client.ui.EulaScreen
import com.fluxion.client.ui.ReleasedScreen
import com.fluxion.client.ui.WelcomeBackScreen
import com.fluxion.client.ui.WelcomeTemplate
import com.fluxion.client.ui.theme.FluxionTheme
import com.fluxion.client.work.CheckinWorker
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class MainActivity : ComponentActivity() {

    private lateinit var vm: MainViewModel

    private val requestPostNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* ignore */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm = ViewModelProvider(
            this,
            MainViewModel.Factory(applicationContext)
        )[MainViewModel::class.java]
        requestNotificationPermissionIfNeeded()

        // A cold start carrying a transition extra (CommandExecutor → ACTIVATE/
        // UNLOCK) shows the matching welcome flourish; a normal launcher start
        // (no extras) falls through to the steady state from storage.
        consumeTransitionIntent(intent)

        setContent {
            FluxionTheme {
                val state by vm.state.collectAsState()

                // Welcome flourishes are transient: after a short beat, settle to
                // steady Active. Kept in ViewModel memory only — never persisted.
                LaunchedEffect(state) {
                    if (state is UiState.ActiveWelcome || state is UiState.WelcomeBack) {
                        delay(WELCOME_TIMEOUT_MS)
                        vm.settleToActive()
                    }
                }

                when (val s = state) {
                    is UiState.Eula -> EulaScreen(onAccept = { vm.startEnroll(this) })
                    is UiState.Enrolling -> EnrollingScreen()
                    is UiState.ActiveWelcome -> ActiveWelcomeScreen(s.template)
                    is UiState.Active -> ActiveScreen(s.template)
                    is UiState.WelcomeBack -> WelcomeBackScreen(s.template)
                    is UiState.Released -> ReleasedScreen()
                    is UiState.Error -> EulaScreen(
                        errorText = s.message,
                        onAccept = { vm.startEnroll(this) }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // singleTask routes a re-launch here while warm. setIntent first so any
        // later getIntent() reflects this delivery, then apply the transition.
        setIntent(intent)
        consumeTransitionIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // A POPUP NOTIFY or a RELEASE that arrived while backgrounded only wrote
        // to storage — no transition intent fires. Re-derive the steady state so
        // returning to the app reflects the latest template / released status.
        // (Foreground delivery is handled live by the storage observer in the VM.)
        vm.refreshFromStorage()
    }

    // Read + clear the transition extra so a config-change (rotation) re-running
    // onCreate with the same intent does NOT replay the welcome.
    private fun consumeTransitionIntent(intent: Intent?) {
        val kind = intent?.getStringExtra(EXTRA_TRANSITION) ?: return
        val template = WelcomeTemplate(
            title = intent.getStringExtra(EXTRA_TITLE),
            content = intent.getStringExtra(EXTRA_CONTENT),
            headerIconUrl = intent.getStringExtra(EXTRA_ICON_URL),
        )
        intent.removeExtra(EXTRA_TRANSITION)
        intent.removeExtra(EXTRA_TITLE)
        intent.removeExtra(EXTRA_CONTENT)
        intent.removeExtra(EXTRA_ICON_URL)
        vm.applyTransition(kind, template)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) requestPostNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    companion object {
        const val EXTRA_TRANSITION = "fluxion.transition"
        const val EXTRA_TITLE = "fluxion.title"
        const val EXTRA_CONTENT = "fluxion.content"
        const val EXTRA_ICON_URL = "fluxion.icon_url"
        const val TRANSITION_ACTIVATE_WELCOME = "ACTIVATE_WELCOME"
        const val TRANSITION_UNLOCK_WELCOME = "UNLOCK_WELCOME"
        private const val WELCOME_TIMEOUT_MS = 4000L
    }
}

sealed class UiState {
    data object Eula : UiState()
    data object Enrolling : UiState()
    data class ActiveWelcome(val template: WelcomeTemplate?) : UiState()
    data class Active(val template: WelcomeTemplate?) : UiState()
    data class WelcomeBack(val template: WelcomeTemplate?) : UiState()
    data object Released : UiState()
    data class Error(val message: String) : UiState()
}

class MainViewModel(private val appContext: Context) : ViewModel() {

    private val storage = SecureStorage(appContext)
    private val _state = MutableStateFlow(initialState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        // Live foreground refresh. CommandExecutor (checkin thread, same process)
        // emits on this signal after persisting a POPUP template or the RELEASED
        // sentinel, so we re-derive the screen immediately instead of waiting for
        // the next onResume. A SharedPreferences listener can't be used here —
        // EncryptedSharedPreferences doesn't report plaintext keys to it.
        viewModelScope.launch {
            DeviceStateEvents.changes.collect { refreshFromStorage() }
        }
    }

    // Steady state derived purely from persisted storage — obvious by reading.
    private fun initialState(): UiState = when {
        storage.deviceId == CommandExecutor.RELEASED_SENTINEL -> UiState.Released
        storage.apiKey != null && storage.deviceId != null ->
            if (storage.currentPhase == SecureStorage.PHASE_ACTIVE) {
                UiState.Active(storedTemplate())
            } else {
                UiState.Enrolling
            }
        else -> UiState.Eula
    }

    private fun storedTemplate(): WelcomeTemplate? {
        val t = storage.lastTemplateTitle
        val c = storage.lastTemplateContent
        val i = storage.lastTemplateIconUrl
        return if (t == null && c == null && i == null) null else WelcomeTemplate(t, c, i)
    }

    // Intent-driven transient welcome. Only ever sets in-memory state; the
    // phase was already persisted by CommandExecutor before this fires.
    fun applyTransition(kind: String, template: WelcomeTemplate?) {
        _state.value = when (kind) {
            MainActivity.TRANSITION_ACTIVATE_WELCOME -> UiState.ActiveWelcome(template)
            MainActivity.TRANSITION_UNLOCK_WELCOME -> UiState.WelcomeBack(template)
            else -> _state.value
        }
    }

    fun settleToActive() {
        // End of a welcome flourish: re-derive from storage so a RELEASE that
        // landed during the flourish settles to Released, not back to Active.
        if (_state.value is UiState.ActiveWelcome || _state.value is UiState.WelcomeBack) {
            _state.value = initialState()
        }
    }

    // Re-derive the steady state (Released / Active(template) / Enrolling / Eula)
    // from storage. Skips transient welcome flourishes so an in-flight
    // ACTIVATE/UNLOCK animation is not clobbered. Driven by the storage observer
    // (live, foreground POPUP/RELEASE) and by onResume (return from background).
    fun refreshFromStorage() {
        if (_state.value is UiState.ActiveWelcome || _state.value is UiState.WelcomeBack) return
        _state.value = initialState()
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    fun startEnroll(activity: ComponentActivity) {
        _state.value = UiState.Enrolling
        viewModelScope.launch {
            try {
                val imei = readImei(activity)
                val fcmToken = FirebaseMessaging.getInstance().token.await()
                Log.i(TAG, "Enroll imei=$imei fcm_len=${fcmToken.length}")

                val response = ApiClient.api.enroll(
                    internalKey = BuildConfig.DPC_INTERNAL_API_KEY,
                    body = CheckinWorker.enrollRequest(imei, fcmToken)
                )

                storage.apiKey = response.apiKey
                storage.deviceId = response.deviceId
                storage.imei = imei

                // Event-driven: a single PULL right after enroll picks up the
                // auto-chained ACTIVATE command. No periodic schedule.
                CheckinWorker.enqueueImmediate(appContext)
                // Stay on the persistent "setting up" screen until an ACTIVATE
                // command transitions the device to Active.
                _state.value = UiState.Enrolling
            } catch (e: Exception) {
                Log.w(TAG, "Enroll failed", e)
                _state.value = UiState.Error(e.message ?: "Enrollment failed")
            }
        }
    }

    @SuppressLint("HardwareIds", "MissingPermission")
    @Suppress("DEPRECATION")
    private fun readImei(activity: ComponentActivity): String {
        return try {
            val tm = activity.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            // Multiple Android IMEI APIs return different values on this emulator:
            //   tm.imei / tm.getImei() / tm.getImei(slot)  → 000000004736972 (placeholder)
            //   tm.deviceId  (legacy, what Settings + iphonesubinfo transaction 1 use)
            //                                              → 867400022047199 (canonical)
            // Device Owner has READ_PRIVILEGED_PHONE_STATE so deviceId is readable.
            // Prefer it; only fall back to getImei() if absent. On real devices the
            // two normally agree, so this only changes behavior on the emulator.
            val canonical = runCatching { tm.deviceId }.getOrNull()
                ?.takeIf { it.length == 15 && !it.startsWith("0000") }
            val slotCount = if (Build.VERSION.SDK_INT >= 29) tm.activeModemCount else tm.phoneCount
            val imeis = (0 until slotCount)
                .mapNotNull { runCatching { tm.getImei(it) }.getOrNull() }
                .filter { it.length == 15 }
            canonical
                ?: imeis.firstOrNull { !it.startsWith("0000") }
                ?: imeis.firstOrNull()
                ?: tm.imei
                ?: throw SecurityException("imei null")
        } catch (_: Exception) {
            // Emulator fallback — ANDROID_ID is 16 hex chars; pad to 15-digit numeric.
            val androidId = Settings.Secure.getString(
                activity.contentResolver, Settings.Secure.ANDROID_ID
            ).orEmpty()
            val digits = androidId.replace(Regex("[^0-9]"), "").padStart(15, '0').take(15)
            if (digits.length == 15) digits else "353047110000123"
        }
    }

    class Factory(private val appContext: Context) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            MainViewModel(appContext) as T
    }

    companion object {
        private const val TAG = "FluxionMain"
    }
}
