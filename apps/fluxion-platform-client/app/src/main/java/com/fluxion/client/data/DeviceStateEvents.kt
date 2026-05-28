package com.fluxion.client.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Process-wide one-shot signal that device state persisted by a background
 * component changed, so a foregrounded MainActivity can re-derive its screen
 * immediately (POPUP template update, RELEASED sentinel).
 *
 * In-memory by design: a SharedPreferences.OnSharedPreferenceChangeListener
 * CANNOT be used here because EncryptedSharedPreferences does not report the
 * plaintext key to the listener — the callback fires with an encrypted/absent
 * key, so key-matching never works. CommandExecutor (checkin thread) and
 * MainActivity run in the same process, so this singleton bridges them reliably.
 */
object DeviceStateEvents {
    // replay=0, small buffer so a background emit isn't dropped if the collector
    // is momentarily absent; tryEmit never blocks the checkin thread.
    private val _changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val changes: SharedFlow<Unit> = _changes.asSharedFlow()

    fun notifyChanged() {
        _changes.tryEmit(Unit)
    }
}
