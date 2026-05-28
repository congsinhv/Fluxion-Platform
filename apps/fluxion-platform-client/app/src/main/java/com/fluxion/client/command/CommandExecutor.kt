package com.fluxion.client.command

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.toBitmap
import com.fluxion.client.MainActivity
import com.fluxion.client.R
import com.fluxion.client.data.CommandDto
import com.fluxion.client.data.CommandResultDto
import com.fluxion.client.data.DeviceStateEvents
import com.fluxion.client.data.NotificationPayload
import com.fluxion.client.data.SecureStorage
import com.fluxion.client.ui.LockedActivity
import com.fluxion.client.work.CheckinWorker
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Switch on action_type, dispatch to per-action handler, stash ack for next checkin.
 * All actions ack immediately — backend treats DPC-side "I rendered the notification"
 * as APPLIED. Real failure modes (PermissionDenied on LOCK without DO) surface as FAILED.
 */
class CommandExecutor(private val context: Context) {

    private val storage = SecureStorage(context)

    fun execute(command: CommandDto) {
        Log.i(TAG, "Execute command_id=${command.commandId} action=${command.actionType}")
        ensureNotificationChannels()

        val result = runCatching {
            when (command.actionType) {
                "ACTIVATE" -> handleActivate(command.payload.notification)
                "LOCK" -> handleLock(command.payload.notification)
                "UNLOCK" -> handleUnlock(command.payload.notification)
                "NOTIFY_FROM_ACTIVE" -> handleNotify(command.payload.notification)
                "NOTIFY_FROM_LOCKED" -> handleNotifyFromLocked(command.payload.notification)
                "RELEASE_FROM_ACTIVE",
                "RELEASE_FROM_LOCKED" -> handleRelease()
                else -> error("Unknown action_type ${command.actionType}")
            }
            successResult(command.commandId)
        }.getOrElse { e ->
            Log.w(TAG, "Command failed", e)
            failureResult(command.commandId, "DPC_HANDLER_ERROR", e.message ?: "unknown")
        }

        CheckinWorker.stashAck(storage, result)
        // execute() only stashes the ack — it does not schedule. The PULL-mode
        // run in CheckinWorker.doWork() fires the immediate ACK-mode run after
        // this returns, which sends the stashed result.
    }

    // --- Handlers ---

    private fun handleActivate(n: NotificationPayload?) {
        postNotification(
            CHANNEL_HIGH,
            ID_ACTIVATE,
            n?.title ?: "Welcome",
            n?.content ?: "Your device is now active.",
            fullScreen = (n?.displayMode == "FULLSCREEN")
        )
        // Persist BEFORE starting the activity so a cold reopen is consistent
        // even if the (background) activity-start is dropped.
        persistActivePhase(n)
        launchWelcome(MainActivity.TRANSITION_ACTIVATE_WELCOME, n)
    }

    private fun handleLock(n: NotificationPayload?) {
        val title = n?.title ?: "Device locked"
        val body = n?.content ?: "Contact support to resolve."
        val lockIntent = Intent(context, LockedActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra(LockedActivity.EXTRA_TITLE, title)
            putExtra(LockedActivity.EXTRA_CONTENT, body)
            putExtra(LockedActivity.EXTRA_ICON, n?.headerIconUrl)
        }
        // Direct activity start works while we hold Device Owner. Background-start
        // restrictions on API 31+ exempt the Device Owner, but if the AVD ever
        // refuses the start, the full-screen-intent notification below acts as a
        // trampoline that survives Doze + background limits.
        val pi = PendingIntent.getActivity(
            context, 9000, lockIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        postNotification(CHANNEL_HIGH, ID_LOCK, title, body, fullScreen = true, pendingIntent = pi)
        context.startActivity(lockIntent)
    }

    private fun handleUnlock(n: NotificationPayload?) {
        LockedActivity.dismiss(context)
        postNotification(
            CHANNEL_DEFAULT,
            ID_UNLOCK,
            n?.title ?: "Device unlocked",
            n?.content ?: "All features are available again.",
            fullScreen = false
        )
        // Unlock returns the device to the Active phase; drive the welcome-back
        // flourish (persist first, then start the activity).
        persistActivePhase(n)
        launchWelcome(MainActivity.TRANSITION_UNLOCK_WELCOME, n)
    }

    private fun handleNotify(n: NotificationPayload?) {
        val isFullscreen = n?.displayMode == "FULLSCREEN"
        // Heads-up over our OWN foreground app only happens for notifications
        // carrying a full-screen intent — a plain high-importance notification is
        // suppressed while its app is in the foreground (that's why FULLSCREEN
        // pops and POPUP didn't). Give POPUP the same heads-up trigger, but ONLY
        // while the screen is interactive: with the screen on the system shows a
        // heads-up banner and does NOT fire the intent; if it's off/locked the
        // intent would LAUNCH the activity (a takeover we don't want for POPUP).
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val headsUp = isFullscreen || pm.isInteractive
        postNotification(
            CHANNEL_HIGH,
            ID_NOTIFY,
            n?.title ?: "Notification",
            n?.content.orEmpty(),
            fullScreen = headsUp,
            largeIconUrl = n?.notificationIconUrl
        )
        // Persist the new template (persistActivePhase also signals the UI to
        // re-read it live). FULLSCREEN additionally brings the app forward.
        persistActivePhase(n)
        if (isFullscreen) {
            launchWelcome(MainActivity.TRANSITION_ACTIVATE_WELCOME, n)
        }
    }

    // While locked, kiosk lock-task hides the status shade — a plain
    // mgr.notify() posts into a tray the user can't see. Render the operator
    // message on the locked surface itself instead, so the message is the only
    // visible UI. Also post a FULLSCREEN notification as a fallback in case the
    // LockedActivity isn't running for any reason (e.g. crashed and not yet
    // restarted by lock-task).
    private fun handleNotifyFromLocked(n: NotificationPayload?) {
        val title = n?.title ?: "Notice"
        val body = n?.content.orEmpty()
        LockedActivity.update(context, title, body, n?.headerIconUrl)
        postNotification(
            CHANNEL_HIGH, ID_NOTIFY, title, body,
            fullScreen = true,
            largeIconUrl = n?.notificationIconUrl,
        )
    }

    private fun handleRelease() {
        LockedActivity.dismiss(context)
        // Defer clearing api_key/imei: the ACK still needs them to authenticate
        // and deliver the RELEASE result. Mark released via the sentinel; once the
        // ack is flushed, CheckinWorker's ACK-mode success branch wipes creds +
        // cancels work (replacing the old "post-ack 403 DEVICE_RELEASED" cleanup).
        SecureStorage(context).deviceId = RELEASED_SENTINEL
        // Flip a foregrounded MainActivity to the Released screen immediately.
        DeviceStateEvents.notifyChanged()
        // Release frees the device from the program: relinquish Device Owner so
        // management privileges (kiosk lock, policy) no longer apply. Clearing DO
        // drops admin rights only — app data/creds survive, so the pending ack
        // checkin still sends. Best-effort: a non-DO build must not crash here.
        runCatching {
            val dpm = context.getSystemService(android.app.admin.DevicePolicyManager::class.java)
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                dpm.clearDeviceOwnerApp(context.packageName)
                Log.i(TAG, "Device Owner relinquished on release")
            }
        }.onFailure { Log.w(TAG, "clearDeviceOwnerApp refused", it) }
    }

