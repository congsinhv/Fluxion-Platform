package com.fluxion.client.data

import com.fluxion.client.BuildConfig
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

interface DpcApi {
    @POST("/v1/enroll")
    suspend fun enroll(
        @Header("X-Internal-API-Key") internalKey: String,
        @Body body: EnrollRequest
    ): EnrollResponse

    @POST("/v1/checkin")
    suspend fun checkin(
        @Header("Authorization") authorization: String,
        @Header("X-Device-IMEI") imei: String,
        @Header("X-DPC-Version") dpcVersion: String,
        @Body body: CheckinRequest
    ): CheckinResponse
}

object ApiClient {
    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val httpClient: OkHttpClient by lazy {
        val log = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
            else HttpLoggingInterceptor.Level.BASIC
        }
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(UserAgentInterceptor())
            .addInterceptor(log)
            .build()
    }

    val api: DpcApi by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.DPC_BASE_URL.trimEnd('/') + "/")
            .client(httpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(DpcApi::class.java)
    }

    val errorAdapter = moshi.adapter(ApiError::class.java)
    val resultAdapter = moshi.adapter(CommandResultDto::class.java)
}

private class UserAgentInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder()
            .header("User-Agent", "Fluxion-DPC/${BuildConfig.VERSION_NAME}")
            .build()
        return chain.proceed(req)
    }
}
