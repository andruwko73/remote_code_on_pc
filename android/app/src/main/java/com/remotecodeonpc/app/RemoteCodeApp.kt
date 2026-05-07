package com.remotecodeonpc.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.remotecodeonpc.app.ui.screens.*
import com.remotecodeonpc.app.ui.theme.*
import com.remotecodeonpc.app.viewmodel.MainViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteCodeApp(
    viewModel: MainViewModel = viewModel(),
    onShareLogs: () -> Unit = {},
    onClearLogs: () -> Unit = {},
    onUpdateApp: (ServerConfig) -> Unit = {}
) {
    val state by viewModel.uiState.collectAsState()
    BackHandler(enabled = state.isConnected && state.currentScreen != "codex") {
        viewModel.navigateTo("codex")
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .background(DarkBackground)
    ) {
            if (state.isConnected) {
                // Основные экраны
                when (state.currentScreen) {
                    "vscode" -> VSCodeScreen(
                        folders = state.folders,
                        currentFiles = state.currentFiles,
                        fileContent = state.fileContent,
                        isLoadingFiles = state.isLoadingFiles,
                        codexModels = state.codexModels,
                        codexSelectedModel = state.codexSelectedModel,
                        codexReasoningEffort = state.codexReasoningEffort,
                        codexProfile = state.codexProfile,
                        codexIncludeContext = state.codexIncludeContext,
                        codexChatHistory = state.codexChatHistory,
                        codexActionEvents = state.codexActionEvents,
                        codexSendResult = state.codexSendResult,
                        codexThreads = state.codexThreads,
                        currentCodexThreadId = state.currentCodexThreadId,
                        isCodexLoading = state.isCodexLoading,
                        codexError = state.codexError,
                        onSendCodexMessage = { text, attachments -> viewModel.sendCodexMessage(text, attachments) },
                        onSelectCodexModel = { viewModel.selectCodexModel(it) },
                        onSelectCodexReasoningEffort = { viewModel.selectCodexReasoningEffort(it) },
                        onSelectCodexProfile = { viewModel.selectCodexProfile(it) },
                        onToggleCodexContext = { viewModel.toggleCodexContext() },
                        onNewCodexThread = { viewModel.newCodexThread() },
                        onLoadCodexThreads = { viewModel.loadCodexThreads() },
                        onSwitchCodexThread = { viewModel.switchCodexThread(it) },
                        onDeleteCodexThread = { viewModel.deleteCodexThread(it) },
                        onStopCodexGeneration = { viewModel.stopCodexGeneration() },
                        onRespondToCodexAction = { actionId, approve -> viewModel.respondToCodexAction(actionId, approve) },
                        onNavigateToDir = { viewModel.loadFileTree(it) },
                        onOpenFile = { viewModel.loadFileContent(it) },
                        onOpenFolder = { viewModel.openFolder(it); viewModel.loadFileTree(it) },
                        onGoUp = {
                            state.currentFiles?.let { tree ->
                                val cleanPath = tree.path.replace('\\', '/').trimEnd('/')
                                val idx = cleanPath.lastIndexOf('/')
                                if (idx >= 0) {
                                    val parent = cleanPath.substring(0, idx).replace('/', '\\')
                                    if (parent.length >= 3) {
                                        viewModel.loadFileTree(
                                            if (parent.endsWith(":")) "$parent\\" else parent
                                        )
                                    }
                                }
                            }
                        },
                        onNavigateToSettings = { viewModel.navigateTo("settings") }
                    )
                    "codex" -> CodexScreen(
                        models = state.codexModels,
                        selectedModel = state.codexSelectedModel,
                        selectedReasoningEffort = state.codexReasoningEffort,
                        selectedProfile = state.codexProfile,
                        includeContext = state.codexIncludeContext,
                        chatHistory = state.codexChatHistory,
                        actionEvents = state.codexActionEvents,
                        sendResult = state.codexSendResult,
                        threads = state.codexThreads,
                        currentThreadId = state.currentCodexThreadId,
                        isLoading = state.isCodexLoading,
                        error = state.codexError,
                        folders = state.folders,
                        currentFiles = state.currentFiles,
                        fileContent = state.fileContent,
                        isLoadingFiles = state.isLoadingFiles,
                        onSendMessage = { text, attachments -> viewModel.sendCodexMessage(text, attachments) },
                        onSelectModel = { viewModel.selectCodexModel(it) },
                        onSelectReasoningEffort = { viewModel.selectCodexReasoningEffort(it) },
                        onSelectProfile = { viewModel.selectCodexProfile(it) },
                        onToggleContext = { viewModel.toggleCodexContext() },
                        onNewThread = { viewModel.newCodexThread() },
                        onLoadThreads = { viewModel.loadCodexThreads(loadCurrent = false) },
                        onSwitchThread = { viewModel.switchCodexThread(it) },
                        onDeleteThread = { viewModel.deleteCodexThread(it) },
                        onStopGeneration = { viewModel.stopCodexGeneration() },
                        onRespondToAction = { actionId, approve -> viewModel.respondToCodexAction(actionId, approve) },
                        onNavigateToDir = { viewModel.loadFileTree(it) },
                        onOpenFile = { viewModel.loadFileContent(it) },
                        onOpenFolder = { viewModel.openFolder(it); viewModel.loadFileTree(it) },
                        onGoUp = {
                            state.currentFiles?.let { tree ->
                                val cleanPath = tree.path.replace('\\', '/').trimEnd('/')
                                val idx = cleanPath.lastIndexOf('/')
                                if (idx >= 0) {
                                    val parent = cleanPath.substring(0, idx).replace('/', '\\')
                                    if (parent.length >= 3) {
                                        viewModel.loadFileTree(
                                            if (parent.endsWith(":")) "$parent\\" else parent
                                        )
                                    }
                                }
                            }
                        },
                        onNavigateToSettings = { viewModel.navigateTo("settings") }
                    )
                    "chat" -> ChatScreen(
                        agents = state.chatAgents,
                        selectedAgent = state.selectedAgent,
                        chatHistory = state.chatHistory,
                        conversations = state.conversations,
                        currentChatId = state.currentChatId,
                        isChatLoading = state.isChatLoading,
                        chatError = state.chatError,
                        isThinking = state.isThinking,
                        onSendMessage = { viewModel.sendChatMessage(it) },
                        onSelectAgent = { viewModel.selectAgent(it) },
                        onNewChat = { viewModel.newChat() },
                        onSwitchChat = { viewModel.switchToChat(it) }
                    )
                    "files" -> FilesScreen(
                        folders = state.folders,
                        currentFiles = state.currentFiles,
                        fileContent = state.fileContent,
                        isLoading = state.isLoadingFiles,
                        onNavigateToDir = { viewModel.loadFileTree(it) },
                        onOpenFile = { viewModel.loadFileContent(it) },
                        onOpenFolder = { viewModel.openFolder(it); viewModel.loadFileTree(it) },
                        onGoUp = {
                            state.currentFiles?.let { tree ->
                                val cleanPath = tree.path.replace('\\', '/').trimEnd('/')
                                val idx = cleanPath.lastIndexOf('/')
                                if (idx >= 0) {
                                    val parent = cleanPath.substring(0, idx).replace('/', '\\')
                                    if (parent.length >= 3) {
                                        viewModel.loadFileTree(
                                            if (parent.endsWith(":")) "$parent\\" else parent
                                        )
                                    }
                                }
                            }
                        },
                        onBack = { viewModel.navigateTo("codex") }
                    )
                    "diagnostics" -> DiagnosticsScreen(
                        diagnostics = state.diagnostics,
                        onRefresh = { viewModel.loadDiagnostics() }
                    )
                    "terminal" -> TerminalScreen(
                        output = state.terminalOutput,
                        isRunning = state.isTerminalRunning,
                        onExecCommand = { viewModel.execTerminal(it) },
                        onClearTerminal = { viewModel.clearTerminal() },
                        onBack = { viewModel.navigateTo("codex") }
                    )
                    "settings" -> SettingsScreenV2(
                        serverConfig = state.serverConfig,
                        status = state.status,
                        isConnected = state.isConnected,
                        tunnelActive = state.tunnelActive,
                        tunnelUrl = state.tunnelUrl,
                        tunnelProvider = state.tunnelProvider,
                        localIp = state.localIp,
                        isTunnelStarting = state.isTunnelStarting,
                        tunnelError = state.tunnelError,
                        onUpdateConfig = { viewModel.updateServerConfig(it) },
                        onReconnect = {
                            viewModel.disconnect()
                            viewModel.connect()
                        },
                        onDisconnect = { viewModel.disconnect() },
                        onStartTunnel = { viewModel.startTunnel() },
                        onStopTunnel = { viewModel.stopTunnel() },
                        onToggleTunnelMode = { viewModel.toggleTunnelMode(it) },
                        onBack = { viewModel.navigateTo("codex") },
                        onClearLogs = onClearLogs,
                        onUpdateApp = { onUpdateApp(it) }
                    )
                }
            } else {
                // Экран подключения
                ConnectionScreen(
                    serverConfig = state.serverConfig,
                    isConnecting = state.isConnecting,
                    error = state.connectionError,
                    onUpdateConfig = { viewModel.updateServerConfig(it) },
                    onConnect = { viewModel.connect() },
                    onShareLogs = onShareLogs,
                    onClearLogs = onClearLogs,
                    onUpdateApp = onUpdateApp
                )
            }
    }
}

