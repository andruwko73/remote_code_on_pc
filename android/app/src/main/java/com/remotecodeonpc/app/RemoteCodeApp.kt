package com.remotecodeonpc.app

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
                        agents = state.chatAgents,
                        selectedAgent = state.selectedAgent,
                        chatHistory = state.chatHistory,
                        conversations = state.conversations,
                        currentChatId = state.currentChatId,
                        isChatLoading = state.isChatLoading,
                        chatError = state.chatError,
                        isThinking = state.isThinking,
                        folders = state.folders,
                        currentFiles = state.currentFiles,
                        fileContent = state.fileContent,
                        isLoadingFiles = state.isLoadingFiles,
                        onSendMessage = { viewModel.sendCodexMessage(it) },
                        onSelectAgent = { viewModel.selectAgent(it) },
                        onNewChat = { viewModel.newChat() },
                        onSwitchChat = { viewModel.switchToChat(it) },
                        codexStatus = state.codexStatus,
                        codexModels = state.codexModels,
                        codexSelectedModel = state.codexSelectedModel,
                        codexChatHistory = state.codexChatHistory,
                        codexActionEvents = state.codexActionEvents,
                        codexSendResult = state.codexSendResult,
                        codexThreads = state.codexThreads,
                        currentCodexThreadId = state.currentCodexThreadId,
                        isCodexLoading = state.isCodexLoading,
                        codexError = state.codexError,
                        onSendCodexMessage = { text, attachments -> viewModel.sendCodexMessage(text, attachments) },
                        onSelectCodexModel = { viewModel.selectCodexModel(it) },
                        onLaunchCodex = { viewModel.launchCodex() },
                        onLoadCodexThreads = { viewModel.loadCodexThreads() },
                        onSwitchCodexThread = { viewModel.switchCodexThread(it) },
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
                        status = state.codexStatus,
                        models = state.codexModels,
                        selectedModel = state.codexSelectedModel,
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
                        onLaunchCodex = { viewModel.launchCodex() },
                        onLoadThreads = { viewModel.loadCodexThreads() },
                        onSwitchThread = { viewModel.switchCodexThread(it) },
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
                    "settings" -> SettingsScreen(
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
                // Не используем CircularProgressIndicator — вызывает NoSuchMethodError
                // на некоторых версиях Android из-за бага Compose Animation
                Text("⏳", fontSize = 18.sp)
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
            onClick = onClearLogs,
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
private fun SettingsScreen(
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
    val scrollState = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(16.dp)
            .verticalScroll(scrollState),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.size(40.dp)
            ) {
                Icon(
                    Icons.Default.ArrowBack,
                    contentDescription = "Back",
                    tint = TextSecondary
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
            Text("Настройки", color = TextBright, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }

        // Информация о подключении
        Card(
            colors = CardDefaults.cardColors(containerColor = CardBg),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = AccentBlue)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Подключение", color = TextBright, fontWeight = FontWeight.SemiBold)
                }
                Spacer(modifier = Modifier.height(12.dp))
                InfoSettingRow("Статус", if (isConnected) "🟢 Подключено" else "🔴 Отключено")
                InfoSettingRow("Режим", if (serverConfig.useTunnel) "🌐 Интернет (туннель)" else "📡 Локальная сеть")
                InfoSettingRow("Сервер", "${serverConfig.host}:${serverConfig.port}")
                InfoSettingRow("APK", BuildConfig.VERSION_NAME)
                if (tunnelUrl != null) InfoSettingRow("Туннель", tunnelUrl)
                if (localIp.isNotBlank()) InfoSettingRow("Локальный IP", localIp)
                InfoSettingRow("Версия VS Code", status?.version ?: "—")
                InfoSettingRow("Платформа", status?.platform ?: "—")
            }
        }

        // Туннель (интернет-доступ)
        Card(
            colors = CardDefaults.cardColors(containerColor = CardBg),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (tunnelActive) Icons.Default.Wifi else Icons.Default.WifiOff,
                        contentDescription = null,
                        tint = if (tunnelActive) AccentGreen else TextSecondary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Интернет-доступ", color = TextBright, fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.weight(1f))
                    // Индикатор активности
                    Surface(
                        color = if (tunnelActive) AccentGreen.copy(alpha = 0.2f) else DarkSurfaceVariant,
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            if (tunnelActive) "АКТИВЕН" else "ВЫКЛ",
                            color = if (tunnelActive) AccentGreen else TextSecondary,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))

                // Статус туннеля
                InfoSettingRow("Статус", if (tunnelActive) "🟢 Активен" else "⚪ Неактивен")
                if (tunnelUrl != null) InfoSettingRow("Публичный URL", tunnelUrl)
                if (localIp.isNotBlank()) InfoSettingRow("Локальный IP", localIp)
                InfoSettingRow("Порт", serverConfig.port.toString())

                // Ошибка туннеля
                if (tunnelError != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(tunnelError, color = ErrorRed, fontSize = 12.sp)
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Кнопки управления туннелем
                if (tunnelActive) {
                    Button(
                        onClick = onStopTunnel,
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = ErrorRed),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.WifiOff, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Остановить туннель")
                    }
                } else {
                    Button(
                        onClick = onStartTunnel,
                        enabled = !isTunnelStarting,
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        if (isTunnelStarting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = TextBright
                            )
                        } else {
                            Icon(Icons.Default.Wifi, contentDescription = null)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (isTunnelStarting) "Запуск..." else "Запустить туннель (ngrok)")
                    }
                }

                // Переключение режима LAN / Internet
                if (tunnelActive && tunnelUrl != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Использовать туннель", color = TextPrimary, fontSize = 14.sp)
                        Switch(
                            checked = serverConfig.useTunnel,
                            onCheckedChange = { onToggleTunnelMode(it) },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = AccentGreen,
                                checkedTrackColor = AccentGreen.copy(alpha = 0.3f),
                                uncheckedThumbColor = TextSecondary,
                                uncheckedTrackColor = DarkSurfaceVariant
                            )
                        )
                    }

                    if (serverConfig.useTunnel) {
                        Surface(
                            color = AccentGreen.copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.Cloud, contentDescription = null, tint = AccentGreen, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    "Подключение через интернет. Убедитесь, что ngrok запущен на ПК.",
                                    color = TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // VS Code информация
        status?.let { s ->
            Card(
                colors = CardDefaults.cardColors(containerColor = CardBg),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Computer, contentDescription = null, tint = AccentGreen)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("VS Code", color = TextBright, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    InfoSettingRow("Приложение", s.appName)
                    InfoSettingRow("Uptime", "${s.uptime.toInt()} сек")
                    InfoSettingRow("Память", "${s.memoryUsage / 1024 / 1024} MB")
                }
            }
        }

        // Кнопки управления
        Button(
            onClick = onReconnect,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Переподключиться")
        }

        OutlinedButton(
            onClick = onUpdateApp,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentBlue),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.SystemUpdate, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Обновить из GitHub")
        }

        OutlinedButton(
            onClick = onClearLogs,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.Delete, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Очистить логи")
        }

        OutlinedButton(
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.PowerSettingsNew, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Отключиться")
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun InfoSettingRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp)
        Text(value, color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
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
