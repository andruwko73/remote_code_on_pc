package com.remotecodeonpc.app.viewmodel

import android.app.Application
import android.content.Context
import com.google.gson.JsonParser
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.*
import com.remotecodeonpc.app.network.ApiClient
import com.remotecodeonpc.app.network.ConnectionUrl
import com.remotecodeonpc.app.network.SimpleHttpClient
import com.remotecodeonpc.app.network.WebSocketClient
import com.remotecodeonpc.app.network.WebSocketListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

data class AppUiState(
    // Connection
    val serverConfig: ServerConfig = ServerConfig(),
    val isConnected: Boolean = false,
    val isConnecting: Boolean = false,
    val connectionError: String? = null,
    val status: WorkspaceStatus? = null,
    val isWebSocketConnected: Boolean = false,

    // Tunnel
    val tunnelActive: Boolean = false,
    val tunnelUrl: String? = null,
    val tunnelProvider: String? = null,
    val localIp: String = "",
    val isTunnelStarting: Boolean = false,
    val tunnelError: String? = null,

    // Navigation
    val currentScreen: String = "codex",

    // Folders
    val folders: FoldersResponse? = null,
    val currentFiles: FileTreeItem? = null,
    val fileContent: FileContent? = null,
    val isLoadingFiles: Boolean = false,

    // Chat
    val chatAgents: List<ChatAgent> = emptyList(),
    val selectedAgent: String = "auto",
    val chatHistory: List<ChatMessage> = emptyList(),
    val conversations: List<ChatConversation> = emptyList(),
    val currentChatId: String = "default",
    val isChatLoading: Boolean = false,
    val chatError: String? = null,
    val isThinking: Boolean = false,

    // Diagnostics
    val diagnostics: DiagnosticsResponse? = null,

    // Terminal
    val terminalOutput: String = "",
    val isTerminalRunning: Boolean = false,

    // Codex
    val codexStatus: CodexStatus? = null,
    val codexModels: List<CodexModel> = emptyList(),
    val codexSelectedModel: String = "gpt-5.5",
    val codexReasoningEffort: String = "medium",
    val codexProfile: String = "user",
    val codexIncludeContext: Boolean = true,
    val codexChatHistory: List<CodexChatMessage> = emptyList(),
    val codexActionEvents: List<CodexActionEvent> = emptyList(),
    val codexSendResult: CodexSendResponse? = null,
    val codexThreads: List<CodexThread> = emptyList(),
    val codexProjects: List<CodexProject> = emptyList(),
    val currentCodexThreadId: String = "",
    val currentCodexProjectId: String = "",
    val isCodexLoading: Boolean = false,
    val codexError: String? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    private var wsClient: WebSocketClient? = null
    private var healthCheckJob: kotlinx.coroutines.Job? = null
    private var healthCheckFailures = 0

    init {
        loadSavedConfig()
    }

    private fun loadSavedConfig() {
        try {
            val prefs = getApplication<Application>()
                .getSharedPreferences("remote_code_prefs", Context.MODE_PRIVATE)
            val savedHost = prefs.getString("host", "") ?: ""
            val savedPort = prefs.getInt("port", 8799)
            val savedToken = prefs.getString("authToken", "") ?: ""
            val savedUseTunnel = prefs.getBoolean("useTunnel", false)
            val savedTunnelUrl = prefs.getString("tunnelUrl", "") ?: ""
            if (savedHost.isNotBlank() || savedTunnelUrl.isNotBlank() || savedToken.isNotBlank()) {
                _uiState.value = _uiState.value.copy(
                    serverConfig = ServerConfig(
                        host = savedHost,
                        port = savedPort,
                        authToken = savedToken,
                        useTunnel = savedUseTunnel,
                        tunnelUrl = savedTunnelUrl
                    )
                )
                CrashLogger.i("ViewModel", "Loaded saved config: $savedHost:$savedPort")
            }
        } catch (e: Exception) {
            CrashLogger.e("ViewModel", "Error loading saved config", e)
        }
    }

    private fun saveConfig(config: ServerConfig) {
        try {
            val prefs = getApplication<Application>()
                .getSharedPreferences("remote_code_prefs", Context.MODE_PRIVATE)
            prefs.edit()
                .putString("host", config.host)
                .putInt("port", config.port)
                .putString("authToken", config.authToken)
                .putBoolean("useTunnel", config.useTunnel)
                .putString("tunnelUrl", config.tunnelUrl)
                .apply()
            CrashLogger.d("ViewModel", "Config saved: ${config.host}:${config.port}")
        } catch (e: Exception) {
            CrashLogger.e("ViewModel", "Error saving config", e)
        }
    }

    private fun StatusResponse?.toWorkspaceStatus(): WorkspaceStatus {
        return WorkspaceStatus(
            version = this?.version ?: "",
            serverVersion = this?.serverVersion ?: "",
            appName = this?.appName ?: "",
            isRunning = this?.isRunning ?: false,
            platform = this?.platform ?: "",
            remoteCode = this?.remoteCode,
            workspace = this?.workspace,
            uptime = this?.uptime ?: 0.0,
            memoryUsage = this?.memoryUsage ?: 0
        )
    }

    private fun tokenRequiredError(status: StatusResponse?): String? {
        val remote = status?.remoteCode ?: return null
        return if (remote.authRequired && !remote.authOk) {
            "Требуется токен доступа. В VS Code откройте Remote Code on PC: Подключение, скопируйте токен и вставьте его в приложении."
        } else {
            null
        }
    }

    private fun applyConnectionStatus(status: StatusResponse?, connected: Boolean, error: String?) {
        val remote = status?.remoteCode
        _uiState.value = _uiState.value.copy(
            isConnected = connected,
            isConnecting = false,
            connectionError = error,
            status = status.toWorkspaceStatus(),
            localIp = remote?.localIp?.takeIf { it.isNotBlank() } ?: _uiState.value.localIp,
            tunnelActive = remote?.tunnelActive ?: _uiState.value.tunnelActive,
            tunnelUrl = remote?.publicUrl ?: remote?.tunnelUrl ?: _uiState.value.tunnelUrl,
            tunnelProvider = remote?.tunnelProvider ?: _uiState.value.tunnelProvider
        )
    }

    // ===== CONNECTION =====

    fun updateServerConfig(config: ServerConfig) {
        _uiState.value = _uiState.value.copy(serverConfig = config)
        saveConfig(config)
        ApiClient.reset()
    }

    fun connect() {
        val config = _uiState.value.serverConfig
        if (config.useTunnel && config.tunnelUrl.isBlank()) {
            _uiState.value = _uiState.value.copy(connectionError = "Введите публичный URL для внешней сети")
            return
        }
        if (config.useTunnel && isUnsupportedExternalUrl(config.tunnelUrl)) {
            _uiState.value = _uiState.value.copy(
                connectionError = "Этот публичный URL не подходит для подключения телефона. Укажите готовый HTTPS Keenetic/DDNS адрес из расширения."
            )
            return
        }
        if (config.useTunnel && config.authToken.isBlank()) {
            _uiState.value = _uiState.value.copy(
                connectionError = "Для внешней сети нужен токен доступа. Создайте или скопируйте токен в VS Code: Remote Code -> Подключение и вставьте его в приложении."
            )
            return
        }
        if (!config.useTunnel && config.host.isBlank()) {
            _uiState.value = _uiState.value.copy(connectionError = "Введите IP адрес ПК")
            return
        }

        _uiState.value = _uiState.value.copy(isConnecting = true, connectionError = null)

        CrashLogger.i("ViewModel", "connect() called: host=${config.host}, port=${config.port}")

        viewModelScope.launch {
            try {
                CrashLogger.d("ViewModel", "Building API client...")
                CrashLogger.d("ViewModel", "Calling getStatus()...")
                val response = getStatusWithRetries(config)
                CrashLogger.d("ViewModel", "Status response: code=${response.code()}")
                if (response.isSuccessful) {
                    val status = response.body()
                    CrashLogger.i("ViewModel", "Connected! status: version=${status?.version}")
                    val authError = tokenRequiredError(status)
                    applyConnectionStatus(status, authError == null, authError)
                    if (authError != null) return@launch
                    connectWebSocket()
                    loadFolders()
                    // Heavy history scans are loaded on demand to keep first paint fast.
                    loadDiagnostics()
                    loadCodexStatus()
                    loadCodexModels()
                    loadCodexThreads(loadCurrent = true)
                } else {
                    CrashLogger.w("ViewModel", "getStatus failed: code=${response.code()}, message=${response.message()}")
                    val errorText = if (response.code() == 401) {
                        "Требуется токен доступа. Скопируйте токен в VS Code: Remote Code on PC: Подключение."
                    } else {
                        formatConnectionError(config, "Ошибка ${response.code()}: ${response.message()}", response.code())
                    }
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        isConnected = false,
                        isWebSocketConnected = false,
                        connectionError = errorText,
                        tunnelActive = if (config.useTunnel) false else _uiState.value.tunnelActive,
                        tunnelError = if (config.useTunnel) errorText else _uiState.value.tunnelError
                    )
                }
            } catch (e: Exception) {
                CrashLogger.e("ViewModel", "connect() exception, trying simple HTTP fallback", e)
                try {
                    val status = withContext(Dispatchers.IO) { SimpleHttpClient.getStatus(config) }
                    CrashLogger.i("ViewModel", "Connected with simple HTTP fallback: version=${status.version}")
                    val authError = tokenRequiredError(status)
                    applyConnectionStatus(status, authError == null, authError)
                    if (authError != null) return@launch
                    connectWebSocket()
                    loadFolders()
                    // Heavy history scans are loaded on demand to keep first paint fast.
                    loadDiagnostics()
                    loadCodexStatus()
                    loadCodexModels()
                    loadCodexThreads(loadCurrent = true)
                } catch (fallbackError: Exception) {
                    CrashLogger.e("ViewModel", "simple HTTP fallback failed", fallbackError)
                    val errorText = formatConnectionError(config, fallbackError.message ?: e.message ?: "connection failed")
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        isConnected = false,
                        isWebSocketConnected = false,
                        connectionError = errorText,
                        tunnelActive = if (config.useTunnel) false else _uiState.value.tunnelActive,
                        tunnelError = if (config.useTunnel) errorText else _uiState.value.tunnelError
                    )
                }
            }
        }
    }

    private suspend fun getStatusWithRetries(config: ServerConfig): retrofit2.Response<StatusResponse> {
        val attempts = if (config.useTunnel) 6 else 1
        var lastResponse: retrofit2.Response<StatusResponse>? = null
        var lastError: Exception? = null
        repeat(attempts) { index ->
            try {
                val api = ApiClient.getApi(config)
                val response = api.getStatus()
                if (!config.useTunnel || response.isSuccessful || !isRetryableTunnelStatus(response.code())) {
                    return response
                }
                lastResponse = response
            } catch (e: Exception) {
                lastError = e
            }
            if (index < attempts - 1) {
                delay(if (index < 2) 1200 else 2200)
                ApiClient.reset()
            }
        }
        lastResponse?.let { return it }
        throw lastError ?: IllegalStateException("connection failed")
    }

    private fun isRetryableTunnelStatus(code: Int): Boolean = code == 502 || code == 503 || code == 530

    private fun isUnsupportedExternalUrl(raw: String): Boolean {
        return try {
            val trimmed = raw.trim()
            if (trimmed.isBlank()) return false
            val withScheme = when {
                trimmed.startsWith("http://", ignoreCase = true) ||
                    trimmed.startsWith("https://", ignoreCase = true) -> trimmed
                trimmed.startsWith("//") -> "http:$trimmed"
                else -> "http://$trimmed"
            }
            val host = java.net.URI(withScheme).host?.lowercase().orEmpty()
            host == "netcraze.io" || host.endsWith(".netcraze.io")
        } catch (_: Exception) {
            false
        }
    }

    private fun formatConnectionError(config: ServerConfig, raw: String, code: Int? = null): String {
        if (!config.useTunnel) return "Connection error: $raw"
        val lower = raw.lowercase()
        return when {
            "unexpected end of stream" in lower || "failed to connect" in lower ||
                "connection reset" in lower || "timeout" in lower || "timed out" in lower ->
                "Публичный URL не дал HTTP-ответ. Это не ошибка токена: проверьте KeenDNS/HTTPS-прокси или проброс TCP на IP ПК; затем повторите подключение."
            code == 530 || "http 530" in lower || "status code 530" in lower || "ошибка 530" in lower || "error 530" in lower ->
                "Публичный Keenetic URL доступен, но не доходит до ПК. Проверьте KeenDNS/HTTPS-прокси, IP ПК и что расширение запущено."
            code == 503 || code == 502 || "503" in lower || "bad gateway" in lower ->
                "Публичный адрес отвечает, но сервер Remote Code недоступен. Проверьте правило Keenetic и включенное расширение VS Code."
            "unable to resolve host" in lower || "no address associated" in lower || "failed to resolve" in lower ->
                "Публичный URL не резолвится DNS. Проверьте KeenDNS/DDNS адрес или вставьте полный HTTPS URL из расширения."
            else -> "Ошибка внешнего подключения: $raw"
        }
    }

    private fun connectWebSocket() {
        wsClient?.disconnect()
        wsClient = WebSocketClient(_uiState.value.serverConfig)
        wsClient?.connect(object : WebSocketListener {
            override fun onConnected() {
                healthCheckFailures = 0
                _uiState.value = _uiState.value.copy(isWebSocketConnected = true)
                startHealthCheck()
            }

            override fun onDisconnected() {
                // WebSocket may reconnect; do not reset isConnected.
                _uiState.value = _uiState.value.copy(isWebSocketConnected = false)
                // Stop health checks while reconnecting.
                healthCheckJob?.cancel()
                healthCheckJob = null
            }

            override fun onMessage(type: String, data: Map<String, Any>) {
                when (type) {
                    "diagnostics:update" -> {
                        viewModelScope.launch { loadDiagnostics() }
                    }
                    "chat:thinking" -> {
                        val chatId = data["chatId"] as? String ?: ""
                        _uiState.value = _uiState.value.copy(
                            isThinking = true,
                            currentChatId = if (chatId.isNotBlank()) chatId else _uiState.value.currentChatId
                        )
                    }
                    "chat:response" -> {
                        _uiState.value = _uiState.value.copy(isThinking = false)
                        viewModelScope.launch { loadChatHistory() }
                    }
                    "chat:agent-changed" -> {
                        val agentName = data["agentName"] as? String ?: return
                        _uiState.value = _uiState.value.copy(selectedAgent = agentName)
                    }
                    "chat:new" -> {
                        val currentChatId = data["currentChatId"] as? String ?: ""
                        _uiState.value = _uiState.value.copy(
                            currentChatId = currentChatId,
                            chatHistory = emptyList()
                        )
                        viewModelScope.launch { loadConversations() }
                    }
                    "status:update" -> {
                        val activeFile = data["activeFile"] as? String
                        _uiState.value = _uiState.value.copy(
                            status = _uiState.value.status?.copy(
                                workspace = _uiState.value.status?.workspace?.copy(
                                    activeFile = activeFile ?: "-"
                                )
                            )
                        )
                    }
                    "folders:update" -> {
                        viewModelScope.launch { loadFolders() }
                    }
                    "chat:sessions-update" -> {
                        // VS Code chats changed on the PC; refresh the list and history.
                        viewModelScope.launch {
                            loadConversations()
                        }
                    }
                    "codex:sent" -> {
                        // A Codex request was sent; refresh status.
                        val threadId = data["threadId"] as? String
                        _uiState.value = _uiState.value.copy(isCodexLoading = true)
                        viewModelScope.launch {
                            loadCodexStatus()
                            loadCodexThreads(loadCurrent = false)
                            loadCodexEvents(threadId)
                        }
                    }
                    "codex:model-changed" -> {
                        val model = data["model"] as? String ?: return
                        _uiState.value = _uiState.value.copy(codexSelectedModel = model)
                    }
                    "codex:preferences-changed" -> {
                        val model = data["model"] as? String
                        val effort = data["reasoningEffort"] as? String
                        val profile = data["profile"] as? String
                        val includeContext = data["includeContext"] as? Boolean
                        _uiState.value = _uiState.value.copy(
                            codexSelectedModel = model?.takeIf { it.isNotBlank() }
                                ?: _uiState.value.codexSelectedModel,
                            codexReasoningEffort = effort?.takeIf { it in listOf("low", "medium", "high", "xhigh") }
                                ?: _uiState.value.codexReasoningEffort,
                            codexProfile = profile?.takeIf { it in listOf("user", "review", "fast") }
                                ?: _uiState.value.codexProfile,
                            codexIncludeContext = includeContext ?: _uiState.value.codexIncludeContext
                        )
                    }
                    "codex:message", "codex:thinking", "codex:response" -> {
                        val threadId = data["threadId"] as? String
                        if (!threadId.isNullOrBlank() && threadId != _uiState.value.currentCodexThreadId) {
                            _uiState.value = _uiState.value.copy(
                                currentCodexThreadId = threadId,
                                codexChatHistory = emptyList(),
                                codexActionEvents = emptyList()
                            )
                        }
                        val messageMap = data["message"] as? Map<*, *>
                        val message = messageMap?.toCodexChatMessage()
                        if (message != null) {
                            upsertCodexMessage(message)
                            _uiState.value = _uiState.value.copy(isCodexLoading = message.isStreaming)
                        } else {
                            viewModelScope.launch {
                                loadCodexHistory(threadId)
                                loadCodexEvents(threadId)
                            }
                        }
                    }
                    "codex:chunk" -> {
                        val messageId = data["messageId"] as? String ?: return
                        val content = data["content"] as? String ?: return
                        val timestamp = (data["timestamp"] as? Double)?.toLong()
                            ?: (data["timestamp"] as? Long)
                            ?: System.currentTimeMillis()
                        updateCodexStreamingMessage(messageId, content, timestamp)
                        _uiState.value = _uiState.value.copy(isCodexLoading = true)
                    }
                    "codex:message-deleted" -> {
                        val threadId = data["threadId"] as? String
                        val messageId = data["messageId"] as? String
                        @Suppress("UNCHECKED_CAST")
                        val messages = (data["messages"] as? List<Map<*, *>>)
                            ?.mapNotNull { it.toCodexChatMessage() }
                        _uiState.value = _uiState.value.copy(
                            codexChatHistory = messages
                                ?: _uiState.value.codexChatHistory.filterNot { it.id == messageId },
                            codexError = null
                        )
                        if (!threadId.isNullOrBlank()) {
                            viewModelScope.launch { loadCodexEvents(threadId) }
                        }
                    }
                    "codex:sessions-update" -> {
                        viewModelScope.launch {
                            loadCodexThreads(loadCurrent = false)
                        }
                    }
                    "codex:threads-update" -> {
                        val currentThreadId = data["currentThreadId"] as? String
                        if (!currentThreadId.isNullOrBlank()) {
                            _uiState.value = _uiState.value.copy(
                                currentCodexThreadId = currentThreadId,
                                codexChatHistory = emptyList(),
                                codexActionEvents = emptyList(),
                                codexSendResult = null
                            )
                        }
                        viewModelScope.launch {
                            loadCodexThreads(loadCurrent = !currentThreadId.isNullOrBlank())
                        }
                    }
                    "codex:approval-request", "codex:action-update" -> {
                        val threadId = data["threadId"] as? String
                        val event = (data["event"] as? Map<*, *>)?.toCodexActionEvent()
                        @Suppress("UNCHECKED_CAST")
                        val events = (data["events"] as? List<Map<*, *>>)?.mapNotNull { it.toCodexActionEvent() }
                        when {
                            events != null -> _uiState.value = _uiState.value.copy(
                                currentCodexThreadId = threadId ?: _uiState.value.currentCodexThreadId,
                                codexActionEvents = events
                            )
                            event != null -> upsertCodexActionEvent(event, threadId)
                            else -> viewModelScope.launch { loadCodexEvents(threadId) }
                        }
                        viewModelScope.launch { loadCodexHistory(threadId) }
                    }
                    "codex:managed-status" -> {
                        viewModelScope.launch {
                            loadCodexThreads(loadCurrent = false)
                        }
                    }
                    "connected" -> {
                        @Suppress("UNCHECKED_CAST")
                        val stateMap = data["state"] as? Map<String, Any>
                        if (stateMap != null) {
                            val agent = stateMap["selectedAgent"] as? String
                            val chatId = stateMap["currentChatId"] as? String
                            if (agent != null) {
                                _uiState.value = _uiState.value.copy(
                                    selectedAgent = agent,
                                    currentChatId = chatId ?: _uiState.value.currentChatId
                                )
                            }
                            viewModelScope.launch {
                                loadFolders()
                                loadCodexStatus()
                                loadCodexThreads(loadCurrent = true)
                            }
                        }
                    }
                }
            }

            override fun onError(error: String) {
                // Log WebSocket errors.
                android.util.Log.d("WSClient", "WS error: $error")
            }

            override fun onConnectionLost() {
                CrashLogger.w("ViewModel", "WS connection lost; keeping HTTP session active")
                wsClient = null
                _uiState.value = _uiState.value.copy(isWebSocketConnected = false)
            }
        })
    }

    fun disconnect() {
        val savedConfig = _uiState.value.serverConfig
        healthCheckJob?.cancel()
        healthCheckJob = null
        wsClient?.disconnect()
        wsClient = null
        ApiClient.reset()
        _uiState.value = AppUiState().copy(serverConfig = savedConfig)
    }

    // ===== HEALTH CHECK =====

    private fun startHealthCheck() {
        healthCheckJob?.cancel()
        healthCheckJob = viewModelScope.launch {
            while (true) {
                delay(60000) // keep the bridge light; UI actions refresh data on demand
                if (!_uiState.value.isConnected) break
                try {
                    val api = ApiClient.getApi(_uiState.value.serverConfig)
                    val response = api.getStatus()
                    if (!response.isSuccessful) {
                        CrashLogger.w("ViewModel", "Health-check failed: ${response.code()}")
                        onHealthCheckFailed()
                    }
                } catch (e: Exception) {
                    CrashLogger.w("ViewModel", "Health-check network error: ${e.message}")
                    onHealthCheckFailed()
                }
            }
        }
    }

    private fun onHealthCheckFailed() {
        if (!_uiState.value.isConnected) return
        healthCheckFailures++
        CrashLogger.w("ViewModel", "Health-check failure $healthCheckFailures; keeping current screen")
        _uiState.value = _uiState.value.copy(isWebSocketConnected = false)
        if (healthCheckFailures >= 3) {
            wsClient?.disconnect()
            wsClient = null
            connectWebSocket()
            healthCheckFailures = 0
        }
    }

    // ===== FOLDERS =====

    fun loadFolders() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getFolders()
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        folders = response.body()
                    )
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun loadFileTree(path: String) {
        _uiState.value = _uiState.value.copy(isLoadingFiles = true)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getFileTree(path)
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        currentFiles = response.body(),
                        isLoadingFiles = false
                    )
                } else {
                    _uiState.value = _uiState.value.copy(isLoadingFiles = false)
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoadingFiles = false)
            }
        }
    }

    fun loadFileContent(path: String) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.readFile(path)
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        fileContent = response.body()
                    )
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun openFolder(path: String) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.openFolder(mapOf("path" to path))
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    // ===== CHAT =====

    fun loadChatAgents() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getChatAgents()
                if (response.isSuccessful) {
                    val body = response.body()
                    _uiState.value = _uiState.value.copy(
                        chatAgents = body?.agents ?: emptyList(),
                        selectedAgent = body?.selected ?: "auto",
                        currentChatId = body?.currentChatId ?: "default"
                    )
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun loadChatHistory(chatId: String? = null) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val id = chatId ?: _uiState.value.currentChatId
                val response = api.getChatHistory(id)
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        chatHistory = response.body()?.messages ?: emptyList(),
                        currentChatId = response.body()?.chatId?.takeIf { it.isNotBlank() } ?: id
                    )
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun loadConversations() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getConversations()
                if (response.isSuccessful) {
                    val body = response.body()
                    val conversations = body?.conversations ?: emptyList()
                    val current = _uiState.value.currentChatId
                    val nextCurrent = when {
                        conversations.any { it.id == current } -> current
                        body?.current?.isNotBlank() == true && conversations.any { it.id == body.current } -> body.current
                        else -> conversations.firstOrNull()?.id ?: "default"
                    }
                    _uiState.value = _uiState.value.copy(
                        conversations = conversations,
                        currentChatId = nextCurrent,
                        chatHistory = if (conversations.isEmpty()) emptyList() else _uiState.value.chatHistory
                    )
                    if (conversations.isNotEmpty() && nextCurrent != current) {
                        loadChatHistory(nextCurrent)
                    }
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun sendChatMessage(text: String) {
        _uiState.value = _uiState.value.copy(isChatLoading = true, chatError = null)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.sendChatMessage(mapOf(
                    "message" to text,
                    "chatId" to _uiState.value.currentChatId,
                    "agentName" to _uiState.value.selectedAgent
                ))
                if (response.isSuccessful) {
                    loadChatHistory()
                } else {
                    _uiState.value = _uiState.value.copy(
                        chatError = "Ошибка ${response.code()}"
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    chatError = "Ошибка: ${e.message}"
                )
            } finally {
                _uiState.value = _uiState.value.copy(isChatLoading = false)
            }
        }
    }

    fun selectAgent(agentName: String) {
        _uiState.value = _uiState.value.copy(selectedAgent = agentName)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.selectAgent(mapOf("agentName" to agentName))
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun newChat() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.newChat()
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        currentChatId = response.body()?.chatId ?: "",
                        chatHistory = emptyList()
                    )
                    loadConversations()
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    fun switchToChat(chatId: String) {
        _uiState.value = _uiState.value.copy(currentChatId = chatId)
        loadChatHistory(chatId)
    }

    // ===== DIAGNOSTICS =====

    fun loadDiagnostics() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getDiagnostics()
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        diagnostics = response.body()
                    )
                }
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    private fun List<CodexChatMessage>.dedupeCodexMessages(): List<CodexChatMessage> {
        val result = mutableListOf<CodexChatMessage>()
        for (message in sortedBy { it.timestamp }) {
            val duplicateIndex = result.indexOfLast { existing -> existing.isDuplicateCodexMessage(message) }
            if (duplicateIndex >= 0) {
                result[duplicateIndex] = preferCodexMessage(result[duplicateIndex], message)
            } else {
                result.add(message)
            }
        }
        return result.sortedBy { it.timestamp }
    }

    private fun CodexChatMessage.isDuplicateCodexMessage(other: CodexChatMessage): Boolean {
        if (id.isNotBlank() && other.id.isNotBlank() && id == other.id) return true
        if (role != other.role) return false
        if (normalizedCodexContent() != other.normalizedCodexContent()) return false
        if (normalizedCodexContent().isBlank()) return false
        if (attachmentKey() != other.attachmentKey()) return false
        if (changeSummaryKey() != other.changeSummaryKey()) return false

        val oneIsOptimistic = id.startsWith("mobile_user_") || other.id.startsWith("mobile_user_")
        val oneIsStreaming = isStreaming || other.isStreaming ||
            id.contains("stream", ignoreCase = true) ||
            other.id.contains("stream", ignoreCase = true)
        if (oneIsOptimistic || oneIsStreaming) return true

        val distance = if (timestamp > 0L && other.timestamp > 0L) abs(timestamp - other.timestamp) else 0L
        return distance <= 30_000L
    }

    private fun CodexChatMessage.normalizedCodexContent(): String =
        content.trim().replace(Regex("\\s+"), " ")

    private fun CodexChatMessage.attachmentKey(): String =
        attachments.joinToString("|") { "${it.name}:${it.mimeType}:${it.size}" }

    private fun CodexChatMessage.changeSummaryKey(): String =
        changeSummary?.files
            ?.joinToString("|") { "${it.path}:${it.additions}:${it.deletions}" }
            ?: ""

    private fun preferCodexMessage(first: CodexChatMessage, second: CodexChatMessage): CodexChatMessage {
        return listOf(first, second).maxWith(
            compareBy<CodexChatMessage>(
                { if (it.id.startsWith("mobile_user_")) 0 else 1 },
                { if (it.isStreaming) 0 else 1 },
                { if (it.changeSummary != null) 1 else 0 },
                { it.attachments.size },
                { it.content.length },
                { it.timestamp }
            )
        )
    }

    private fun upsertCodexMessage(message: CodexChatMessage) {
        val current = _uiState.value.codexChatHistory.toMutableList()
        val index = current.indexOfFirst { it.id == message.id }
        if (index >= 0) {
            current[index] = message
        } else {
            current.add(message)
        }
        _uiState.value = _uiState.value.copy(codexChatHistory = current.dedupeCodexMessages().takeLast(120))
    }

    private fun updateCodexStreamingMessage(messageId: String, content: String, timestamp: Long) {
        val current = _uiState.value.codexChatHistory.toMutableList()
        val index = current.indexOfFirst { it.id == messageId }
        if (index >= 0) {
            current[index] = current[index].copy(
                content = content,
                timestamp = timestamp,
                isStreaming = true
            )
        } else {
            current.add(
                CodexChatMessage(
                    id = messageId,
                    role = "assistant",
                    content = content,
                    timestamp = timestamp,
                    isStreaming = true
                )
            )
        }
        _uiState.value = _uiState.value.copy(codexChatHistory = current.dedupeCodexMessages().takeLast(120))
    }

    private fun Map<*, *>.toCodexChatMessage(): CodexChatMessage {
        return CodexChatMessage(
            id = this["id"] as? String ?: "",
            role = this["role"] as? String ?: "",
            content = this["content"] as? String ?: "",
            timestamp = (this["timestamp"] as? Double)?.toLong()
                ?: (this["timestamp"] as? Long)
                ?: 0L,
            model = this["model"] as? String,
            reasoningEffort = this["reasoningEffort"] as? String,
            isStreaming = this["isStreaming"] as? Boolean ?: false,
            changeSummary = (this["changeSummary"] as? Map<*, *>)?.toCodexChangeSummary(),
            attachments = (this["attachments"] as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.toMessageAttachment() } ?: emptyList()
        )
    }

    private fun Map<*, *>.toMessageAttachment(): MessageAttachment {
        val rawPath = this["path"] as? String
        val fallbackName = rawPath
            ?.replace("\\", "/")
            ?.substringAfterLast("/")
            ?.takeIf { it.isNotBlank() }
            ?: "attachment"
        return MessageAttachment(
            name = this["name"] as? String ?: fallbackName,
            mimeType = this["mimeType"] as? String ?: "application/octet-stream",
            size = (this["size"] as? Double)?.toLong()
                ?: (this["size"] as? Long)
                ?: (this["size"] as? Int)?.toLong()
                ?: 0L,
            base64 = this["base64"] as? String ?: ""
        )
    }

    private fun Map<*, *>.toCodexChangeSummary(): CodexChangeSummary {
        @Suppress("UNCHECKED_CAST")
        val rawFiles = this["files"] as? List<Map<*, *>> ?: emptyList()
        val files = rawFiles.map { file ->
            CodexChangeFile(
                path = file["path"] as? String ?: "",
                additions = (file["additions"] as? Double)?.toInt() ?: (file["additions"] as? Int) ?: 0,
                deletions = (file["deletions"] as? Double)?.toInt() ?: (file["deletions"] as? Int) ?: 0
            )
        }.filter { it.path.isNotBlank() }
        return CodexChangeSummary(
            commit = this["commit"] as? String,
            cwd = this["cwd"] as? String,
            files = files,
            additions = (this["additions"] as? Double)?.toInt() ?: (this["additions"] as? Int) ?: files.sumOf { it.additions },
            deletions = (this["deletions"] as? Double)?.toInt() ?: (this["deletions"] as? Int) ?: files.sumOf { it.deletions }
        )
    }

    private fun Map<*, *>.toCodexActionEvent(): CodexActionEvent? {
        val id = this["id"] as? String ?: return null
        return CodexActionEvent(
            id = id,
            type = this["type"] as? String ?: "",
            title = this["title"] as? String ?: "",
            detail = this["detail"] as? String ?: this["diff"] as? String ?: "",
            status = this["status"] as? String ?: "",
            timestamp = (this["timestamp"] as? Double)?.toLong()
                ?: (this["timestamp"] as? Long)
                ?: System.currentTimeMillis(),
            callId = this["callId"] as? String,
            source = this["source"] as? String,
            actionable = this["actionable"] as? Boolean ?: false
        )
    }

    private fun upsertCodexActionEvent(event: CodexActionEvent, threadId: String?) {
        val current = _uiState.value.codexActionEvents
        val next = if (current.any { it.id == event.id }) {
            current.map { if (it.id == event.id) event else it }
        } else {
            current + event
        }.takeLast(80)
        _uiState.value = _uiState.value.copy(
            currentCodexThreadId = threadId ?: _uiState.value.currentCodexThreadId,
            codexActionEvents = next
        )
    }

    // ===== TERMINAL =====

    fun clearTerminal() {
        _uiState.value = _uiState.value.copy(terminalOutput = "")
    }

    fun execTerminal(command: String) {
        _uiState.value = _uiState.value.copy(isTerminalRunning = true)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.execTerminal(mapOf("command" to command))
                if (response.isSuccessful) {
                    val body = response.body()
                    val output = body?.get("output") as? String ?: "Команда отправлена: $command"
                    val pendingApproval = body?.get("pendingApproval") as? Boolean ?: false
                    val displayOutput = if (pendingApproval) {
                        "Команда ожидает подтверждения в чате Codex."
                    } else {
                        output
                    }
                    val currentOutput = _uiState.value.terminalOutput
                    _uiState.value = _uiState.value.copy(
                        terminalOutput = currentOutput + "\n> $command\n$displayOutput\n",
                        isTerminalRunning = false
                    )
                } else {
                    val currentOutput = _uiState.value.terminalOutput
                    _uiState.value = _uiState.value.copy(
                        terminalOutput = currentOutput + "\n> $command\nОшибка ${response.code()}\n",
                        isTerminalRunning = false
                    )
                }
            } catch (e: Exception) {
                val currentOutput = _uiState.value.terminalOutput
                _uiState.value = _uiState.value.copy(
                    terminalOutput = currentOutput + "\n> $command\nОшибка: ${e.message}\n",
                    isTerminalRunning = false
                )
            }
        }
    }

    // ===== CODEX =====

    fun loadCodexStatus() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getCodexStatus()
                if (response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(
                        codexStatus = response.body()
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun loadCodexHistory(threadId: String? = null) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val selectedThreadId = threadId ?: _uiState.value.currentCodexThreadId.takeIf { it.isNotBlank() }
                val response = api.getCodexHistory(selectedThreadId)
                if (response.isSuccessful) {
                    val body = response.body()
                    val serverMessages = body?.messages ?: emptyList()
                    val localPending = _uiState.value.codexChatHistory.filter { local ->
                        local.id.startsWith("mobile_user_") &&
                            serverMessages.none { server ->
                                server.role == local.role && server.content == local.content
                            }
                    }
                    _uiState.value = _uiState.value.copy(
                        codexChatHistory = (serverMessages + localPending)
                            .dedupeCodexMessages()
                            .takeLast(120),
                        currentCodexThreadId = body?.threadId?.takeIf { it.isNotBlank() }
                            ?: selectedThreadId
                            ?: _uiState.value.currentCodexThreadId,
                        codexError = null
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun loadCodexEvents(threadId: String? = null) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val selectedThreadId = threadId ?: _uiState.value.currentCodexThreadId.takeIf { it.isNotBlank() }
                val response = api.getCodexEvents(selectedThreadId)
                if (response.isSuccessful) {
                    val body = response.body()
                    _uiState.value = _uiState.value.copy(
                        codexActionEvents = body?.events ?: emptyList(),
                        currentCodexThreadId = body?.threadId?.takeIf { it.isNotBlank() }
                            ?: selectedThreadId
                            ?: _uiState.value.currentCodexThreadId,
                        codexError = null
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun loadCodexModels() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getCodexModels()
                if (response.isSuccessful) {
                    val body = response.body()
                    _uiState.value = _uiState.value.copy(
                        codexModels = body?.models ?: emptyList(),
                        codexSelectedModel = body?.selected?.takeIf { it.isNotBlank() } ?: "gpt-5.5",
                        codexReasoningEffort = body?.reasoningEffort ?: _uiState.value.codexReasoningEffort,
                        codexProfile = body?.profile?.takeIf { it in listOf("user", "review", "fast") }
                            ?: _uiState.value.codexProfile,
                        codexIncludeContext = body?.includeContext ?: _uiState.value.codexIncludeContext
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun selectCodexModel(modelId: String) {
        _uiState.value = _uiState.value.copy(codexSelectedModel = modelId)
        syncCodexComposerPreferences()
    }

    fun selectCodexReasoningEffort(effort: String) {
        val normalized = when (effort) {
            "low", "medium", "high", "xhigh" -> effort
            else -> "medium"
        }
        _uiState.value = _uiState.value.copy(codexReasoningEffort = normalized)
        syncCodexComposerPreferences()
    }

    fun selectCodexProfile(profile: String) {
        val normalized = when (profile) {
            "user", "review", "fast" -> profile
            else -> "user"
        }
        _uiState.value = _uiState.value.copy(codexProfile = normalized)
        syncCodexComposerPreferences()
    }

    fun toggleCodexContext() {
        _uiState.value = _uiState.value.copy(codexIncludeContext = !_uiState.value.codexIncludeContext)
        syncCodexComposerPreferences()
    }

    private fun syncCodexComposerPreferences() {
        viewModelScope.launch {
            try {
                val state = _uiState.value
                val api = ApiClient.getApi(state.serverConfig)
                api.selectCodexModel(
                    mapOf(
                        "modelId" to state.codexSelectedModel,
                        "reasoningEffort" to state.codexReasoningEffort,
                        "profile" to state.codexProfile,
                        "includeContext" to state.codexIncludeContext
                    )
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun sendCodexMessage(text: String, attachments: List<MessageAttachment> = emptyList()) {
        val sentAt = System.currentTimeMillis()
        val optimisticMessage = CodexChatMessage(
            id = "mobile_user_$sentAt",
            role = "user",
            content = text,
            timestamp = sentAt,
            model = _uiState.value.codexSelectedModel.takeIf { it.isNotBlank() },
            reasoningEffort = _uiState.value.codexReasoningEffort,
            includeContext = _uiState.value.codexIncludeContext,
            attachments = attachments
        )
        _uiState.value = _uiState.value.copy(
            isCodexLoading = true,
            codexError = null,
            codexChatHistory = (_uiState.value.codexChatHistory + optimisticMessage)
                .dedupeCodexMessages()
                .takeLast(120)
        )
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val threadId = _uiState.value.currentCodexThreadId.takeIf { current ->
                    current.isNotBlank() && _uiState.value.codexThreads.any { it.id == current }
                } ?: _uiState.value.codexThreads.firstOrNull()?.id.orEmpty()
                val response = api.sendCodexMessage(
                    mapOf(
                        "message" to text,
                        "model" to _uiState.value.codexSelectedModel,
                        "reasoningEffort" to _uiState.value.codexReasoningEffort,
                        "profile" to _uiState.value.codexProfile,
                        "includeContext" to _uiState.value.codexIncludeContext,
                        "threadId" to threadId,
                        "attachments" to attachments
                    )
                )
                if (response.isSuccessful) {
                    val body = response.body()
                    val nextThreadId = body?.threadId?.takeIf { it.isNotBlank() } ?: threadId
                    _uiState.value = _uiState.value.copy(
                        codexSendResult = body,
                        currentCodexThreadId = nextThreadId,
                        isCodexLoading = true
                    )
                    loadCodexThreads(loadCurrent = true)
                    loadCodexEvents(nextThreadId)
                } else {
                    _uiState.value = _uiState.value.copy(
                        codexError = "Ошибка ${response.code()}",
                        isCodexLoading = false
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    codexError = "Ошибка: ${e.message}",
                    isCodexLoading = false
                )
            }
        }
    }
    fun loadCodexThreads(loadCurrent: Boolean = false) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getCodexThreads()
                if (response.isSuccessful) {
                    val body = response.body()
                    val threads = body?.threads ?: emptyList()
                    val projects = body?.projects?.takeIf { it.isNotEmpty() } ?: buildCodexProjects(threads)
                    val current = _uiState.value.currentCodexThreadId
                    val nextCurrent = when {
                        threads.any { it.id == current } -> current
                        body?.currentThreadId?.isNotBlank() == true && threads.any { it.id == body.currentThreadId } -> body.currentThreadId
                        else -> threads.firstOrNull()?.id ?: ""
                    }
                    val nextProject = body?.currentProjectId
                        ?.takeIf { id -> id.isNotBlank() && projects.any { it.id == id } }
                        ?: selectedProjectIdForThread(nextCurrent, projects, threads)
                    _uiState.value = _uiState.value.copy(
                        codexThreads = threads,
                        codexProjects = projects,
                        currentCodexThreadId = nextCurrent,
                        currentCodexProjectId = nextProject,
                        codexChatHistory = if (threads.isEmpty()) emptyList() else _uiState.value.codexChatHistory,
                        codexActionEvents = if (threads.isEmpty()) emptyList() else _uiState.value.codexActionEvents,
                        codexError = null
                    )
                    if (loadCurrent && nextCurrent.isNotBlank()) {
                        loadCodexHistory(nextCurrent)
                        loadCodexEvents(nextCurrent)
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    private fun selectedProjectIdForThread(
        threadId: String,
        projects: List<CodexProject>,
        threads: List<CodexThread>
    ): String {
        projects.firstOrNull { project -> project.threads.any { it.id == threadId } }?.let { return it.id }
        threads.firstOrNull { it.id == threadId }?.let { thread ->
            thread.projectId?.takeIf { it.isNotBlank() }?.let { return it }
            val key = codexProjectKey(thread.projectId, thread.workspaceName, thread.workspacePath)
            if (key.isNotBlank()) return key
        }
        return projects.firstOrNull()?.id.orEmpty()
    }

    private fun buildCodexProjects(threads: List<CodexThread>): List<CodexProject> {
        return threads
            .groupBy { codexProjectKey(it.projectId, it.workspaceName, it.workspacePath) }
            .map { (id, groupedThreads) ->
                val first = groupedThreads.firstOrNull()
                CodexProject(
                    id = id.ifBlank { "unassigned" },
                    name = codexProjectName(first?.workspaceName, first?.workspacePath),
                    path = first?.workspacePath,
                    threadCount = groupedThreads.size,
                    timestamp = groupedThreads.maxOfOrNull { it.timestamp } ?: 0,
                    threads = groupedThreads.sortedByDescending { it.timestamp }
                )
            }
            .sortedByDescending { it.timestamp }
    }

    private fun codexProjectKey(projectId: String?, workspaceName: String?, workspacePath: String?): String {
        projectId?.trim()?.takeIf { it.isNotBlank() }?.let { return it }
        val path = workspacePath
            ?.trim()
            ?.replace('\\', '/')
            ?.trimEnd('/')
            ?.takeIf { it.isNotBlank() }
        if (path != null) return "path:${path.lowercase()}"
        val name = workspaceName?.trim()?.takeIf { it.isNotBlank() }
        return name?.let { "name:${it.lowercase()}" } ?: "unassigned"
    }

    private fun codexProjectName(workspaceName: String?, workspacePath: String?): String {
        return workspaceName?.trim()?.takeIf { it.isNotBlank() }
            ?: workspacePath
                ?.replace('\\', '/')
                ?.trimEnd('/')
                ?.substringAfterLast('/')
                ?.takeIf { it.isNotBlank() }
            ?: "Без проекта"
    }

    fun switchCodexThread(threadId: String) {
        val nextProjectId = selectedProjectIdForThread(threadId, _uiState.value.codexProjects, _uiState.value.codexThreads)
        _uiState.value = _uiState.value.copy(
            currentCodexThreadId = threadId,
            currentCodexProjectId = nextProjectId,
            codexChatHistory = emptyList(),
            codexActionEvents = emptyList(),
            codexError = null
        )
        loadCodexHistory(threadId)
        loadCodexEvents(threadId)
    }

    fun newCodexThread() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.newCodexThread()
                if (response.isSuccessful) {
                    val body = response.body()
                    _uiState.value = _uiState.value.copy(
                        currentCodexThreadId = body?.threadId.orEmpty(),
                        codexChatHistory = body?.messages ?: emptyList(),
                        codexActionEvents = emptyList(),
                        codexSendResult = null,
                        codexError = null
                    )
                    loadCodexThreads(loadCurrent = false)
                } else {
                    _uiState.value = _uiState.value.copy(codexError = "New chat failed: ${response.code()}")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun deleteCodexThread(threadId: String) {
        if (threadId.isBlank()) return
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.deleteCodexThread(mapOf("threadId" to threadId))
                if (response.isSuccessful) {
                    val remaining = _uiState.value.codexThreads.filterNot { it.id == threadId }
                    val remainingProjects = buildCodexProjects(remaining)
                    val nextCurrent = when {
                        _uiState.value.currentCodexThreadId != threadId -> _uiState.value.currentCodexThreadId
                        else -> remaining.firstOrNull()?.id.orEmpty()
                    }
                    val nextProject = selectedProjectIdForThread(nextCurrent, remainingProjects, remaining)
                    _uiState.value = _uiState.value.copy(
                        codexThreads = remaining,
                        codexProjects = remainingProjects,
                        currentCodexThreadId = nextCurrent,
                        currentCodexProjectId = nextProject,
                        codexChatHistory = if (nextCurrent.isBlank()) emptyList() else _uiState.value.codexChatHistory,
                        codexActionEvents = if (nextCurrent.isBlank()) emptyList() else _uiState.value.codexActionEvents,
                        codexError = null
                    )
                    loadCodexThreads(loadCurrent = nextCurrent.isNotBlank())
                } else {
                    _uiState.value = _uiState.value.copy(codexError = "Delete chat failed: ${response.code()}")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun deleteCodexMessage(messageId: String) {
        if (messageId.isBlank()) return
        val threadId = _uiState.value.currentCodexThreadId
        _uiState.value = _uiState.value.copy(
            codexChatHistory = _uiState.value.codexChatHistory.filterNot { it.id == messageId },
            codexError = null
        )
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.codexMessageAction(
                    mapOf(
                        "action" to "delete",
                        "threadId" to threadId,
                        "messageId" to messageId
                    )
                )
                if (response.isSuccessful) {
                    response.body()?.messages?.let { messages ->
                        _uiState.value = _uiState.value.copy(
                            codexChatHistory = messages.dedupeCodexMessages().takeLast(120),
                            codexError = null
                        )
                    }
                } else {
                    loadCodexHistory(threadId)
                    _uiState.value = _uiState.value.copy(codexError = "Delete message failed: ${response.code()}")
                }
            } catch (e: Exception) {
                loadCodexHistory(threadId)
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun regenerateCodexMessage(messageId: String) {
        if (messageId.isBlank() || _uiState.value.isCodexLoading) return
        val threadId = _uiState.value.currentCodexThreadId
        _uiState.value = _uiState.value.copy(isCodexLoading = true, codexError = null)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.codexMessageAction(
                    mapOf(
                        "action" to "regenerate",
                        "threadId" to threadId,
                        "messageId" to messageId
                    )
                )
                if (response.isSuccessful && response.body()?.success == true) {
                    loadCodexHistory(threadId)
                    loadCodexEvents(threadId)
                } else {
                    _uiState.value = _uiState.value.copy(
                        isCodexLoading = false,
                        codexError = response.body()?.error ?: "Regenerate failed: ${response.code()}"
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isCodexLoading = false, codexError = e.message)
            }
        }
    }

    fun stopCodexGeneration() {
        _uiState.value = _uiState.value.copy(isCodexLoading = false)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.stopCodexGeneration()
                if (!response.isSuccessful) {
                    _uiState.value = _uiState.value.copy(codexError = "Stop failed: ${response.code()}")
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun respondToCodexAction(actionId: String, approve: Boolean) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.respondToCodexAction(mapOf(
                    "actionId" to actionId,
                    "decision" to if (approve) "approve" else "deny"
                ))
                val body = response.body()
                if (!response.isSuccessful || body?.success != true) {
                    _uiState.value = _uiState.value.copy(
                        codexError = body?.error ?: "Action response failed: ${response.code()}"
                    )
                } else {
                    loadCodexEvents()
                    loadCodexHistory()
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun launchCodex() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.launchCodex()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    // ===== TUNNEL =====

    fun loadTunnelStatus() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.getTunnelStatus()
                if (response.isSuccessful) {
                    val body = response.body()
                    val url = body?.publicUrl ?: body?.tunnelUrl
                    _uiState.value = _uiState.value.copy(
                        tunnelActive = body?.tunnelActive ?: false,
                        tunnelUrl = url,
                        tunnelProvider = body?.tunnelProvider,
                        localIp = body?.localIp ?: "",
                        tunnelError = if (body?.authRequired == true && !body.authOk) {
                            "Требуется токен доступа для управления туннелем."
                        } else {
                            null
                        }
                    )
                    // If the tunnel is active, refresh the Android config.
                    if (body?.tunnelActive == true && url != null) {
                        val updatedConfig = _uiState.value.serverConfig.copy(
                            tunnelUrl = url,
                            useTunnel = _uiState.value.serverConfig.useTunnel
                        )
                        _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
                        saveConfig(updatedConfig)
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(tunnelError = e.message)
            }
        }
    }

    fun startTunnel() {
        startTunnelImproved()
    }

    private fun startTunnelImproved() {
        if (_uiState.value.serverConfig.authToken.isBlank()) {
            _uiState.value = _uiState.value.copy(
                isTunnelStarting = false,
                tunnelActive = false,
                tunnelError = "Для внешней сети нужен токен доступа. Создайте токен в VS Code и вставьте его в приложении перед запуском внешнего адреса."
            )
            return
        }
        _uiState.value = _uiState.value.copy(isTunnelStarting = true, tunnelError = null)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig.copy(useTunnel = false, tunnelUrl = ""))
                val response = api.startTunnel()
                val body = response.body()
                val url = body?.url
                if (response.isSuccessful && body?.success == true && !url.isNullOrBlank()) {
                    if (isUnsupportedExternalUrl(url)) {
                        _uiState.value = _uiState.value.copy(
                            isTunnelStarting = false,
                            tunnelActive = false,
                            tunnelError = "Расширение вернуло служебный адрес, который не подходит для телефона. В VS Code укажите готовый HTTPS Keenetic/DDNS URL.",
                            connectionError = "Расширение вернуло служебный адрес, который не подходит для телефона. В VS Code укажите готовый HTTPS Keenetic/DDNS URL."
                        )
                        return@launch
                    }
                    val updatedConfig = _uiState.value.serverConfig.copy(
                        useTunnel = true,
                        tunnelUrl = url
                    )
                    val validation = getStatusWithRetries(updatedConfig)
                    if (!validation.isSuccessful) {
                        val errorText = formatConnectionError(
                            updatedConfig,
                            "Ошибка ${validation.code()}: ${validation.message()}",
                            validation.code()
                        )
                        val localConfig = _uiState.value.serverConfig.copy(
                            useTunnel = false,
                            tunnelUrl = url
                        )
                        _uiState.value = _uiState.value.copy(
                            serverConfig = localConfig,
                            isTunnelStarting = false,
                            tunnelActive = false,
                            tunnelUrl = url,
                            tunnelProvider = body.provider,
                            isConnected = false,
                            isWebSocketConnected = false,
                            tunnelError = errorText,
                            connectionError = errorText
                        )
                        saveConfig(localConfig)
                        ApiClient.reset()
                        return@launch
                    }
                    _uiState.value = _uiState.value.copy(
                        tunnelActive = true,
                        tunnelUrl = url,
                        tunnelProvider = body.provider ?: "keenetic",
                        isTunnelStarting = false,
                        tunnelError = null
                    )
                    _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
                    saveConfig(updatedConfig)
                    ApiClient.reset()
                    connectWebSocket()
                } else {
                    val errorText = if (response.code() == 401) {
                        "Требуется токен доступа для получения публичного URL."
                    } else {
                        response.errorBody()?.string()?.let { parseServerError(it) }
                            ?: body?.error?.takeIf { it.isNotBlank() }
                            ?: body?.message?.takeIf { it.isNotBlank() }
                            ?: "Keenetic URL не удалось сформировать. В VS Code откройте Remote Code: Подключение -> Задать имя KeenDNS или вставьте URL вручную."
                    }
                    _uiState.value = _uiState.value.copy(
                        isTunnelStarting = false,
                        tunnelActive = false,
                        tunnelError = errorText
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isTunnelStarting = false,
                    tunnelActive = false,
                    tunnelError = "Ошибка: ${e.message}"
                )
            }
        }
    }

    private fun parseServerError(raw: String): String? {
        return try {
            val json = JsonParser.parseString(raw).asJsonObject
            json.get("error")?.asString?.takeIf { it.isNotBlank() }
                ?: json.get("message")?.asString?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            raw.takeIf { it.isNotBlank() }?.take(500)
        }
    }

    fun stopTunnel() {
        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(
                    tunnelActive = false,
                    tunnelUrl = _uiState.value.tunnelUrl,
                    tunnelProvider = null,
                    isTunnelStarting = false,
                    tunnelError = null,
                    serverConfig = _uiState.value.serverConfig.copy(
                        useTunnel = false,
                        tunnelUrl = ""
                    )
                )
                saveConfig(_uiState.value.serverConfig)
                // Reconnect WebSocket back to LAN mode.
                ApiClient.reset()
                connectWebSocket()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(tunnelError = e.message)
            }
        }
    }

    fun toggleTunnelMode(useTunnel: Boolean) {
        if (useTunnel && _uiState.value.serverConfig.authToken.isBlank()) {
            _uiState.value = _uiState.value.copy(
                tunnelError = "Для внешней сети нужен токен доступа. Сначала вставьте токен из VS Code."
            )
            return
        }
        if (useTunnel && _uiState.value.tunnelUrl != null) {
            val updatedConfig = _uiState.value.serverConfig.copy(
                useTunnel = true,
                tunnelUrl = _uiState.value.tunnelUrl ?: ""
            )
            _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
            saveConfig(updatedConfig)
            // Reset API so it is recreated with the new URL.
            ApiClient.reset()
            connectWebSocket()
        } else if (!useTunnel) {
            val updatedConfig = _uiState.value.serverConfig.copy(
                useTunnel = false,
                tunnelUrl = ""
            )
            _uiState.value = _uiState.value.copy(serverConfig = updatedConfig, tunnelProvider = null)
            saveConfig(updatedConfig)
            ApiClient.reset()
            connectWebSocket()
        }
    }

    // ===== NAVIGATION =====

    fun navigateTo(screen: String) {
        _uiState.value = _uiState.value.copy(currentScreen = screen)
        // Load data for the destination screen.
        when (screen) {
            "vscode" -> {
                loadFolders()
                loadCodexStatus()
                loadCodexModels()
                    loadCodexThreads(loadCurrent = true)
            }
            "chat" -> { loadChatAgents(); loadChatHistory() }
            "files" -> loadFolders()
            "diagnostics" -> loadDiagnostics()
            "codex" -> { loadCodexStatus(); loadCodexModels(); loadCodexThreads(loadCurrent = true) }
            "terminal" -> { /* Nothing to load; terminal is lightweight. */ }
            "settings" -> loadTunnelStatus()
        }
    }
}
