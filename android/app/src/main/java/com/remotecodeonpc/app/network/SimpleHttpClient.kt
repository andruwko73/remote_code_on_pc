package com.remotecodeonpc.app.network

import com.google.gson.Gson
import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.ServerConfig
import com.remotecodeonpc.app.StatusResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object SimpleHttpClient {
    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .dns(KeeneticCloudDns)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .build()

    fun getStatus(config: ServerConfig): StatusResponse {
        val baseUrl = ConnectionUrl.httpBase(config)
        val url = "$baseUrl/api/status"
        CrashLogger.d("SimpleHTTP", "GET $url")

        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .header("Cache-Control", "no-cache")
            .header("Connection", "close")
            .apply {
                if (config.authToken.isNotBlank()) {
                    header("Authorization", "Bearer ${config.authToken}")
                }
            }
            .build()

        client.newCall(request).execute().use { response ->
            val code = response.code
            CrashLogger.d("SimpleHTTP", "Status code=$code")
            val body = response.body?.string().orEmpty()
            CrashLogger.d("SimpleHTTP", "Body ${body.take(300)}")
            if (!response.isSuccessful) {
                throw IllegalStateException("HTTP $code: ${body.take(200)}")
            }
            return gson.fromJson(body, StatusResponse::class.java)
        }
    }
}
