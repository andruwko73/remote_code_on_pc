package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.*
import okhttp3.OkHttpClient
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
        baseUrl = "http://${config.host}:${config.port}"

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
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
            .baseUrl(baseUrl)
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
