package com.fluxion.client

import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import com.fluxion.client.data.SecureStorage
import com.fluxion.client.platform.dpc.FluxionDeviceAdminReceiver
import com.fluxion.client.work.CheckinWorker

class DpcApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "DpcApp boot")
        primeLockTaskAllowlist()
        registerBackOnlineTrigger()
        // Event-driven: app boot is a wake reason. If enrolled, fire one PULL to
        // catch any command dispatched while the process was dead.
        if (SecureStorage(this).apiKey != null) {
            CheckinWorker.enqueueImmediate(this)
        }
    }

    /**
     * Back-online trigger: when a network with internet becomes available after
     * being offline, fire one PULL check-in to catch any command dispatched while
     * the device was unreachable. Process-scoped so it survives Activity churn;
     * `enqueueImmediate` uses unique-work REPLACE so repeated onAvailable callbacks
     * (wifi then cellular, etc.) collapse to a single run.
     */
    private fun registerBackOnlineTrigger() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        try {
            cm.registerNetworkCallback(
                request,
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        if (SecureStorage(this@DpcApp).apiKey != null) {
                            Log.i(TAG, "network available -> pull")
                            CheckinWorker.enqueueImmediate(this@DpcApp)
                        }
                    }
                }
            )
        } catch (e: RuntimeException) {
            Log.w(TAG, "registerNetworkCallback refused", e)
        }
    }

    /**
     * Set the lock-task package allowlist once at app startup so LockedActivity
     * can later call startLockTask without depending on DeviceAdminReceiver.onEnabled
     * having fired this run. Silent failure is acceptable — startLockTask itself
     * will surface a usable error if the allowlist truly cannot be set.
     */
    private fun primeLockTaskAllowlist() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(packageName)) {
            Log.i(TAG, "not Device Owner; skipping lock-task allowlist init")
            return
        }
        val admin = ComponentName(this, FluxionDeviceAdminReceiver::class.java)
        try {
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            Log.i(TAG, "lock-task allowlist set [$packageName]")
        } catch (e: SecurityException) {
            Log.w(TAG, "setLockTaskPackages from DpcApp refused", e)
        }
    }

    companion object {
        private const val TAG = "FluxionApp"
    }
}
