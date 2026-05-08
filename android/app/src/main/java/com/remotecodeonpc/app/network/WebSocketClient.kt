package com.remotecodeonpc.app.network

import android.util.Log
import com.google.gson.Gson
import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.ServerConfig
import kotlinx.coroutines.*
import okhttp3.*
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

interface WebSocketListener {
    fun onConnected()
    fun onDisconnected()
    fun onMessage(type: String, data: Map<String, Any>)
    fun onError(error: String)
    fun onConnectionLost() {}
}

class WebSocketClient(private val config: ServerConfig) {
    private var webSocket: WebSocket? = null
    private var listener: WebSocketListener? = null
    private val gson = Gson()
    private var shouldReconnect = true
    private var reconnectJob: Job? = null
    private var retryCount = 0
    private var maxRetries = 5
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val client = OkHttpClient.Builder()
        .protocols(listOf(Protocol.HTTP_1_1))
        .dns(KeeneticCloudDns)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    fun connect(listener: WebSocketListener) {
        this.listener = listener
        shouldReconnect = true
        retryCount = 0
        doConnect()
    }

    private fun doConnect() {
        val baseWsUrl = ConnectionUrl.wsBase(config).trimEnd('/') + "/ws"
        val wsUrl = if (config.authToken.isNotBlank()) {
            "$baseWsUrl?token=${URLEncoder.encode(config.authToken, "UTF-8")}"
        } else {
            baseWsUrl
        }

        val logUrl = if (config.authToken.isNotBlank()) "$baseWsUrl?token=***" else baseWsUrl
        CrashLogger.d("WSClient", "Connecting to $logUrl (attempt ${retryCount + 1})")

        val request = Request.Builder()
            .url(wsUrl)
            .header("Cache-Control", "no-cache")
            .apply {
                if (config.authToken.isNotBlank()) {
                    addHeader("Authorization", "Bearer ${config.authToken}")
                }
            }
            .build()

        webSocket = client.newWebSocket(request, object : okhttp3.WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                CrashLogger.i("WSClient", "Connected to $logUrl (protocol=${response.protocol})")
                retryCount = 0 // сброс счётчика при успехе
                this@WebSocketClient.listener?.onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                CrashLogger.d("WSClient", "WS message received: ${text.take(200)}")
                try {
                    val json: Map<*, *> = gson.fromJson(text, Map::class.java) ?: emptyMap<Any, Any>()
                    val type = json["type"] as? String ?: "unknown"
                    val nestedData = json["data"] as? Map<*, *>
                    val data = nestedData?.let(::normalizePayloadMap) ?: normalizePayloadMap(json)
                    this@WebSocketClient.listener?.onMessage(type, data)
                } catch (e: Exception) {
                    CrashLogger.e("WSClient", "WS message parse error", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                CrashLogger.d("WSClient", "WS closing: code=$code reason=$reason")
                webSocket.close(1000, null)
                this@WebSocketClient.listener?.onDisconnected()
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                CrashLogger.d("WSClient", "WS closed: code=$code reason=$reason")
                this@WebSocketClient.listener?.onDisconnected()
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                CrashLogger.w("WSClient", "WS failure: ${t.message} (response=${response?.code})")
                this@WebSocketClient.listener?.onError(t.message ?: "Unknown error")
                this@WebSocketClient.listener?.onDisconnected()
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        retryCount++
        if (retryCount > maxRetries) {
            CrashLogger.w("WSClient", "Max reconnect attempts ($maxRetries) reached — connection lost")
            shouldReconnect = false
            listener?.onConnectionLost()
            return
        }
        reconnectJob?.cancel()
        // Экспоненциальный backoff: 2s → 4s → 8s → 15s → 30s (cap)
        val delayMs = minOf(2000L * (1 shl (retryCount.coerceAtMost(4))), 30000L)
        reconnectJob = scope.launch {
            delay(delayMs)
            if (shouldReconnect) {
                CrashLogger.d("WSClient", "Reconnecting (attempt $retryCount of $maxRetries)...")
                doConnect()
            }
        }
    }

    private fun normalizePayloadMap(raw: Map<*, *>): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        raw.forEach { (key, value) ->
            if (key is String && key != "type" && key != "timestamp" && value != null) {
                result[key] = value
            }
        }
        return result
    }

    fun disconnect() {
        CrashLogger.d("WSClient", "Disconnecting WS")
        shouldReconnect = false
        reconnectJob?.cancel()
        reconnectJob = null
        scope.cancel()
        webSocket?.close(1000, "Client closing")
        webSocket = null
    }
}
