package com.remotecodeonpc.app.ui.screens

import android.database.Cursor
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.CodexModel
import com.remotecodeonpc.app.CodexStatus
import com.remotecodeonpc.app.CodexSendResponse
import com.remotecodeonpc.app.CodexChatMessage
import com.remotecodeonpc.app.CodexActionEvent
import com.remotecodeonpc.app.CodexThread
import com.remotecodeonpc.app.FileContent
import com.remotecodeonpc.app.FileTreeItem
import com.remotecodeonpc.app.FoldersResponse
import com.remotecodeonpc.app.MessageAttachment
import com.remotecodeonpc.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodexScreen(
    // Codex params
    status: CodexStatus?,
    models: List<CodexModel>,
    selectedModel: String,
    chatHistory: List<CodexChatMessage>,
    actionEvents: List<CodexActionEvent>,
    sendResult: CodexSendResponse?,
    threads: List<CodexThread>,
    currentThreadId: String,
    isLoading: Boolean,
    error: String?,
    // Files params (same as VSCodeScreen)
    folders: FoldersResponse?,
    currentFiles: FileTreeItem?,
    fileContent: FileContent?,
    isLoadingFiles: Boolean,
    // Callbacks
    onSendMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectModel: (String) -> Unit,
    onLaunchCodex: () -> Unit,
    onLoadThreads: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onRespondToAction: (String, Boolean) -> Unit,
    // Files callbacks (same as VSCodeScreen)
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Чат", "Файлы")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .background(DarkBackground)
    ) {
        // Top panel (UNIFIED STYLE with VSCodeScreen)
        Surface(
            color = DarkSurface,
            shadowElevation = 2.dp
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.SmartToy,
                        contentDescription = "Codex CLI",
                        tint = AccentBlue,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "Codex CLI",
                        color = TextBright,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    // Settings button
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Outlined.Settings,
                            contentDescription = "Настройки",
                            tint = TextSecondary
                        )
                    }
                }
                // Tabs (same as VSCodeScreen)
                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = DarkSurface,
                    contentColor = AccentBlue,
                    divider = {}
                ) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = {
                                Text(
                                    title,
                                    color = if (selectedTab == index) AccentBlue else TextSecondary,
                                    fontWeight = if (selectedTab == index) FontWeight.SemiBold else FontWeight.Normal,
                                    fontSize = 14.sp
                                )
                            }
                        )
                    }
                }
            }
        }

        // Content
        when (selectedTab) {
            0 -> CodexChatTab(
                status = status,
                models = models,
                selectedModel = selectedModel,
                chatHistory = chatHistory,
                actionEvents = actionEvents,
                sendResult = sendResult,
                threads = threads,
                currentThreadId = currentThreadId,
                isLoading = isLoading,
                error = error,
                onSendMessage = onSendMessage,
                onSelectModel = onSelectModel,
                onLaunchCodex = onLaunchCodex,
                onLoadThreads = onLoadThreads,
                onSwitchThread = onSwitchThread,
                onRespondToAction = onRespondToAction
            )
            1 -> FilesScreen(
                folders = folders,
                currentFiles = currentFiles,
                fileContent = fileContent,
                isLoading = isLoadingFiles,
                onNavigateToDir = onNavigateToDir,
                onOpenFile = onOpenFile,
                onOpenFolder = onOpenFolder,
                onGoUp = onGoUp,
                onBack = { selectedTab = 0 }
            )
        }
    }
}

