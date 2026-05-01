package com.remotecodeonpc.app

// ========== МОДЕЛИ ДАННЫХ ==========

data class ServerConfig(
    val host: String = "",
    val port: Int = 8799,
    val authToken: String = "",
    val useTunnel: Boolean = false,
    val tunnelUrl: String = ""
)

data class WorkspaceStatus(
    val version: String = "",
    val appName: String = "",
    val isRunning: Boolean = false,
    val platform: String = "",
    val workspace: WorkspaceInfo? = null,
    val uptime: Double = 0.0,
    val memoryUsage: Long = 0
)

data class WorkspaceInfo(
    val folders: List<FolderInfo> = emptyList(),
    val activeFile: String? = null,
    val activeFileLanguage: String? = null
)

data class FolderInfo(
    val name: String = "",
    val uri: String = "",
    val path: String = ""
)

data class FileTreeItem(
    val name: String = "",
    val path: String = "",
    val isDirectory: Boolean = false,
    val extension: String? = null,
    val size: Long = 0,
    val children: List<FileTreeItem>? = null,
    val truncated: Boolean = false,
    val error: String? = null
)

data class FileContent(
    val path: String = "",
    val content: String = "",
    val extension: String = "",
    val size: Int = 0,
    val language: String = ""
)

data class ChatAgent(
    val name: String = "",
    val displayName: String = "",
    val model: String? = null,
    val vendor: String? = null,
    val isDefault: Boolean = false
)

data class ChatMessage(
    val id: String = "",
    val role: String = "",
    val content: String = "",
    val timestamp: Long = 0,
    val agentName: String? = null
)

data class ChatConversation(
    val id: String = "",
    val title: String = "",
    val messageCount: Int = 0,
    val lastMessage: String = "",
    val lastTimestamp: Long = 0,
    val isCurrent: Boolean = false
)

data class DiagnosticItem(
    val file: String = "",
    val line: Int = 0,
    val column: Int = 0,
    val message: String = "",
    val severity: String = "",
    val code: String? = null
)

data class DiagnosticsResponse(
    val total: Int = 0,
    val errors: Int = 0,
    val warnings: Int = 0,
    val items: List<DiagnosticItem> = emptyList()
)

// Обёртки для API
data class StatusResponse(
    val version: String = "",
    val appName: String = "",
    val isRunning: Boolean = false,
    val platform: String = "",
    val workspace: WorkspaceInfo? = null,
    val uptime: Double = 0.0,
    val memoryUsage: Long = 0
)

data class FoldersResponse(
    val current: List<FolderInfo> = emptyList(),
    val recent: List<FolderInfo> = emptyList(),
    val systemDrives: List<String> = emptyList()
)

data class ChatAgentsResponse(
    val agents: List<ChatAgent> = emptyList(),
    val selected: String = "",
    val currentChatId: String = ""
)

data class ChatHistoryResponse(
    val chatId: String = "",
    val messages: List<ChatMessage> = emptyList(),
    val agentName: String = ""
)

data class ChatSendResponse(
    val response: ChatMessage? = null,
    val chatId: String = "",
    val error: String? = null
)

data class ConversationsResponse(
    val conversations: List<ChatConversation> = emptyList(),
    val current: String = ""
)

data class SelectAgentResponse(
    val success: Boolean = false,
    val selected: String = "",
    val agent: ChatAgent? = null
)

data class NewChatResponse(
    val chatId: String = ""
)

// ========== CODEX MODELS ==========

data class CodexStatus(
    val installed: Boolean = false,
    val version: String = "",
    val isRunning: Boolean = false,
    val path: String? = null,
    val desktopAppInstalled: Boolean = false,
    val configPath: String? = null,
    val error: String? = null
)

data class CodexModel(
    val id: String = "",
    val name: String = ""
)

data class CodexModelsResponse(
    val models: List<CodexModel> = emptyList(),
    val selected: String = "",
    val note: String? = null,
    val error: String? = null
)

data class CodexSendResponse(
    val success: Boolean = false,
    val message: String = "",
    val command: String = "",
    val threadId: String = "",
    val note: String? = null,
    val error: String? = null
)

data class MessageAttachment(
    val name: String = "",
    val mimeType: String = "application/octet-stream",
    val size: Long = 0,
    val base64: String = ""
)

data class CodexChatMessage(
    val id: String = "",
    val role: String = "",
    val content: String = "",
    val timestamp: Long = 0,
    val model: String? = null,
    val isStreaming: Boolean = false
)

data class CodexActionEvent(
    val id: String = "",
    val type: String = "",
    val title: String = "",
    val detail: String = "",
    val status: String = "",
    val timestamp: Long = 0,
    val callId: String? = null,
    val source: String? = null,
    val actionable: Boolean = false
)

data class CodexHistoryResponse(
    val threadId: String = "",
    val title: String = "",
    val messages: List<CodexChatMessage> = emptyList()
)

data class CodexEventsResponse(
    val threadId: String = "",
    val events: List<CodexActionEvent> = emptyList()
)

data class CodexActionResponse(
    val success: Boolean = false,
    val actionId: String = "",
    val decision: String = "",
    val error: String? = null
)

data class CodexThread(
    val id: String = "",
    val title: String = "",
    val timestamp: Long = 0
)

data class CodexThreadsResponse(
    val threads: List<CodexThread> = emptyList()
)

data class CodexSelectModelResponse(
    val success: Boolean = false,
    val model: String = "",
    val result: String? = null,
    val error: String? = null
)

data class CodexLaunchResponse(
    val success: Boolean = false,
    val method: String = "",
    val path: String? = null,
    val error: String? = null
)

// ========== TUNNEL MODELS ==========

data class TunnelStatusResponse(
    val tunnelActive: Boolean = false,
    val tunnelUrl: String? = null,
    val localIp: String = "",
    val port: Int = 8799,
    val localUrl: String = "",
    val publicUrl: String? = null
)

data class TunnelActionResponse(
    val success: Boolean = false,
    val url: String? = null,
    val message: String = "",
    val error: String? = null
)
