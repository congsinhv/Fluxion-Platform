package com.fluxion.client.ui

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationManagerCompat
import com.fluxion.client.platform.dpc.FluxionDeviceAdminReceiver

class LockedActivity : ComponentActivity() {

    // Backing state for the locked UI; reassigning these triggers recomposition
    // so an ACTION_UPDATE intent (e.g. NOTIFY_FROM_LOCKED) can swap the visible
    // title/content without tearing down the activity or its lock-task session.
    private var uiTitle by mutableStateOf("Device locked")
    private var uiContent by mutableStateOf("This device has been locked. Please contact your operator to resolve.")
    private var uiIcon by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A dismiss intent can land in onCreate (not onNewIntent) when no
        // LockedActivity instance is foreground — e.g. RELEASE/UNLOCK after the
        // welcome screen took over the task. Without this guard the fresh
        // instance would render the lock UI and re-enter lock task, re-locking a
        // device that was being unlocked or released.
        if (intent.action == ACTION_DISMISS) {
            try {
                stopLockTask()
            } catch (_: IllegalStateException) {
                // not in lock task mode
            }
            NotificationManagerCompat.from(this)
                .cancel(com.fluxion.client.command.CommandExecutor.ID_LOCK)
            finishAndRemoveTask()
            return
        }
        applyContentExtras(intent)

        setContent {
            LockedView(uiTitle, uiContent, uiIcon)
        }

        startLockTaskIfDeviceOwner()
    }

    private fun applyContentExtras(intent: Intent) {
        intent.getStringExtra(EXTRA_TITLE)?.let { uiTitle = it }
        intent.getStringExtra(EXTRA_CONTENT)?.let { uiContent = it }
        if (intent.hasExtra(EXTRA_ICON)) uiIcon = intent.getStringExtra(EXTRA_ICON)
    }

    override fun onResume() {
        super.onResume()
        startLockTaskIfDeviceOwner()
    }

    @Deprecated("Back press intentionally swallowed during kiosk lock")
    override fun onBackPressed() {
        // Swallow back press while locked.
    }

    private fun startLockTaskIfDeviceOwner() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(packageName)) {
            Log.w(TAG, "Not Device Owner; rendering lock UI without kiosk")
            return
        }
        // setLockTaskPackages may fail if the DPM record was inherited from a
        // previous APK class path (no onEnabled ever fired for the current
        // receiver). DpcApp.onCreate re-sets the allowlist defensively, so the
        // call here is best-effort — startLockTask must still run.
        val admin = ComponentName(this, FluxionDeviceAdminReceiver::class.java)
        try {
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
        } catch (e: SecurityException) {
            Log.w(TAG, "setLockTaskPackages refused (using whatever allowlist is set)", e)
        }
        try {
            // Hide home/recents/back/notifications so the user is trapped in the app.
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD)
        } catch (e: SecurityException) {
            Log.w(TAG, "setLockTaskFeatures refused", e)
        }
        try {
            startLockTask()
            Log.i(TAG, "lock task started")
        } catch (e: Exception) {
            Log.w(TAG, "startLockTask refused", e)
        }
    }

    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_CONTENT = "content"
        const val EXTRA_ICON = "icon"
        private const val TAG = "FluxionLocked"

        fun dismiss(context: Context) {
            // stopLockTask must run from the foreground Activity; send a SINGLE_TOP
            // intent so onNewIntent fires on the already-running LockedActivity and
            // it can call stopLockTask + finish itself.
            val intent = Intent(context, LockedActivity::class.java).apply {
                action = ACTION_DISMISS
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            context.startActivity(intent)
        }

        // Update the on-screen title/content/icon of an already-running locked
        // session. Used by NOTIFY_FROM_LOCKED — kiosk lock-task hides the status
        // shade, so a normal notification posts but is invisible; we render the
        // operator message directly on the locked surface instead.
        fun update(context: Context, title: String, content: String, iconUrl: String?) {
            val intent = Intent(context, LockedActivity::class.java).apply {
                action = ACTION_UPDATE
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_CONTENT, content)
                putExtra(EXTRA_ICON, iconUrl)
            }
            context.startActivity(intent)
        }

        private const val ACTION_DISMISS = "com.fluxion.client.LOCKED_DISMISS"
        private const val ACTION_UPDATE = "com.fluxion.client.LOCKED_UPDATE"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when (intent.action) {
            ACTION_DISMISS -> {
                try {
                    stopLockTask()
                } catch (_: IllegalStateException) {
                    // not in lock task mode
                }
                NotificationManagerCompat.from(this).cancel(com.fluxion.client.command.CommandExecutor.ID_LOCK)
                finishAndRemoveTask()
            }
            ACTION_UPDATE -> applyContentExtras(intent)
        }
    }
}

// L1 "in-family" locked surface: the same cream status template as the other
// states, with the red Locked tint carrying the severity. The device-identity
// card (brand · model · IMEI) matches the active/unlocked surfaces. A
// NOTIFY_FROM_LOCKED swaps the title/content via ACTION_UPDATE; the card persists.
@Composable
private fun LockedView(title: String, content: String, iconUrl: String?) {
    StatusScreen(
        tint = StateTints.Locked,
        stateLabel = "Locked",
        glyph = Icons.Outlined.Lock,
        iconUrl = iconUrl,
        title = title,
        content = content,
    )
}
