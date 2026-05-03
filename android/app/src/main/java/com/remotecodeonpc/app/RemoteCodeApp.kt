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
                        onUpdateApp = { onUpdateApp(state.serverConfig) }
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
    var host by remember { mutableStateOf(serverConfig.host) }
    var port by remember { mutableStateOf(serverConfig.port.toString()) }
    var authToken by remember { mutableStateOf(serverConfig.authToken) }
    var confirmClearLogs by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Computer,
            contentDescription = null,
            tint = AccentBlue,
            modifier = Modifier.size(80.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "Remote Code on PC",
            color = TextBright,
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            "APK ${BuildConfig.VERSION_NAME}",
            color = TextSecondary.copy(alpha = 0.7f),
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 4.dp)
        )
        Text(
            "Подключитесь к VS Code на ПК",
            color = TextSecondary,
            fontSize = 14.sp,
            modifier = Modifier.padding(bottom = 32.dp)
        )

        // IP адрес
        OutlinedTextField(
            value = host,
            onValueChange = {
                host = it
                onUpdateConfig(serverConfig.copy(host = it))
            },
            label = { Text("IP-адрес ПК", color = TextSecondary) },
            placeholder = { Text("192.168.1.100", color = TextSecondary.copy(alpha = 0.5f)) },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Wifi, contentDescription = null, tint = AccentBlue) },
            modifier = Modifier.fillMaxWidth(),
            colors = outlinedFieldColors(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        )
        Spacer(modifier = Modifier.height(12.dp))

        // Порт
        OutlinedTextField(
            value = port,
            onValueChange = {
                port = it
                onUpdateConfig(serverConfig.copy(port = it.toIntOrNull() ?: 8799))
            },
            label = { Text("Порт", color = TextSecondary) },
            placeholder = { Text("8799", color = TextSecondary.copy(alpha = 0.5f)) },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Tag, contentDescription = null, tint = AccentBlue) },
            modifier = Modifier.fillMaxWidth(),
            colors = outlinedFieldColors(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        )
        Spacer(modifier = Modifier.height(12.dp))

        // Токен (опционально)
        OutlinedTextField(
            value = authToken,
            onValueChange = {
                authToken = it
                onUpdateConfig(serverConfig.copy(authToken = it))
            },
            label = { Text("Токен (опционально)", color = TextSecondary) },
            placeholder = { Text("Оставьте пустым", color = TextSecondary.copy(alpha = 0.5f)) },
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = AccentBlue) },
            modifier = Modifier.fillMaxWidth(),
            colors = outlinedFieldColors(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        )

        // Ошибка
        error?.let {
            Spacer(modifier = Modifier.height(12.dp))
            Surface(
                color = ErrorRed.copy(alpha = 0.15f),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Error, contentDescription = null, tint = ErrorRed, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(it, color = ErrorRed, fontSize = 13.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Кнопка подключения
        Button(
            onClick = onConnect,
            enabled = host.isNotBlank() && !isConnecting,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = AccentBlue,
                disabledContainerColor = AccentBlue.copy(alpha = 0.3f)
            ),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        ) {
            if (isConnecting) {
                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Подключение...", fontSize = 16.sp)
            } else {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Подключиться", fontSize = 16.sp)
            }
        }

        // Кнопка отправки логов (всегда видна)
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedButton(
            onClick = onShareLogs,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.BugReport, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Отправить логи", fontSize = 14.sp)
        }

        Spacer(modifier = Modifier.height(8.dp))
        OutlinedButton(
            onClick = { confirmClearLogs = true },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Очистить логи", fontSize = 14.sp)
        }

        Spacer(modifier = Modifier.height(8.dp))
        OutlinedButton(
            onClick = {
                onUpdateApp(
                    serverConfig.copy(
                        host = host,
                        port = port.toIntOrNull() ?: 8799,
                        authToken = authToken
                    )
                )
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentBlue),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.SystemUpdate, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Обновить из GitHub", fontSize = 14.sp)
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

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            "Убедитесь, что расширение Remote Code on PC\nзапущено в VS Code на вашем ПК",
            color = TextSecondary.copy(alpha = 0.6f),
            fontSize = 12.sp,
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
    onUpdateApp: () -> Unit
) {
    var compactHostText by remember(serverConfig.host) { mutableStateOf(serverConfig.host) }
    var compactPortText by remember(serverConfig.port) { mutableStateOf(serverConfig.port.toString()) }
    var compactTokenText by remember(serverConfig.authToken) { mutableStateOf(serverConfig.authToken) }
    var compactUseTunnel by remember(serverConfig.useTunnel) { mutableStateOf(serverConfig.useTunnel) }
    var confirmClearLogs by remember { mutableStateOf(false) }
    var compactTunnelText by remember(serverConfig.tunnelUrl, tunnelUrl) {
        mutableStateOf(serverConfig.tunnelUrl.ifBlank { tunnelUrl.orEmpty() })
    }

    val compactTunnelUrl = compactTunnelText.trim().trimEnd('/')
    val compactPort = compactPortText.toIntOrNull()?.coerceIn(1, 65535) ?: serverConfig.port
    val compactConfig = serverConfig.copy(
        host = compactHostText.trim(),
        port = compactPort,
        authToken = compactTokenText.trim(),
        useTunnel = compactUseTunnel && compactTunnelUrl.isNotBlank(),
        tunnelUrl = compactTunnelUrl
    )
    val tunnelFormatOk = compactTunnelUrl.isBlank() ||
        compactTunnelUrl.startsWith("http://") ||
        compactTunnelUrl.startsWith("https://")
    val canSave = compactHostText.isNotBlank() && compactPortText.toIntOrNull() != null && tunnelFormatOk
    val hasChanges = compactConfig != serverConfig
    val modeLabel = if (serverConfig.useTunnel) "Внешняя сеть" else "Локальная сеть"
    val remoteStatus = status?.remoteCode
    val extensionVersion = status?.serverVersion?.takeIf { it.isNotBlank() } ?: "—"
    val authLabel = when {
        remoteStatus?.authRequired != true -> "не нужен"
        remoteStatus.authOk -> "принят"
        compactTokenText.isBlank() -> "нужен"
        else -> "не принят"
    }
    val compactTunnelError = tunnelError
        ?.replace('\n', ' ')
        ?.replace("Установите ngrok.exe и добавьте его в PATH либо вставьте готовый публичный URL вручную в настройках приложения.", "Поставьте ngrok/cloudflared или вставьте публичный URL вручную.")
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

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = compactHostText,
                        onValueChange = { compactHostText = it },
                        label = { Text("IP ПК", color = TextSecondary, fontSize = 12.sp) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 15.sp),
                        leadingIcon = { Icon(Icons.Default.Computer, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(18.dp)) },
                        modifier = Modifier.weight(1f).height(compactFieldHeight),
                        colors = outlinedFieldColors(),
                        shape = RoundedCornerShape(11.dp)
                    )
                    OutlinedTextField(
                        value = compactPortText,
                        onValueChange = { compactPortText = it.filter(Char::isDigit).take(5) },
                        label = { Text("Порт", color = TextSecondary, fontSize = 12.sp) },
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 15.sp),
                        isError = compactPortText.toIntOrNull() == null,
                        modifier = Modifier.width(96.dp).height(compactFieldHeight),
                        colors = outlinedFieldColors(),
                        shape = RoundedCornerShape(11.dp)
                    )
                }

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
                }

                OutlinedTextField(
                    value = compactTokenText,
                    onValueChange = { compactTokenText = it },
                    label = { Text("Токен доступа", color = TextSecondary, fontSize = 12.sp) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 14.sp),
                    leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(18.dp)) },
                    modifier = Modifier.fillMaxWidth().height(compactFieldHeight),
                    colors = outlinedFieldColors(),
                    shape = RoundedCornerShape(11.dp)
                )
                Text(
                    when (authLabel) {
                        "нужен" -> "Скопируйте токен в VS Code: меню Remote Code -> Подключение."
                        "не принят" -> "Токен не совпал с настройками расширения."
                        else -> "Локальный и внешний режим используют один токен."
                    },
                    color = if (authLabel == "не принят" || authLabel == "нужен") ErrorRed else TextSecondary,
                    fontSize = 11.sp,
                    lineHeight = 13.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = if (tunnelActive) onStopTunnel else onStartTunnel,
                        enabled = !isTunnelStarting,
                        modifier = Modifier.weight(1f).height(42.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = if (tunnelActive) ErrorRed else AccentGreen),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        if (isTunnelStarting) {
                            CircularProgressIndicator(modifier = Modifier.size(17.dp), strokeWidth = 2.dp, color = TextBright)
                        } else {
                            Icon(if (tunnelActive) Icons.Default.WifiOff else Icons.Default.Wifi, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(if (tunnelActive) "Стоп" else "Туннель", maxLines = 1)
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
                onClick = onUpdateApp,
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
