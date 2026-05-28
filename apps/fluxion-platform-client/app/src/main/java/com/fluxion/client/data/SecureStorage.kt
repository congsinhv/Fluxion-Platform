package com.fluxion.client.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EncryptedSharedPreferences-backed key/value store for api_key, device_id,
 * pending command ack payloads, and last-known checkin interval.
 */
class SecureStorage(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    var apiKey: String?
        get() = prefs.getString(KEY_API_KEY, null)
        set(value) = prefs.edit().putString(KEY_API_KEY, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var imei: String?
        get() = prefs.getString(KEY_IMEI, null)
        set(value) = prefs.edit().putString(KEY_IMEI, value).apply()

    var pendingAckJson: String?
        get() = prefs.getString(KEY_PENDING_ACK, null)
        set(value) = prefs.edit().putString(KEY_PENDING_ACK, value).apply()

    var lastIntervalSeconds: Int
        get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_SECONDS)
        set(value) = prefs.edit().putInt(KEY_INTERVAL, value).apply()

    // Persisted lifecycle phase so a cold reopen lands on the correct steady
    // screen (e.g. "ACTIVE"). The transient welcome flourishes are intent-only
    // and deliberately NOT stored here — that guarantees kill+reopen settles
    // straight to the steady state.
    var currentPhase: String?
        get() = prefs.getString(KEY_PHASE, null)
        set(value) = prefs.edit().putString(KEY_PHASE, value).apply()

    // Last template title/content shown on ACTIVATE/UNLOCK, so the steady
    // Active screen can keep rendering the operator's copy after a reopen.
    var lastTemplateTitle: String?
        get() = prefs.getString(KEY_TPL_TITLE, null)
        set(value) = prefs.edit().putString(KEY_TPL_TITLE, value).apply()

    var lastTemplateContent: String?
        get() = prefs.getString(KEY_TPL_CONTENT, null)
        set(value) = prefs.edit().putString(KEY_TPL_CONTENT, value).apply()

    var lastTemplateIconUrl: String?
        get() = prefs.getString(KEY_TPL_ICON, null)
        set(value) = prefs.edit().putString(KEY_TPL_ICON, value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val FILE = "fluxion_secure"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_IMEI = "imei"
        private const val KEY_PENDING_ACK = "pending_ack"
        private const val KEY_INTERVAL = "interval_seconds"
        private const val KEY_PHASE = "current_phase"
        private const val KEY_TPL_TITLE = "last_template_title"
        private const val KEY_TPL_CONTENT = "last_template_content"
        private const val KEY_TPL_ICON = "last_template_icon_url"
        const val DEFAULT_INTERVAL_SECONDS = 3600
        const val PHASE_ACTIVE = "ACTIVE"
    }
}
