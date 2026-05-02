package com.remotecodeonpc.app.viewmodel

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.remotecodeonpc.app.CrashLogger
import com.remotecodeonpc.app.*
import com.remotecodeonpc.app.network.ApiClient
import com.remotecodeonpc.app.network.SimpleHttpClient
import com.remotecodeonpc.app.network.WebSocketClient
import com.remotecodeonpc.app.network.WebSocketListener
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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
    val codexIncludeContext: Boolean = true,
    val codexChatHistory: List<CodexChatMessage> = emptyList(),
    val codexActionEvents: List<CodexActionEvent> = emptyList(),
    val codexSendResult: CodexSendResponse? = null,
    val codexThreads: List<CodexThread> = emptyList(),
    val currentCodexThreadId: String = "",
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
            if (savedHost.isNotBlank()) {
                _uiState.value = _uiState.value.copy(
                    serverConfig = ServerConfig(
                        host = savedHost,
                        port = savedPort,
                        authToken = savedToken
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
                .apply()
            CrashLogger.d("ViewModel", "Config saved: ${config.host}:${config.port}")
        } catch (e: Exception) {
            CrashLogger.e("ViewModel", "Error saving config", e)
        }
    }

    // ===== CONNECTION =====

    fun updateServerConfig(config: ServerConfig) {
        _uiState.value = _uiState.value.copy(serverConfig = config)
        saveConfig(config)
    }

    fun connect() {
        val config = _uiState.value.serverConfig
        if (config.host.isBlank()) {
            _uiState.value = _uiState.value.copy(connectionError = "Р’РІРµРґРёС‚Рµ IP Р°РґСЂРµСЃ РџРљ")
            return
        }

        _uiState.value = _uiState.value.copy(isConnecting = true, connectionError = null)

        CrashLogger.i("ViewModel", "connect() called: host=${config.host}, port=${config.port}")

        viewModelScope.launch {
            try {
                CrashLogger.d("ViewModel", "Building API client...")
                val api = ApiClient.getApi(config)
                CrashLogger.d("ViewModel", "Calling getStatus()...")
                val response = api.getStatus()
                CrashLogger.d("ViewModel", "Status response: code=${response.code()}")
                if (response.isSuccessful) {
                    val status = response.body()
                    CrashLogger.i("ViewModel", "Connected! status: version=${status?.version}")
                    _uiState.value = _uiState.value.copy(
                        isConnected = true,
                        isConnecting = false,
                        connectionError = null,
                        status = WorkspaceStatus(
                            version = status?.version ?: "",
                            appName = status?.appName ?: "",
                            isRunning = status?.isRunning ?: false,
                            platform = status?.platform ?: "",
                            workspace = status?.workspace,
                            uptime = status?.uptime ?: 0.0,
                            memoryUsage = status?.memoryUsage ?: 0
                        )
                    )
                    connectWebSocket()
                    loadFolders()
                    // Heavy history scans are loaded on demand to keep first paint fast.
                    loadDiagnostics()
                    loadCodexStatus()
                    loadCodexModels()
                    loadCodexThreads(loadCurrent = true)
                } else {
                    CrashLogger.w("ViewModel", "getStatus failed: code=${response.code()}, message=${response.message()}")
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        connectionError = "РћС€РёР±РєР° ${response.code()}: ${response.message()}"
                    )
                }
            } catch (e: Exception) {
                CrashLogger.e("ViewModel", "connect() exception, trying simple HTTP fallback", e)
                try {
                    val status = SimpleHttpClient.getStatus(config)
                    CrashLogger.i("ViewModel", "Connected with simple HTTP fallback: version=${status.version}")
                    _uiState.value = _uiState.value.copy(
                        isConnected = true,
                        isConnecting = false,
                        connectionError = null,
                        status = WorkspaceStatus(
                            version = status.version,
                            appName = status.appName,
                            isRunning = status.isRunning,
                            platform = status.platform,
                            workspace = status.workspace,
                            uptime = status.uptime,
                            memoryUsage = status.memoryUsage
                        )
                    )
                    connectWebSocket()
                    loadFolders()
                    // Heavy history scans are loaded on demand to keep first paint fast.
                    loadDiagnostics()
                    loadCodexStatus()
                    loadCodexModels()
                    loadCodexThreads(loadCurrent = true)
                } catch (fallbackError: Exception) {
                    CrashLogger.e("ViewModel", "simple HTTP fallback failed", fallbackError)
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        connectionError = "Connection error: ${fallbackError.message ?: e.message}"
                    )
                }
            }
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
                // WebSocket РјРѕР¶РµС‚ РїРµСЂРµРїРѕРґРєР»СЋС‡Р°С‚СЊСЃСЏ вЂ” РЅРµ СЃР±СЂР°СЃС‹РІР°РµРј isConnected
                _uiState.value = _uiState.value.copy(isWebSocketConnected = false)
                // РћСЃС‚Р°РЅР°РІР»РёРІР°РµРј health-check РЅР° РІСЂРµРјСЏ СЂРµРєРѕРЅРЅРµРєС‚Р°
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
                                    activeFile = activeFile ?: "вЂ”"
                                )
                            )
                        )
                    }
                    "folders:update" -> {
                        viewModelScope.launch { loadFolders() }
                    }
                    "chat:sessions-update" -> {
                        // VS Code С‡Р°С‚С‹ РёР·РјРµРЅРёР»РёСЃСЊ РЅР° РџРљ вЂ” РѕР±РЅРѕРІР»СЏРµРј СЃРїРёСЃРѕРє Рё РёСЃС‚РѕСЂРёСЋ
                        viewModelScope.launch {
                            loadConversations()
                        }
                    }
                    "codex:sent" -> {
                        // Codex Р·Р°РїСЂРѕСЃ РѕС‚РїСЂР°РІР»РµРЅ вЂ” РјРѕР¶РµРј РѕР±РЅРѕРІРёС‚СЊ СЃС‚Р°С‚СѓСЃ
                        val threadId = data["threadId"] as? String
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
                // WebSocket РѕС€РёР±РєР° вЂ” Р»РѕРіРёСЂСѓРµРј
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
        val savedConfig = _uiState.value.serverConfig // СЃРѕС…СЂР°РЅСЏРµРј РєРѕРЅС„РёРі
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
        if (!_uiState.value.isConnected) return // СѓР¶Рµ РЅР° СЌРєСЂР°РЅРµ РєРѕРЅРЅРµРєС‚Р°
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
                        chatError = "РћС€РёР±РєР° ${response.code()}"
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    chatError = "РћС€РёР±РєР°: ${e.message}"
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

    private fun upsertCodexMessage(message: CodexChatMessage) {
        val current = _uiState.value.codexChatHistory.toMutableList()
        val index = current.indexOfFirst { it.id == message.id }
        if (index >= 0) {
            current[index] = message
        } else {
            current.add(message)
        }
        _uiState.value = _uiState.value.copy(codexChatHistory = current.sortedBy { it.timestamp })
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
        _uiState.value = _uiState.value.copy(codexChatHistory = current.sortedBy { it.timestamp })
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
            isStreaming = this["isStreaming"] as? Boolean ?: false
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
                    val output = body?.get("output") as? String ?: "вњ… РљРѕРјР°РЅРґР° РѕС‚РїСЂР°РІР»РµРЅР°: $command"
                    val currentOutput = _uiState.value.terminalOutput
                    _uiState.value = _uiState.value.copy(
                        terminalOutput = currentOutput + "\n> $command\n$output\n",
                        isTerminalRunning = false
                    )
                } else {
                    val currentOutput = _uiState.value.terminalOutput
                    _uiState.value = _uiState.value.copy(
                        terminalOutput = currentOutput + "\n> $command\nвќЊ РћС€РёР±РєР° ${response.code()}\n",
                        isTerminalRunning = false
                    )
                }
            } catch (e: Exception) {
                val currentOutput = _uiState.value.terminalOutput
                _uiState.value = _uiState.value.copy(
                    terminalOutput = currentOutput + "\n> $command\nвќЊ РћС€РёР±РєР°: ${e.message}\n",
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
                            .sortedBy { it.timestamp }
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
                        codexReasoningEffort = body?.reasoningEffort ?: _uiState.value.codexReasoningEffort
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun selectCodexModel(modelId: String) {
        _uiState.value = _uiState.value.copy(codexSelectedModel = modelId)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.selectCodexModel(mapOf("modelId" to modelId))
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(codexError = e.message)
            }
        }
    }

    fun selectCodexReasoningEffort(effort: String) {
        val normalized = when (effort) {
            "low", "medium", "high", "xhigh" -> effort
            else -> "medium"
        }
        _uiState.value = _uiState.value.copy(codexReasoningEffort = normalized)
    }

    fun toggleCodexContext() {
        _uiState.value = _uiState.value.copy(codexIncludeContext = !_uiState.value.codexIncludeContext)
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
            includeContext = _uiState.value.codexIncludeContext
        )
        _uiState.value = _uiState.value.copy(
            isCodexLoading = true,
            codexError = null,
            codexChatHistory = (_uiState.value.codexChatHistory + optimisticMessage).takeLast(120)
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
                        isCodexLoading = false
                    )
                    loadCodexThreads(loadCurrent = true)
                    loadCodexEvents(nextThreadId)
                    delay(4000)
                    loadCodexHistory(nextThreadId)
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
                    val threads = response.body()?.threads ?: emptyList()
                    val current = _uiState.value.currentCodexThreadId
                    val nextCurrent = when {
                        threads.any { it.id == current } -> current
                        else -> threads.firstOrNull()?.id ?: ""
                    }
                    _uiState.value = _uiState.value.copy(
                        codexThreads = threads,
                        currentCodexThreadId = nextCurrent,
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

    fun switchCodexThread(threadId: String) {
        _uiState.value = _uiState.value.copy(
            currentCodexThreadId = threadId,
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
                    val nextCurrent = when {
                        _uiState.value.currentCodexThreadId != threadId -> _uiState.value.currentCodexThreadId
                        else -> remaining.firstOrNull()?.id.orEmpty()
                    }
                    _uiState.value = _uiState.value.copy(
                        codexThreads = remaining,
                        currentCodexThreadId = nextCurrent,
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
                    _uiState.value = _uiState.value.copy(
                        tunnelActive = body?.tunnelActive ?: false,
                        tunnelUrl = body?.tunnelUrl,
                        localIp = body?.localIp ?: "",
                        tunnelError = null
                    )
                    // Р•СЃР»Рё С‚СѓРЅРЅРµР»СЊ Р°РєС‚РёРІРµРЅ вЂ” РѕР±РЅРѕРІР»СЏРµРј РєРѕРЅС„РёРі РґР»СЏ Android
                    if (body?.tunnelActive == true && body.tunnelUrl != null) {
                        val updatedConfig = _uiState.value.serverConfig.copy(
                            tunnelUrl = body.tunnelUrl,
                            useTunnel = body.tunnelActive
                        )
                        _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(tunnelError = e.message)
            }
        }
    }

    fun startTunnel() {
        _uiState.value = _uiState.value.copy(isTunnelStarting = true, tunnelError = null)
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                val response = api.startTunnel()
                if (response.isSuccessful) {
                    val body = response.body()
                    val url = body?.url
                    _uiState.value = _uiState.value.copy(
                        tunnelActive = true,
                        tunnelUrl = url,
                        isTunnelStarting = false,
                        tunnelError = null
                    )
                    // РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµРєР»СЋС‡Р°РµРј Android РЅР° С‚СѓРЅРЅРµР»СЊ
                    if (url != null) {
                        val updatedConfig = _uiState.value.serverConfig.copy(
                            useTunnel = true,
                            tunnelUrl = url
                        )
                        _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
                        // РџРµСЂРµРїРѕРґРєР»СЋС‡Р°РµРј WebSocket С‡РµСЂРµР· С‚СѓРЅРЅРµР»СЊ
                        connectWebSocket()
                    }
                } else {
                    _uiState.value = _uiState.value.copy(
                        isTunnelStarting = false,
                        tunnelError = "РћС€РёР±РєР° ${response.code()}"
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isTunnelStarting = false,
                    tunnelError = "РћС€РёР±РєР°: ${e.message}"
                )
            }
        }
    }

    fun stopTunnel() {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.stopTunnel()
                _uiState.value = _uiState.value.copy(
                    tunnelActive = false,
                    tunnelUrl = null,
                    isTunnelStarting = false,
                    tunnelError = null,
                    serverConfig = _uiState.value.serverConfig.copy(
                        useTunnel = false,
                        tunnelUrl = ""
                    )
                )
                // РџРµСЂРµРїРѕРґРєР»СЋС‡Р°РµРј WebSocket РѕР±СЂР°С‚РЅРѕ РЅР° LAN
                connectWebSocket()
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(tunnelError = e.message)
            }
        }
    }

    fun toggleTunnelMode(useTunnel: Boolean) {
        if (useTunnel && _uiState.value.tunnelUrl != null) {
            val updatedConfig = _uiState.value.serverConfig.copy(
                useTunnel = true,
                tunnelUrl = _uiState.value.tunnelUrl ?: ""
            )
            _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
            // РЎР±СЂРѕСЃРёРј API, С‡С‚РѕР±С‹ РїРµСЂРµСЃРѕР·РґР°С‚СЊ СЃ РЅРѕРІС‹Рј URL
            ApiClient.reset()
            connectWebSocket()
        } else if (!useTunnel) {
            val updatedConfig = _uiState.value.serverConfig.copy(
                useTunnel = false,
                tunnelUrl = ""
            )
            _uiState.value = _uiState.value.copy(serverConfig = updatedConfig)
            ApiClient.reset()
            connectWebSocket()
        }
    }

    // ===== NAVIGATION =====

    fun navigateTo(screen: String) {
        _uiState.value = _uiState.value.copy(currentScreen = screen)
        // Р—Р°РіСЂСѓР¶Р°РµРј РґР°РЅРЅС‹Рµ РїСЂРё РїРµСЂРµС…РѕРґРµ
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
            "terminal" -> { /* РЅРёС‡РµРіРѕ РЅРµ Р·Р°РіСЂСѓР¶Р°РµРј - С‚РµСЂРјРёРЅР°Р» Р»С‘РіРєРёР№ */ }
            "settings" -> loadTunnelStatus()
        }
    }
}
