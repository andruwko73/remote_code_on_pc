package com.remotecodeonpc.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.remotecodeonpc.app.*
import com.remotecodeonpc.app.network.ApiClient
import com.remotecodeonpc.app.network.WebSocketClient
import com.remotecodeonpc.app.network.WebSocketListener
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

    // Navigation
    val currentScreen: String = "dashboard",

    // Folders
    val folders: FoldersResponse? = null,
    val currentFiles: FileTreeItem? = null,
    val fileContent: FileContent? = null,
    val isLoadingFiles: Boolean = false,

    // Chat
    val chatAgents: List<ChatAgent> = emptyList(),
    val selectedAgent: String = "default",
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
    val isTerminalRunning: Boolean = false
)

class MainViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    private var wsClient: WebSocketClient? = null

    // ===== CONNECTION =====

    fun updateServerConfig(config: ServerConfig) {
        _uiState.value = _uiState.value.copy(serverConfig = config)
    }

    fun connect() {
        val config = _uiState.value.serverConfig
        if (config.host.isBlank()) {
            _uiState.value = _uiState.value.copy(connectionError = "Введите IP адрес ПК")
            return
        }

        _uiState.value = _uiState.value.copy(isConnecting = true, connectionError = null)

        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(config)
                val response = api.getStatus()
                if (response.isSuccessful) {
                    val status = response.body()
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
                    loadChatAgents()
                    loadConversations()
                    loadDiagnostics()
                } else {
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        connectionError = "Ошибка ${response.code()}: ${response.message()}"
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isConnecting = false,
                    connectionError = "Ошибка подключения: ${e.message}"
                )
            }
        }
    }

    private fun connectWebSocket() {
        wsClient?.disconnect()
        wsClient = WebSocketClient(_uiState.value.serverConfig)
        wsClient?.connect(object : WebSocketListener {
            override fun onConnected() {
                // WS connected
            }

            override fun onDisconnected() {
                _uiState.value = _uiState.value.copy(isConnected = false)
            }

            override fun onMessage(type: String, data: Map<String, Any>) {
                when (type) {
                    "diagnostics:update" -> {
                        viewModelScope.launch { loadDiagnostics() }
                    }
                    "chat:thinking" -> {
                        _uiState.value = _uiState.value.copy(isThinking = true)
                    }
                    "chat:response" -> {
                        _uiState.value = _uiState.value.copy(isThinking = false)
                        viewModelScope.launch { loadChatHistory() }
                    }
                }
            }

            override fun onError(error: String) {
                _uiState.value = _uiState.value.copy(connectionError = error)
            }
        })
    }

    fun disconnect() {
        wsClient?.disconnect()
        wsClient = null
        ApiClient.reset()
        _uiState.value = AppUiState()
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
                        selectedAgent = body?.selected ?: "default",
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
                        currentChatId = id
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
                    _uiState.value = _uiState.value.copy(
                        conversations = response.body()?.conversations ?: emptyList()
                    )
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

    // ===== TERMINAL =====

    fun execTerminal(command: String) {
        viewModelScope.launch {
            try {
                val api = ApiClient.getApi(_uiState.value.serverConfig)
                api.execTerminal(mapOf("command" to command))
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    // ===== NAVIGATION =====

    fun navigateTo(screen: String) {
        _uiState.value = _uiState.value.copy(currentScreen = screen)
        // Загружаем данные при переходе
        when (screen) {
            "dashboard" -> { loadFolders(); loadDiagnostics() }
            "chat" -> { loadChatAgents(); loadChatHistory() }
            "files" -> loadFolders()
            "diagnostics" -> loadDiagnostics()
        }
    }
}
