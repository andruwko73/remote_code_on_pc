package com.remotecodeonpc.app.network

import android.util.Log
import com.google.gson.Gson
import okhttp3.*
import java.util.concurrent.TimeUnit

interface WebSocketListener {
    fun onConnected()
    fun onDisconnected()
    fun onMessage(type: String, data: Map<String, Any>)
    fun onError(error: String)
}

class WebSocketClient(private val config: com.remotecodeonpc.app.ServerConfig) {
    private var webSocket: WebSocket? = null
    private var listener: WebSocketListener? = null
    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    fun connect(listener: WebSocketListener) {
        this.listener = listener
        val wsUrl = "ws://${config.host}:${config.port}"
        val request = Request.Builder()
            .url(wsUrl)
            .apply {
                if (config.authToken.isNotBlank()) {
                    addHeader("Authorization", "Bearer ${config.authToken}")
                }
            }
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d("WSClient", "Connected to $wsUrl")
                this@WebSocketClient.listener?.onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = gson.fromJson(text, Map::class.java) as Map<String, Any>
                    val type = json["type"] as? String ?: "unknown"
                    @Suppress("UNCHECKED_CAST")
                    this@WebSocketClient.listener?.onMessage(type, json as Map<String, Any>)
                } catch (e: Exception) {
                    Log.e("WSClient", "Parse error: ${e.message}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                this@WebSocketClient.listener?.onDisconnected()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("WSClient", "Error: ${t.message}")
                this@WebSocketClient.listener?.onError(t.message ?: "Unknown error")
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "Client closing")
        webSocket = null
    }
}
