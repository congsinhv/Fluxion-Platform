package com.fluxion.client.fcm

import android.util.Log
import com.fluxion.client.work.CheckinWorker
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FluxionFcmService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        Log.i(TAG, "FCM received data=$data")
        if (data.containsKey("wake")) {
            CheckinWorker.enqueueImmediate(applicationContext)
        }
    }

    override fun onNewToken(token: String) {
        Log.i(TAG, "FCM token rotated; next checkin will pick it up via device_info refresh")
    }

    companion object {
        private const val TAG = "FluxionFcm"
    }
}
