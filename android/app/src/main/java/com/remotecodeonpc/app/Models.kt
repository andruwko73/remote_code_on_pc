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
    val serverVersion: String = "",
    val appApk: AppApkStatus? = null,
    val appName: String = "",
    val isRunning: Boolean = false,
    val platform: String = "",
    val remoteCode: RemoteCodeStatus? = null,
    val workspace: WorkspaceInfo? = null,
    val uptime: Double = 0.0,
    val memoryUsage: Long = 0
)

data class AppApkStatus(
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val versionName: String? = null,
    val versionCode: Int? = null
)

data class RemoteCodeStatus(
    val port: Int = 8799,
    val host: String = "",
    val localIp: String = "",
    val localUrl: String = "",
    val publicUrl: String? = null,
    val tunnelUrl: String? = null,
    val activeUrl: String? = null,
    val tunnelActive: Boolean = false,
    val tunnelProvider: String? = null,
    val authRequired: Boolean = false,
    val authOk: Boolean = true,
    val tokenConfigured: Boolean = false
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
    val serverVersion: String = "",
    val appApk: AppApkStatus? = null,
    val appName: String = "",
    val isRunning: Boolean = false,
    val platform: String = "",
    val remoteCode: RemoteCodeStatus? = null,
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
    val reasoningEffort: String = "medium",
    val profile: String = "user",
    val includeContext: Boolean = true,
    val note: String? = null,
    val error: String? = null
)

data class CodexSendResponse(
    val success: Boolean = false,
    val message: String = "",
    val command: String = "",
    val threadId: String = "",
    val reasoningEffort: String = "",
    val includeContext: Boolean = true,
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
    val reasoningEffort: String? = null,
    val includeContext: Boolean? = null,
    val isStreaming: Boolean = false,
    val changeSummary: CodexChangeSummary? = null,
    val attachments: List<MessageAttachment> = emptyList()
)

data class CodexChangeFile(
    val path: String = "",
    val additions: Int = 0,
    val deletions: Int = 0
)

data class CodexChangeSummary(
    val commit: String? = null,
    val cwd: String? = null,
    val fileCount: Int = 0,
    val files: List<CodexChangeFile> = emptyList(),
    val additions: Int = 0,
    val deletions: Int = 0
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
    val actionable: Boolean = false,
    val startedAt: Long = 0,
    val completedAt: Long = 0,
    val completedCommandCount: Int = 0
)

data class CodexHistoryResponse(
    val threadId: String = "",
    val title: String = "",
    val projectId: String? = null,
    val workspaceName: String? = null,
    val workspacePath: String? = null,
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

data class CodexMessageActionResponse(
    val success: Boolean = false,
    val threadId: String = "",
    val messageId: String = "",
    val regeneratedFrom: String? = null,
    val messages: List<CodexChatMessage> = emptyList(),
    val error: String? = null
)

data class CodexChangeActionResponse(
    val success: Boolean = false,
    val action: String = "",
    val path: String? = null,
    val commit: String? = null,
    val cwd: String? = null,
    val diff: String? = null,
    val message: String? = null,
    val actionId: String? = null,
    val error: String? = null
)

data class CodexThread(
    val id: String = "",
    val title: String = "",
    val timestamp: Long = 0,
    val source: String? = null,
    val projectId: String? = null,
    val workspaceName: String? = null,
    val workspacePath: String? = null
)

data class CodexProject(
    val id: String = "",
    val name: String = "",
    val path: String? = null,
    val active: Boolean = false,
    val threadCount: Int = 0,
    val timestamp: Long = 0,
    val threads: List<CodexThread> = emptyList()
)

data class CodexThreadsResponse(
    val threads: List<CodexThread> = emptyList(),
    val projects: List<CodexProject> = emptyList(),
    val currentThreadId: String = "",
    val currentProjectId: String = ""
)

data class CodexSelectModelResponse(
    val success: Boolean = false,
    val model: String = "",
    val reasoningEffort: String = "medium",
    val profile: String = "user",
    val includeContext: Boolean = true,
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
    val publicUrl: String? = null,
    val tunnelProvider: String? = null,
    val authRequired: Boolean = false,
    val authOk: Boolean = true,
    val tokenConfigured: Boolean = false,
    val manualUrlSupported: Boolean = true
)

data class TunnelActionResponse(
    val success: Boolean = false,
    val url: String? = null,
    val provider: String? = null,
    val message: String = "",
    val error: String? = null
)