@Composable
fun CodexChatTab(
    status: CodexStatus?,
    models: List<CodexModel>,
    selectedModel: String,
    chatHistory: List<CodexChatMessage>,
    actionEvents: List<CodexActionEvent>,
    sendResult: CodexSendResponse?,
    threads: List<CodexThread>,
    currentThreadId: String,
    isLoading: Boolean,
    error: String?,
    onSendMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectModel: (String) -> Unit,
    onLaunchCodex: () -> Unit,
    onLoadThreads: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onRespondToAction: (String, Boolean) -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    var showModelSelector by remember { mutableStateOf(false) }
    var showThreads by remember { mutableStateOf(false) }
    var attachments by remember { mutableStateOf<List<MessageAttachment>>(emptyList()) }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val attachmentScope = rememberCoroutineScope()
    val attachmentPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        attachmentScope.launch {
            var errorMessage: String? = null
            val next = withContext(Dispatchers.IO) {
                uris.take(4).mapNotNull { uri ->
                    runCatching { context.readMessageAttachment(uri) }
                        .onFailure { errorMessage = "Attachment failed: ${it.message}" }
                        .getOrNull()
                }
            }
            errorMessage?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
            if (next.isNotEmpty()) {
                attachments = (attachments + next).takeLast(4)
            }
        }
    }

    fun submitMessage() {
        if (messageText.isBlank() && attachments.isEmpty()) return
        onSendMessage(messageText.ifBlank { "Посмотри вложение." }, attachments)
        messageText = ""
        attachments = emptyList()
    }

    LaunchedEffect(chatHistory.size, chatHistory.lastOrNull()?.content) {
        if (chatHistory.isNotEmpty()) {
            listState.animateScrollToItem(chatHistory.size - 1)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .background(DarkBackground)
    ) {
        // Model selector + Codex status bar
        Surface(
            color = DarkSurface,
            shadowElevation = 1.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Model chip (round button, same style as AgentChip in ChatScreen)
                Box {
                    CodexModelChip(
                        modelName = selectedModel,
                        models = models,
                        onClick = { showModelSelector = true }
                    )
                    DropdownMenu(
                        expanded = showModelSelector,
                        onDismissRequest = { showModelSelector = false },
                        modifier = Modifier
                            .background(DarkSurface)
                            .widthIn(min = 220.dp)
                            .heightIn(max = 400.dp)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Auto (по умолчанию)", color = if (selectedModel.isEmpty()) AccentBlue else TextPrimary) },
                            onClick = { onSelectModel(""); showModelSelector = false },
                            modifier = Modifier.background(DarkSurface)
                        )
                        models.forEach { model ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(model.name, color = if (model.id == selectedModel) AccentBlue else TextPrimary,
                                            fontWeight = if (model.id == selectedModel) FontWeight.Bold else FontWeight.Normal)
                                        Text(model.id, color = TextSecondary, fontSize = 11.sp)
                                    }
                                },
                                onClick = { onSelectModel(model.id); showModelSelector = false },
                                modifier = Modifier.background(DarkSurface)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.weight(1f))

                // Codex status (compact)
                if (status != null) {
                    Text(
                        when {
                            status.installed && status.isRunning -> "●"
                            status.installed -> "○"
                            else -> "✕"
                        },
                        color = when {
                            status.installed && status.isRunning -> AccentGreen
                            status.installed -> AccentYellow
                            else -> ErrorRed
                        },
                        fontSize = 13.sp
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        when {
                            status.installed && status.isRunning -> "Запущен"
                            status.installed -> "Установлен"
                            else -> "Не установлен"
                        },
                        color = TextSecondary,
                        fontSize = 12.sp
                    )
                }

                Spacer(modifier = Modifier.width(4.dp))

                // Кнопка истории
                IconButton(onClick = { showThreads = true }) {
                    Icon(Icons.Default.History, contentDescription = "История", tint = TextSecondary)
                }
                // Кнопка обновления
                IconButton(onClick = {
                    onLaunchCodex()
                    onLoadThreads()
                }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = TextSecondary)
                }
            }
        }

        // Threads dialog (history)
        if (showThreads) {
            AlertDialog(
                onDismissRequest = { showThreads = false },
                title = { Text("История Codex", color = TextBright) },
                text = {
                    if (threads.isEmpty()) {
                        Text("Нет активных тредов", color = TextSecondary)
                    } else {
                        LazyColumn {
                            items(threads) { thread ->
                                Surface(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                    color = if (thread.id == currentThreadId) AccentBlue.copy(alpha = 0.22f) else DarkSurfaceVariant,
                                    shape = RoundedCornerShape(8.dp)
                                    ,
                                    onClick = {
                                        onSwitchThread(thread.id)
                                        showThreads = false
                                    }
                                ) {
                                    Column(modifier = Modifier.padding(12.dp)) {
                                        Text(thread.title, color = TextBright, fontWeight = FontWeight.Medium)
                                        Text(thread.id, color = TextSecondary, fontSize = 11.sp)
                                    }
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showThreads = false }) {
                        Text("Закрыть", color = AccentBlue)
                    }
                },
                containerColor = DarkSurface
            )
        }

        // Send result
        if (sendResult != null) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 2.dp),
                color = DarkSurfaceVariant,
                shape = RoundedCornerShape(8.dp)
            ) {
                Row(
                    modifier = Modifier.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        if (sendResult.success) Icons.Default.CheckCircle else Icons.Default.Error,
                        contentDescription = null,
                        tint = if (sendResult.success) AccentGreen else ErrorRed,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        if (sendResult.success) "Отправлено" else (sendResult.error ?: "Ошибка"),
                        color = TextBright,
                        fontSize = 12.sp
                    )
                }
            }
        }

        if (actionEvents.isNotEmpty()) {
            CodexActionStrip(actionEvents.takeLast(6), onRespondToAction)
        }

        // Error
        if (error != null) {
            Text(
                error,
                color = ErrorRed,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }

        // Chat area
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(12.dp),
            contentAlignment = Alignment.Center
        ) {
            if (chatHistory.isNotEmpty()) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(chatHistory) { msg ->
                        CodexMessageBubble(msg)
                    }
                }
            } else if (sendResult != null && sendResult.success) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    item {
                        Surface(
                            color = DarkSurfaceVariant,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                sendResult.message ?: "Запрос выполнен",
                                color = TextPrimary,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                }
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.SmartToy,
                        contentDescription = null,
                        tint = TextSecondary.copy(alpha = 0.2f),
                        modifier = Modifier.size(64.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Введите запрос для Codex CLI", color = TextSecondary)
                    Text("Ответ появится здесь", color = TextSecondary.copy(alpha = 0.6f), fontSize = 12.sp)
                }
            }
        }

        // Input field
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = DarkSurface,
            shadowElevation = 8.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 10.dp)
            ) {
                if (attachments.isNotEmpty()) {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 92.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(attachments) { attachment ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(DarkSurfaceVariant, RoundedCornerShape(8.dp))
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.AttachFile, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    attachment.name,
                                    color = TextPrimary,
                                    fontSize = 12.sp,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1
                                )
                                IconButton(
                                    onClick = { attachments = attachments - attachment },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = "Убрать вложение", tint = TextSecondary, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { attachmentPicker.launch("*/*") },
                        enabled = !isLoading,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            Icons.Default.AttachFile,
                            contentDescription = "Прикрепить файл",
                            tint = if (isLoading) TextSecondary.copy(alpha = 0.5f) else AccentBlue
                        )
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    OutlinedTextField(
                        value = messageText,
                        onValueChange = { messageText = it },
                        placeholder = { Text("Запрос в VS Code...", color = TextSecondary) },
                        modifier = Modifier.weight(1f),
                        maxLines = 4,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = AccentBlue,
                            unfocusedBorderColor = DividerColor,
                            cursorColor = AccentBlue,
                            focusedContainerColor = DarkSurfaceVariant,
                            unfocusedContainerColor = DarkSurfaceVariant
                        ),
                        shape = RoundedCornerShape(20.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { submitMessage() })
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = { submitMessage() },
                        enabled = (messageText.isNotBlank() || attachments.isNotEmpty()) && !isLoading,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = AccentBlue,
                            disabledContainerColor = AccentBlue.copy(alpha = 0.3f)
                        ),
                        modifier = Modifier.size(48.dp)
                    ) {
                        if (isLoading) {
                            Text("вЏі", fontSize = 18.sp)
                        } else {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Отправить",
                                tint = TextBright
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CodexActionStrip(
    events: List<CodexActionEvent>,
    onRespondToAction: (String, Boolean) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 132.dp)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        items(events) { event ->
            val isFailed = event.status == "failed"
            val isDone = event.status == "completed"
            Surface(
                color = when {
                    isFailed -> ErrorRed.copy(alpha = 0.14f)
                    isDone -> AccentGreen.copy(alpha = 0.10f)
                    else -> AccentBlue.copy(alpha = 0.10f)
                },
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = when {
                            event.type.contains("patch") -> Icons.Default.Build
                            event.type.contains("error") -> Icons.Default.Error
                            event.type.contains("command") -> Icons.Default.Terminal
                            else -> Icons.Default.PlayArrow
                        },
                        contentDescription = null,
                        tint = when {
                            isFailed -> ErrorRed
                            isDone -> AccentGreen
                            else -> AccentBlue
                        },
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(event.title.ifBlank { event.type }, color = TextBright, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                        if (event.detail.isNotBlank()) {
                            Text(event.detail, color = TextSecondary, fontSize = 11.sp, maxLines = 2)
                        }
                    }
                    Text(event.status, color = TextSecondary, fontSize = 10.sp)
                    if (event.actionable) {
                        Spacer(modifier = Modifier.width(8.dp))
                        TextButton(onClick = { onRespondToAction(event.id, false) }) {
                            Text("Deny", color = ErrorRed, fontSize = 11.sp)
                        }
                        Button(
                            onClick = { onRespondToAction(event.id, true) },
                            colors = ButtonDefaults.buttonColors(containerColor = AccentGreen),
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp)
                        ) {
                            Text("Allow", color = TextBright, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CodexMessageBubble(message: CodexChatMessage) {
    val isUser = message.role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            color = if (isUser) AccentBlue.copy(alpha = 0.22f) else DarkSurfaceVariant,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(if (isUser) 0.86f else 0.96f)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (isUser) "Вы" else "Codex",
                        color = if (isUser) AccentBlue else AccentGreen,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                    if (!isUser && message.isStreaming) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("пишет...", color = TextSecondary, fontSize = 11.sp)
                    }
                    message.model?.takeIf { it.isNotBlank() }?.let {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(it, color = TextSecondary, fontSize = 10.sp)
                    }
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    message.content.ifBlank { "..." },
                    color = TextPrimary,
                    fontSize = 13.sp
                )
            }
        }
    }
}

@Composable
private fun CodexModelChip(
    modelName: String,
    models: List<CodexModel>,
    onClick: () -> Unit
) {
    val currentModel = models.find { it.id == modelName }
    val displayName = currentModel?.name ?: modelName.ifBlank { "Auto" }

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = AccentBlue.copy(alpha = 0.15f),
        modifier = Modifier.heightIn(min = 36.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.SmartToy,
                contentDescription = null,
                tint = AccentBlue,
                modifier = Modifier.size(16.dp)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Column {
                Text(
                    displayName,
                    color = AccentBlue,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    maxLines = 1
                )
                if (modelName.isNotBlank()) {
                    Text(
                        modelName,
                        color = AccentBlue.copy(alpha = 0.7f),
                        fontSize = 9.sp,
                        maxLines = 1
                    )
                }
            }
            Spacer(modifier = Modifier.width(4.dp))
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = null,
                tint = AccentBlue,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

private fun Context.readMessageAttachment(uri: Uri): MessageAttachment {
    val resolver = contentResolver
    val mimeType = resolver.getType(uri) ?: "application/octet-stream"
    var name = "attachment"
    var size = 0L

    resolver.query(uri, null, null, null, null)?.use { cursor: Cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (cursor.moveToFirst()) {
            if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
            if (sizeIndex >= 0) size = cursor.getLong(sizeIndex)
        }
    }

    val maxBytes = 6 * 1024 * 1024
    if (size > maxBytes) {
        throw IllegalStateException("???? ?????? 6 MB")
    }
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val data = input.readBytes()
        if (data.size > maxBytes) throw IllegalStateException("???? ?????? 6 MB")
        data
    } ?: throw IllegalStateException("???? ??????????")
    if (bytes.isEmpty()) throw IllegalStateException("?????? ????")
    return MessageAttachment(
        name = name,
        mimeType = mimeType,
        size = if (size > 0) size else bytes.size.toLong(),
        base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
    )
}