@Composable
private fun ConnectionScreen(
    serverConfig: ServerConfig,
    isConnecting: Boolean,
    error: String?,
    onUpdateConfig: (ServerConfig) -> Unit,
    onConnect: () -> Unit,
    onShareLogs: () -> Unit = {},
    onClearLogs: () -> Unit = {},
    onUpdateApp: (ServerConfig) -> Unit = {}
) {
    var host by remember(serverConfig.host) { mutableStateOf(serverConfig.host) }
    var authToken by remember(serverConfig.authToken) { mutableStateOf(serverConfig.authToken) }
    var showToken by remember { mutableStateOf(false) }
    var useTunnel by remember(serverConfig.useTunnel) { mutableStateOf(serverConfig.useTunnel) }
    var tunnelUrl by remember(serverConfig.tunnelUrl) { mutableStateOf(serverConfig.tunnelUrl) }
    var confirmClearLogs by remember { mutableStateOf(false) }
    val trimmedTunnelUrl = tunnelUrl.trim().trimEnd('/')
    val tunnelFormatOk = trimmedTunnelUrl.isBlank() ||
        trimmedTunnelUrl.startsWith("http://") ||
        trimmedTunnelUrl.startsWith("https://")
    val externalTokenMissing = useTunnel && authToken.trim().isBlank()
    val canConnect = if (useTunnel) {
        trimmedTunnelUrl.isNotBlank() && tunnelFormatOk && !externalTokenMissing && !isConnecting
    } else {
        host.isNotBlank() && !isConnecting
    }

    fun emitConfig(
        nextHost: String = host,
        nextToken: String = authToken,
        nextUseTunnel: Boolean = useTunnel,
        nextTunnelUrl: String = tunnelUrl
    ) {
        val cleanTunnelUrl = nextTunnelUrl.trim().trimEnd('/')
        onUpdateConfig(
            serverConfig.copy(
                host = nextHost.trim(),
                authToken = nextToken.trim(),
                useTunnel = nextUseTunnel,
                tunnelUrl = cleanTunnelUrl
            )
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .imePadding()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterVertically)
    ) {
        Icon(
            Icons.Default.Computer,
            contentDescription = null,
            tint = AccentBlue,
            modifier = Modifier.size(54.dp)
        )
        Text(
            "Remote Code on PC",
            color = TextBright,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "APK ${BuildConfig.VERSION_NAME}",
            color = TextSecondary.copy(alpha = 0.7f),
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 0.dp)
        )
        Text(
            "Подключитесь к VS Code на ПК",
            color = TextSecondary,
            fontSize = 12.sp,
            modifier = Modifier.padding(bottom = 2.dp)
        )

        Surface(
            color = DarkSurfaceVariant,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (useTunnel) Icons.Default.Cloud else Icons.Default.Wifi,
                        contentDescription = null,
                        tint = if (useTunnel) AccentGreen else AccentBlue,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        if (useTunnel) "Внешняя сеть" else "Локальная сеть",
                        color = TextBright,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    Switch(
                        checked = useTunnel,
                        onCheckedChange = {
                            useTunnel = it
                            emitConfig(nextUseTunnel = it)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = AccentGreen,
                            checkedTrackColor = AccentGreen.copy(alpha = 0.35f),
                            uncheckedThumbColor = TextSecondary,
                            uncheckedTrackColor = DarkSurfaceVariant
                        )
                    )
                }
                Text(
                    if (useTunnel) {
                        "Введите публичный Keenetic/KeenDNS URL из меню подключения расширения или из настроек роутера."
                    } else {
                        "Телефон и ПК должны быть в одной сети Wi-Fi/LAN. Используйте IP ПК из расширения."
                    },
                    color = TextSecondary,
                    fontSize = 11.sp,
                    lineHeight = 13.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 3.dp)
                )
            }
        }

        if (useTunnel) {
            OutlinedTextField(
                value = tunnelUrl,
                onValueChange = {
                    tunnelUrl = it
                    emitConfig(nextTunnelUrl = it)
                },
                label = { Text("Публичный URL", color = TextSecondary) },
                placeholder = { Text("https://remote.example.com", color = TextSecondary.copy(alpha = 0.5f)) },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Public, contentDescription = null, tint = AccentGreen) },
                modifier = Modifier.fillMaxWidth().height(58.dp),
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                isError = trimmedTunnelUrl.isNotBlank() && !tunnelFormatOk,
                colors = outlinedFieldColors(),
                shape = RoundedCornerShape(12.dp)
            )
        } else {
            OutlinedTextField(
                value = host,
                onValueChange = {
                    host = it
                    emitConfig(nextHost = it)
                },
                label = { Text("IP ПК", color = TextSecondary, fontSize = 12.sp) },
                placeholder = { Text("192.168.1.100", color = TextSecondary.copy(alpha = 0.5f)) },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Wifi, contentDescription = null, tint = AccentBlue) },
                modifier = Modifier.fillMaxWidth().height(58.dp),
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                colors = outlinedFieldColors(),
                shape = RoundedCornerShape(12.dp)
            )
        }

        OutlinedTextField(
            value = authToken,
            onValueChange = {
                authToken = it
                emitConfig(nextToken = it)
            },
            label = { Text("Токен", color = TextSecondary, fontSize = 12.sp) },
            placeholder = {
                Text(
                    if (useTunnel) "обязателен для внешней сети" else "необязательно",
                    color = TextSecondary.copy(alpha = 0.5f)
                )
            },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = AccentBlue) },
            trailingIcon = {
                IconButton(onClick = { showToken = !showToken }) {
                    Icon(
                        if (showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (showToken) "Скрыть токен" else "Показать токен",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            },
            visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().height(58.dp),
            textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
            isError = externalTokenMissing,
            colors = outlinedFieldColors(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        )

        if (externalTokenMissing) {
            Text(
                "Для внешней сети нужен токен доступа из VS Code. Без токена публичный URL не используется.",
                color = ErrorRed,
                fontSize = 11.sp,
                lineHeight = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth()
            )
        }

        error?.let {
            Surface(
                color = ErrorRed.copy(alpha = 0.15f),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Error, contentDescription = null, tint = ErrorRed, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        it,
                        color = ErrorRed,
                        fontSize = 12.sp,
                        lineHeight = 14.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        Button(
            onClick = onConnect,
            enabled = canConnect,
            modifier = Modifier
                .fillMaxWidth()
                .height(46.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = AccentBlue,
                disabledContainerColor = AccentBlue.copy(alpha = 0.3f)
            ),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        ) {
            if (isConnecting) {
                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Подключение...", fontSize = 15.sp)
            } else {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Подключиться", fontSize = 15.sp)
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = onShareLogs,
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 4.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                shape = RoundedCornerShape(11.dp)
            ) {
                Icon(Icons.Default.BugReport, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(5.dp))
                Text("Логи", fontSize = 12.sp, maxLines = 1)
            }
            OutlinedButton(
                onClick = { confirmClearLogs = true },
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 4.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                shape = RoundedCornerShape(11.dp)
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(5.dp))
                Text("Очистить", fontSize = 12.sp, maxLines = 1)
            }
            OutlinedButton(
                onClick = {
                    onUpdateApp(
                        serverConfig.copy(
                            host = host,
                            authToken = authToken,
                            useTunnel = useTunnel,
                            tunnelUrl = trimmedTunnelUrl
                        )
                    )
                },
                modifier = Modifier.weight(1f).height(40.dp),
                contentPadding = PaddingValues(horizontal = 4.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentBlue),
                shape = RoundedCornerShape(11.dp)
            ) {
                Icon(Icons.Default.SystemUpdate, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(5.dp))
                Text("Обновить", fontSize = 12.sp, maxLines = 1)
            }
        }

        if (confirmClearLogs) {
            AlertDialog(
                onDismissRequest = { confirmClearLogs = false },
                title = { Text("Очистить логи?") },
                text = { Text("Локальные диагностические логи приложения будут удалены.") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            confirmClearLogs = false
                            onClearLogs()
                        }
                    ) {
                        Text("Очистить", color = ErrorRed)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmClearLogs = false }) {
                        Text("Отмена")
                    }
                },
                containerColor = DarkSurface
            )
        }

        Text(
            "Расширение Remote Code должно быть запущено в VS Code",
            color = TextSecondary.copy(alpha = 0.55f),
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
    }
}



