package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.*
import okhttp3.OkHttpClient
import okhttp3.ConnectionPool
import okhttp3.Protocol
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

interface RemoteCodeApi {

    // Status
    @GET("/api/status")
    suspend fun getStatus(): Response<StatusResponse>

    // Folders
    @GET("/api/workspace/folders")
    suspend fun getFolders(): Response<FoldersResponse>

    @POST("/api/workspace/open")
    suspend fun openFolder(@Body body: Map<String, String>): Response<Map<String, Any>>

    @GET("/api/workspace/tree")
    suspend fun getFileTree(@Query("path") path: String): Response<FileTreeItem>

    @GET("/api/workspace/read-file")
    suspend fun readFile(@Query("path") path: String): Response<FileContent>

    // Chat
    @GET("/api/chat/agents")
    suspend fun getChatAgents(): Response<ChatAgentsResponse>

    @POST("/api/chat/send")
    suspend fun sendChatMessage(@Body body: Map<String, String>): Response<ChatSendResponse>

    @GET("/api/chat/history")
    suspend fun getChatHistory(@Query("chatId") chatId: String): Response<ChatHistoryResponse>

    @POST("/api/chat/select-agent")
    suspend fun selectAgent(@Body body: Map<String, String>): Response<SelectAgentResponse>

    @POST("/api/chat/new")
    suspend fun newChat(): Response<NewChatResponse>

    @GET("/api/chat/conversations")
    suspend fun getConversations(): Response<ConversationsResponse>

    // Diagnostics
    @GET("/api/diagnostics")
    suspend fun getDiagnostics(): Response<DiagnosticsResponse>

    // Terminal
    @POST("/api/terminal/exec")
    suspend fun execTerminal(@Body body: Map<String, String>): Response<Map<String, Any>>

    // ===== CODEX =====

    @GET("/api/codex/status")
    suspend fun getCodexStatus(): Response<CodexStatus>

    @POST("/api/codex/send")
    suspend fun sendCodexMessage(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<CodexSendResponse>

    @GET("/api/codex/history")
    suspend fun getCodexHistory(@Query("threadId") threadId: String? = null): Response<CodexHistoryResponse>

    @GET("/api/codex/events")
    suspend fun getCodexEvents(@Query("threadId") threadId: String? = null): Response<CodexEventsResponse>

    @POST("/api/codex/actions")
    suspend fun respondToCodexAction(@Body body: Map<String, String>): Response<CodexActionResponse>

    @GET("/api/codex/models")
    suspend fun getCodexModels(): Response<CodexModelsResponse>

    @POST("/api/codex/models")
    suspend fun selectCodexModel(@Body body: Map<String, String>): Response<CodexSelectModelResponse>

    @GET("/api/codex/threads")
    suspend fun getCodexThreads(): Response<CodexThreadsResponse>

    @POST("/api/codex/new")
    suspend fun newCodexThread(): Response<CodexHistoryResponse>

    @POST("/api/codex/delete")
    suspend fun deleteCodexThread(@Body body: Map<String, String>): Response<Map<String, Any>>

    @POST("/api/codex/launch")
    suspend fun launchCodex(): Response<CodexLaunchResponse>

    // ===== TUNNEL =====

    @GET("/api/tunnel/status")
    suspend fun getTunnelStatus(): Response<TunnelStatusResponse>

    @POST("/api/tunnel/start")
    suspend fun startTunnel(): Response<TunnelActionResponse>

    @POST("/api/tunnel/stop")
    suspend fun stopTunnel(): Response<TunnelActionResponse>
}

object ApiClient {
    private var currentConfig: ServerConfig? = null
    private var api: RemoteCodeApi? = null
    private var baseUrl: String = ""

    fun getApi(config: ServerConfig): RemoteCodeApi {
        if (api != null && currentConfig == config) {
            return api!!
        }

        currentConfig = config
        baseUrl = if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            config.tunnelUrl.trimEnd('/')
        } else {
            "http://${config.host}:${config.port}"
        }

        CrashLogger.d("ApiClient", "Building Retrofit: baseUrl=$baseUrl, useTunnel=${config.useTunnel}")

        val logging = HttpLoggingInterceptor { message ->
            CrashLogger.d("HTTP", message)
        }.apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val client = OkHttpClient.Builder()
            .protocols(listOf(Protocol.HTTP_1_1))
            .connectionPool(ConnectionPool(0, 1, TimeUnit.NANOSECONDS))
            .addInterceptor(logging)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("Connection", "close")
                    .header("Cache-Control", "no-cache")
                    .build()
                chain.proceed(request)
            }
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(35, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .apply {
                if (config.authToken.isNotBlank()) {
                    addInterceptor { chain ->
                        val request = chain.request().newBuilder()
                            .addHeader("Authorization", "Bearer ${config.authToken}")
                            .build()
                        chain.proceed(request)
                    }
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        api = retrofit.create(RemoteCodeApi::class.java)
        return api!!
    }

    fun getBaseUrl(): String = baseUrl
    fun reset() {
        api = null
        currentConfig = null
    }
}
