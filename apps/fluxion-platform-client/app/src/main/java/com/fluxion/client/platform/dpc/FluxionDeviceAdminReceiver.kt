package com.fluxion.client.platform.dpc

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device Admin receiver for Fluxion DPC. Class name + package preserved at
 * `com.fluxion.client.platform.dpc.FluxionDeviceAdminReceiver` because that's
 * the path persisted in DPM state on existing test AVDs — renaming would orphan
 * the Device Owner record and require an AVD wipe to fix.
 */
class FluxionDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.w(TAG, "Device admin disabled")
    }

    companion object {
        private const val TAG = "FluxionDeviceAdmin"
    }
}
