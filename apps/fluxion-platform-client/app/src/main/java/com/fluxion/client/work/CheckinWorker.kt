package com.fluxion.client.work

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.fluxion.client.BuildConfig
import com.fluxion.client.command.CommandExecutor
import com.fluxion.client.data.ApiClient
import com.fluxion.client.data.CheckinRequest
import com.fluxion.client.data.CheckinResponse
import com.fluxion.client.data.CommandResultDto
import com.fluxion.client.data.DeviceInfoDto
import com.fluxion.client.data.EnrollRequest
import com.fluxion.client.data.SecureStorage
import retrofit2.HttpException

/**
 * Event-driven checkin worker. No periodic polling — it runs only when woken:
 * FCM wake, after a command executes (to flush the ack), back-online, or app
 * boot while enrolled. Each run is one of two shapes:
 * - ACK-mode  (a pendingAck exists): report the result, clear it, go idle.
 *   Ignores any response command (an ack request never pulls).
 * - PULL-mode (no pendingAck): execute the returned command (if any), which
 *   stashes a fresh ack, then fire one immediate ACK-mode run. Empty pull -> idle.
 *
 * Trade-off: a dropped FCM wake while online is not recovered by a poll. Accepted
 * for the event-driven model — back-online only covers the offline->online edge.
 */
class CheckinWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    private val storage = SecureStorage(applicationContext)

    override suspend fun doWork(): Result {
        val apiKey = storage.apiKey
        val imei = storage.imei
        if (apiKey == null || imei == null) {
            Log.w(TAG, "No api_key/imei — device not enrolled; skipping")
            return Result.success()
        }

        val pendingAck = storage.pendingAckJson?.let { json ->
            runCatching { ApiClient.resultAdapter.fromJson(json) }.getOrNull()
        }

        val response: CheckinResponse = try {
            ApiClient.api.checkin(
                authorization = "Bearer $apiKey",
                imei = imei,
                dpcVersion = BuildConfig.VERSION_NAME,
                body = CheckinRequest(commandResult = pendingAck)
            )
        } catch (e: HttpException) {
            return handleHttpError(e, hadAck = pendingAck != null)
        } catch (e: Exception) {
            Log.w(TAG, "Checkin transport error", e)
            return Result.retry()
        }

        if (pendingAck != null) {
            // ACK-mode: server accepted the result. Clear it and go idle. Do NOT
            // act on response.command — an ack request never pulls (server returns
            // command=null). The next command arrives via FCM wake.
            storage.pendingAckJson = null
            // A RELEASE ack is terminal. The old periodic model cleared creds when
            // a follow-up poll got 403 DEVICE_RELEASED; the event-driven worker has
            // no follow-up, so wipe here — now that the result is delivered (the
            // applier will flip to RELEASED). handleRelease() marks the sentinel.
            if (storage.deviceId == CommandExecutor.RELEASED_SENTINEL) {
                Log.i(TAG, "release ack flushed — clearing credentials")
                storage.clear()
                cancelAll(applicationContext)
            }
            return Result.success()
        }

        // PULL-mode: execute the returned command (if any). CommandExecutor stashes
        // a fresh ack; fire one immediate ACK-mode run to flush it with no delay.
        // An empty pull simply goes idle until the next event — no reschedule.
        response.command?.let {
            CommandExecutor(applicationContext).execute(it)
            if (storage.pendingAckJson != null) enqueueImmediate(applicationContext)
        }

        return Result.success()
    }

    private fun handleHttpError(e: HttpException, hadAck: Boolean): Result {
        val code = e.code()
        val body = e.response()?.errorBody()?.string()
        val parsed = body?.let { runCatching { ApiClient.errorAdapter.fromJson(it) }.getOrNull() }
        val errorCode = parsed?.errorCode ?: "HTTP_$code"
        Log.w(TAG, "Checkin HTTP $code error=$errorCode body=$body")

        return when (errorCode) {
            "INVALID_CREDENTIALS", "MISSING_API_KEY" -> {
                storage.clear()
                Result.success()
            }
            "DEVICE_RELEASED" -> {
                storage.clear()
                cancelAll(applicationContext)
                Result.success()
            }
            "UNKNOWN_COMMAND_ID" -> {
                if (hadAck) storage.pendingAckJson = null
                Result.success()
            }
            else -> if (code in 500..599) Result.retry() else Result.success()
        }
    }

    companion object {
        private const val TAG = "FluxionCheckin"
        const val UNIQUE_NAME = "fluxion-checkin"

        fun enqueueImmediate(context: Context) {
            // The single "wake now" trigger — used by FCM wake, the post-execute
            // ack flush, the back-online NetworkCallback, and app boot. REPLACE so
            // a new wake supersedes any in-flight/queued run; backend single-flight
            // (assigned_action_id) + command_id-idempotent acks make a replaced
            // mid-flight POST safe (the new run pulls the same command / re-acks).
            val request = OneTimeWorkRequestBuilder<CheckinWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_NAME,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }

        fun cancelAll(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
        }

        fun enrollRequest(imei: String, fcmToken: String): EnrollRequest =
            EnrollRequest(
                imei = imei,
                fcmToken = fcmToken,
                deviceInfo = DeviceInfoDto(
                    dpcVersion = BuildConfig.VERSION_NAME,
                    androidSdk = Build.VERSION.SDK_INT
                )
            )

        fun stashAck(storage: SecureStorage, result: CommandResultDto) {
            storage.pendingAckJson = ApiClient.resultAdapter.toJson(result)
        }
    }
}