    // --- Helpers ---

    private fun persistActivePhase(n: NotificationPayload?) {
        storage.currentPhase = SecureStorage.PHASE_ACTIVE
        storage.lastTemplateTitle = n?.title
        storage.lastTemplateContent = n?.content
        storage.lastTemplateIconUrl = n?.headerIconUrl
        // Wake a foregrounded MainActivity to re-read the new template live.
        DeviceStateEvents.notifyChanged()
    }

    private fun launchWelcome(transition: String, n: NotificationPayload?) {
        val intent = Intent(context, MainActivity::class.java).apply {
            // singleTask routes this to onNewIntent when warm, onCreate when cold.
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_TRANSITION, transition)
            putExtra(MainActivity.EXTRA_TITLE, n?.title)
            putExtra(MainActivity.EXTRA_CONTENT, n?.content)
            putExtra(MainActivity.EXTRA_ICON_URL, n?.headerIconUrl)
        }
        // Device Owner is exempt from background-activity-start limits; if the
        // start is ever refused, the persisted phase + posted notification keep
        // the device consistent (welcome just renders on next foreground).
        runCatching { context.startActivity(intent) }
            .onFailure { Log.w(TAG, "welcome activity start refused", it) }
    }

    private fun ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_HIGH, "Important", NotificationManager.IMPORTANCE_HIGH)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DEFAULT, "Updates", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun postNotification(
        channel: String,
        id: Int,
        title: String,
        body: String,
        fullScreen: Boolean,
        pendingIntent: PendingIntent? = null,
        largeIconUrl: String? = null
    ) {
        val tap = pendingIntent ?: PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Best-effort remote large icon (POPUP notification_icon_url). Bounded +
        // null-safe — any failure/timeout just falls back to the small icon.
        val largeIcon = largeIconUrl?.let { loadBitmapBlocking(it) }
        val notif = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .apply {
                if (largeIcon != null) setLargeIcon(largeIcon)
                if (fullScreen) setFullScreenIntent(tap, true)
            }
            .build()
        androidx.core.app.NotificationManagerCompat.from(context).also { mgr ->
            if (mgr.areNotificationsEnabled()) mgr.notify(id, notif)
        }
    }

    // Synchronous, bounded Coil fetch for a notification large icon. Runs on the
    // already-background command thread; never throws into the caller.
    private fun loadBitmapBlocking(url: String): android.graphics.Bitmap? =
        runCatching {
            kotlinx.coroutines.runBlocking {
                kotlinx.coroutines.withTimeoutOrNull(2500) {
                    val request = coil.request.ImageRequest.Builder(context)
                        .data(url)
                        .allowHardware(false)
                        .build()
                    val result = coil.ImageLoader(context).execute(request)
                    (result as? coil.request.SuccessResult)?.drawable?.toBitmap()
                }
            }
        }.getOrNull()

    private fun successResult(commandId: String) = CommandResultDto(
        commandId = commandId,
        status = "SUCCESS",
        executedAt = isoNow()
    )

    private fun failureResult(commandId: String, code: String, message: String) = CommandResultDto(
        commandId = commandId,
        status = "FAILED",
        executedAt = isoNow(),
        error = com.fluxion.client.data.CommandErrorDto(code, message)
    )

    private fun isoNow(): String =
        ZonedDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

    companion object {
        private const val TAG = "FluxionCommand"
        const val CHANNEL_HIGH = "fluxion_high"
        const val CHANNEL_DEFAULT = "fluxion_default"
        const val ID_ACTIVATE = 1001
        const val ID_UNLOCK = 1002
        const val ID_NOTIFY = 1003
        const val ID_LOCK = 1004
        const val RELEASED_SENTINEL = "__released__"
    }
}
