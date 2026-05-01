package com.remotecodeonpc.app.network

import com.google.gson.Gson
import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.ServerConfig
import com.remotecodeonpc.app.StatusResponse
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object SimpleHttpClient {
    private val gson = Gson()

    fun getStatus(config: ServerConfig): StatusResponse {
        val baseUrl = if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            config.tunnelUrl.trimEnd('/')
        } else {
            "http://${config.host}:${config.port}"
        }
        val url = URL("$baseUrl/api/status")
        CrashLogger.d("SimpleHTTP", "GET $url")

        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8000
            readTimeout = 12000
            useCaches = false
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Accept-Encoding", "identity")
            setRequestProperty("Cache-Control", "no-cache")
            setRequestProperty("Connection", "close")
            if (config.authToken.isNotBlank()) {
                setRequestProperty("Authorization", "Bearer ${config.authToken}")
            }
        }

        try {
            val code = connection.responseCode
            CrashLogger.d("SimpleHTTP", "Status code=$code")
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).use { it.readText() }
            }.orEmpty()
            CrashLogger.d("SimpleHTTP", "Body ${body.take(300)}")
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code: ${body.take(200)}")
            }
            return gson.fromJson(body, StatusResponse::class.java)
        } finally {
            connection.disconnect()
        }
    }
}