@Composable
private fun SettingsScreenV2(
    serverConfig: ServerConfig,
    status: WorkspaceStatus?,
    isConnected: Boolean,
    tunnelActive: Boolean,
    tunnelUrl: String?,
    tunnelProvider: String?,
    localIp: String,
    isTunnelStarting: Boolean,
    tunnelError: String?,
    onUpdateConfig: (ServerConfig) -> Unit,
    onReconnect: () -> Unit,
    onDisconnect: () -> Unit,
    onStartTunnel: () -> Unit,
    onStopTunnel: () -> Unit,
    onToggleTunnelMode: (Boolean) -> Unit,
    onBack: () -> Unit,
    onClearLogs: () -> Unit,
    onUpdateApp: (ServerConfig) -> Unit
) {
    var compactHostText by remember(serverConfig.host) { mutableStateOf(serverConfig.host) }
    var compactTokenText by remember(serverConfig.authToken) { mutableStateOf(serverConfig.authToken) }
    var showCompactToken by remember { mutableStateOf(false) }
    var compactUseTunnel by remember(serverConfig.useTunnel) { mutableStateOf(serverConfig.useTunnel) }
    var confirmClearLogs by remember { mutableStateOf(false) }
    var compactTunnelText by remember(serverConfig.tunnelUrl, tunnelUrl) {
        mutableStateOf(serverConfig.tunnelUrl.ifBlank { tunnelUrl.orEmpty() })
    }

    val compactTunnelUrl = compactTunnelText.trim().trimEnd('/')
    val compactConfig = serverConfig.copy(
        host = compactHostText.trim(),
        authToken = compactTokenText.trim(),
        useTunnel = compactUseTunnel,
        tunnelUrl = compactTunnelUrl
    )
    val tunnelFormatOk = compactTunnelUrl.isBlank() ||
        compactTunnelUrl.startsWith("http://") ||
        compactTunnelUrl.startsWith("https://")
    val hasLocalTarget = compactHostText.isNotBlank()
    val hasPublicTarget = compactTunnelUrl.isNotBlank() && tunnelFormatOk
    val externalTokenMissing = compactUseTunnel && compactTokenText.trim().isBlank()
    val canSave = if (compactUseTunnel) hasPublicTarget && !externalTokenMissing else hasLocalTarget
    val hasChanges = compactConfig != serverConfig
    val modeLabel = if (compactUseTunnel) "Внешняя сеть" else "Локальная сеть"
    val remoteStatus = status?.remoteCode
    val extensionVersion = status?.serverVersion?.takeIf { it.isNotBlank() } ?: "—"
    val currentTunnelProvider = tunnelProvider ?: remoteStatus?.tunnelProvider
    val providerLabel = when {
        currentTunnelProvider == "keenetic" ||
            compactTunnelUrl.contains("keenetic", ignoreCase = true) ||
            compactTunnelUrl.contains("keenetic.link", ignoreCase = true) -> "Keenetic"
        currentTunnelProvider == "cloudflared" || compactTunnelUrl.contains("trycloudflare.com", ignoreCase = true) -> "Cloudflare"
        currentTunnelProvider == "ngrok" || compactTunnelUrl.contains("ngrok", ignoreCase = true) -> "ngrok"
        compactTunnelUrl.isNotBlank() -> "ручной URL"
        else -> "не запущен"
    }
    val authLabel = when {
        remoteStatus?.authRequired != true -> "не нужен"
        remoteStatus.authOk -> "принят"
        compactTokenText.isBlank() -> "нужен"
        else -> "не принят"
    }
    val compactTunnelError = tunnelError
        ?.replace('\n', ' ')
        ?.replace("Установите ngrok.exe и добавьте его в PATH либо вставьте готовый публичный URL вручную в настройках приложения.", "Сформируйте Keenetic URL в VS Code или укажите публичный URL вручную.")
    val compactFieldHeight = 62.dp

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.height(34.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack, modifier = Modifier.size(34.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = TextSecondary, modifier = Modifier.size(20.dp))
            }
            Spacer(modifier = Modifier.width(4.dp))
            Text("Настройки", color = TextBright, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        }

        Card(colors = CardDefaults.cardColors(containerColor = CardBg), shape = RoundedCornerShape(12.dp)) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                InfoSettingRow("Статус", if (isConnected) "Подключено" else "Отключено")
                InfoSettingRow("Режим", modeLabel)
                if (compactUseTunnel || tunnelActive || compactTunnelUrl.isNotBlank()) {
                    InfoSettingRow("Провайдер", providerLabel)
                }
                InfoSettingRow("APK", BuildConfig.VERSION_NAME)
                InfoSettingRow("Расширение", extensionVersion)
                InfoSettingRow("Токен", authLabel)
                InfoSettingRow("VS Code", status?.version ?: "—")
                if (localIp.isNotBlank()) InfoSettingRow("IP ПК", localIp)
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = CardBg), shape = RoundedCornerShape(12.dp)) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Link, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Подключение", color = TextBright, fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.weight(1f))
                    Text("Внешняя", color = TextSecondary, fontSize = 12.sp)
                    Switch(
                        checked = compactUseTunnel,
                        onCheckedChange = {
                            compactUseTunnel = it
                            if (!it) onToggleTunnelMode(false)
                        },
                        modifier = Modifier.height(28.dp),
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = AccentGreen,
                            checkedTrackColor = AccentGreen.copy(alpha = 0.35f),
                            uncheckedThumbColor = TextSecondary,
                            uncheckedTrackColor = DarkSurfaceVariant
                        )
                    )
                }

                OutlinedTextField(
                    value = compactHostText,
                    onValueChange = { compactHostText = it },
                    label = { Text("IP ПК", color = TextSecondary, fontSize = 12.sp) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 15.sp),
                    leadingIcon = { Icon(Icons.Default.Computer, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(18.dp)) },
                    modifier = Modifier.fillMaxWidth().height(compactFieldHeight),
                    colors = outlinedFieldColors(),
                    shape = RoundedCornerShape(11.dp)
                )

                if (compactUseTunnel || tunnelActive || compactTunnelText.isNotBlank()) {
                    OutlinedTextField(
                        value = compactTunnelText,
                        onValueChange = { compactTunnelText = it },
                        label = { Text("Публичный URL", color = TextSecondary, fontSize = 12.sp) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 14.sp),
                        leadingIcon = { Icon(Icons.Default.Public, contentDescription = null, tint = AccentGreen, modifier = Modifier.size(18.dp)) },
                        modifier = Modifier.fillMaxWidth().height(compactFieldHeight),
                        enabled = compactUseTunnel || tunnelActive,
                        isError = compactTunnelUrl.isNotBlank() && !tunnelFormatOk,
                        colors = outlinedFieldColors(),
                        shape = RoundedCornerShape(11.dp)
                    )
                    Text(
                        if (providerLabel == "Keenetic") {
                            "Keenetic URL используется вместо IP ПК из внешней сети."
                        } else {
                            "Кнопка сформирует URL в расширении или возьмет сохраненный."
                        },
                        color = TextSecondary,
                        fontSize = 11.sp,
                        lineHeight = 13.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                OutlinedTextField(
                    value = compactTokenText,
                    onValueChange = { compactTokenText = it },
                    label = { Text("Токен доступа", color = TextSecondary, fontSize = 12.sp) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 14.sp),
                    leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(18.dp)) },
                    trailingIcon = {
                        IconButton(onClick = { showCompactToken = !showCompactToken }) {
                            Icon(
                                if (showCompactToken) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (showCompactToken) "Скрыть токен" else "Показать токен",
                                tint = TextSecondary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    },
                    visualTransformation = if (showCompactToken) VisualTransformation.None else PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().height(compactFieldHeight),
                    colors = outlinedFieldColors(),
                    shape = RoundedCornerShape(11.dp)
                )
                Text(
                    when {
                        externalTokenMissing -> "Для внешней сети нужен токен из VS Code: Remote Code -> Подключение."
                        authLabel == "нужен" -> "Скопируйте токен в VS Code: меню Remote Code -> Подключение."
                        authLabel == "не принят" -> "Токен не совпал с настройками расширения."
                        else -> "Локальный и внешний режим используют один токен."
                    },
                    color = if (externalTokenMissing || authLabel == "не принят" || authLabel == "нужен") ErrorRed else TextSecondary,
                    fontSize = 11.sp,
                    lineHeight = 13.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                val externalSelected = (compactUseTunnel && hasPublicTarget) || tunnelActive
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = if (externalSelected) onStopTunnel else onStartTunnel,
                        enabled = !isTunnelStarting && (externalSelected || !externalTokenMissing),
                        modifier = Modifier.weight(1f).height(42.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = if (externalSelected) DarkSurfaceVariant else AccentGreen),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        if (isTunnelStarting) {
                            CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp, color = TextBright)
                        } else {
                            Icon(if (externalSelected) Icons.Default.WifiOff else Icons.Default.Link, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(if (externalSelected) "Локально" else "Сформировать", maxLines = 1, fontSize = 13.sp)
                    }
                    Button(
                        onClick = {
                            onUpdateConfig(compactConfig)
                            onReconnect()
                        },
                        enabled = canSave,
                        modifier = Modifier.weight(1f).height(42.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (hasChanges) AccentBlue else DarkSurfaceVariant,
                            disabledContainerColor = DarkSurfaceVariant
                        ),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(if (hasChanges) Icons.Default.Save else Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(if (hasChanges) "Сохранить" else "Проверить", maxLines = 1)
                    }
                }

                compactTunnelError?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        color = ErrorRed,
                        fontSize = 11.sp,
                        lineHeight = 14.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { onUpdateApp(compactConfig) },
                modifier = Modifier.weight(1f).height(42.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentBlue),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("Обновить", maxLines = 1, fontSize = 13.sp)
            }
            OutlinedButton(
                onClick = { confirmClearLogs = true },
                modifier = Modifier.weight(1f).height(42.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("Очистить", maxLines = 1, fontSize = 13.sp)
            }
            OutlinedButton(
                onClick = onDisconnect,
                modifier = Modifier.weight(1f).height(42.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("Откл.", maxLines = 1, fontSize = 13.sp)
            }
        }

        if (confirmClearLogs) {
            AlertDialog(
                onDismissRequest = { confirmClearLogs = false },
                title = { Text("Очистить логи?", color = TextBright) },
                text = { Text("Локальные диагностические логи приложения будут удалены.", color = TextPrimary) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            confirmClearLogs = false
                            onClearLogs()
                        }
                    ) {
                        Text("Очистить", color = ErrorRed)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { confirmClearLogs = false }) {
                        Text("Отмена")
                    }
                },
                containerColor = DarkSurface
            )
        }
    }
}

@Composable
private fun InfoSettingRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp)
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            value,
            color = TextPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun outlinedFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedBorderColor = AccentBlue,
    unfocusedBorderColor = DividerColor,
    cursorColor = AccentBlue,
    focusedContainerColor = DarkSurfaceVariant,
    unfocusedContainerColor = DarkSurfaceVariant,
    focusedLabelColor = AccentBlue,
    unfocusedLabelColor = TextSecondary,
    focusedLeadingIconColor = AccentBlue,
    unfocusedLeadingIconColor = TextSecondary
)
