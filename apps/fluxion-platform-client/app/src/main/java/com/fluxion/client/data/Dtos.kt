package com.fluxion.client.data

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class DeviceInfoDto(
    @Json(name = "dpc_version") val dpcVersion: String,
    @Json(name = "android_sdk") val androidSdk: Int
)

@JsonClass(generateAdapter = true)
data class EnrollRequest(
    val imei: String,
    @Json(name = "fcm_token") val fcmToken: String,
    @Json(name = "device_info") val deviceInfo: DeviceInfoDto
)

@JsonClass(generateAdapter = true)
data class EnrollResponse(
    @Json(name = "device_id") val deviceId: String,
    @Json(name = "api_key") val apiKey: String,
    @Json(name = "checkin_endpoint") val checkinEndpoint: String,
    @Json(name = "checkin_interval") val checkinInterval: Int,
    @Json(name = "server_time") val serverTime: String? = null
)

@JsonClass(generateAdapter = true)
data class CommandErrorDto(
    val code: String,
    val message: String
)

@JsonClass(generateAdapter = true)
data class CommandResultDto(
    @Json(name = "command_id") val commandId: String,
    val status: String,
    @Json(name = "executed_at") val executedAt: String,
    val error: CommandErrorDto? = null
)

@JsonClass(generateAdapter = true)
data class CheckinRequest(
    val type: String = "CHECKIN",
    @Json(name = "device_info") val deviceInfo: DeviceInfoDto? = null,
    @Json(name = "command_result") val commandResult: CommandResultDto? = null
)

@JsonClass(generateAdapter = true)
data class NotificationPayload(
    @Json(name = "display_mode") val displayMode: String? = null,
    val title: String? = null,
    val content: String? = null,
    @Json(name = "header_icon_url") val headerIconUrl: String? = null,
    @Json(name = "notification_icon_url") val notificationIconUrl: String? = null
)

@JsonClass(generateAdapter = true)
data class CommandPayload(
    val notification: NotificationPayload? = null
)

@JsonClass(generateAdapter = true)
data class CommandDto(
    @Json(name = "command_id") val commandId: String,
    @Json(name = "action_type") val actionType: String,
    val payload: CommandPayload = CommandPayload()
)

@JsonClass(generateAdapter = true)
data class CheckinResponse(
    val command: CommandDto? = null,
    @Json(name = "next_checkin_in") val nextCheckinIn: Int = SecureStorage.DEFAULT_INTERVAL_SECONDS,
    @Json(name = "server_time") val serverTime: String? = null
)

@JsonClass(generateAdapter = true)
data class ApiError(
    @Json(name = "error_code") val errorCode: String? = null,
    val message: String? = null
)
