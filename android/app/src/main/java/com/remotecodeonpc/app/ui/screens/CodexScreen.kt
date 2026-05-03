package com.remotecodeonpc.app.ui.screens

import android.app.Activity
import android.content.ActivityNotFoundException
import android.database.Cursor
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.util.Base64
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.CodexModel
import com.remotecodeonpc.app.CodexSendResponse
import com.remotecodeonpc.app.CodexChatMessage
import com.remotecodeonpc.app.CodexActionEvent
import com.remotecodeonpc.app.CodexChangeFile
import com.remotecodeonpc.app.CodexChangeSummary
import com.remotecodeonpc.app.CodexThread
import com.remotecodeonpc.app.FileContent
import com.remotecodeonpc.app.FileTreeItem
import com.remotecodeonpc.app.FoldersResponse
import com.remotecodeonpc.app.MessageAttachment
import com.remotecodeonpc.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodexScreen(
    // Codex params
    models: List<CodexModel>,
    selectedModel: String,
    selectedReasoningEffort: String,
    selectedProfile: String,
    includeContext: Boolean,
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
    onSelectReasoningEffort: (String) -> Unit,
    onSelectProfile: (String) -> Unit,
    onToggleContext: () -> Unit,
    onNewThread: () -> Unit,
    onLoadThreads: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onDeleteThread: (String) -> Unit,
    onStopGeneration: () -> Unit,
    onRespondToAction: (String, Boolean) -> Unit,
    // Files callbacks (same as VSCodeScreen)
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) }
    BackHandler(enabled = selectedTab != 0) {
        selectedTab = 0
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .background(DarkBackground)
    ) {
        Surface(
            color = DarkSurface,
            shadowElevation = 1.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(
                    onClick = { selectedTab = 0 },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                ) {
                    Text(
                        "CODEX",
                        color = if (selectedTab == 0) AccentBlue else TextBright,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                TextButton(
                    onClick = { selectedTab = 1 },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                ) {
                    Text(
                        "\u0424\u0410\u0419\u041B\u042B",
                        color = if (selectedTab == 1) TextBright else TextSecondary,
                        fontSize = 13.sp
                    )
                }
                Spacer(modifier = Modifier.weight(1f))
                IconButton(onClick = onNavigateToSettings, modifier = Modifier.size(38.dp)) {
                    Icon(
                        Icons.Outlined.Settings,
                        contentDescription = "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
                        tint = TextSecondary,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }

        // Content
        when (selectedTab) {
            0 -> CodexChatTab(
                models = models,
                selectedModel = selectedModel,
                selectedReasoningEffort = selectedReasoningEffort,
                selectedProfile = selectedProfile,
                includeContext = includeContext,
                chatHistory = chatHistory,
                actionEvents = actionEvents,
                sendResult = sendResult,
                threads = threads,
                currentThreadId = currentThreadId,
                isLoading = isLoading,
                error = error,
                onSendMessage = onSendMessage,
                onSelectModel = onSelectModel,
                onSelectReasoningEffort = onSelectReasoningEffort,
                onSelectProfile = onSelectProfile,
                onToggleContext = onToggleContext,
                onNewThread = onNewThread,
                onLoadThreads = onLoadThreads,
                onSwitchThread = onSwitchThread,
                onDeleteThread = onDeleteThread,
                onStopGeneration = onStopGeneration,
                onRespondToAction = onRespondToAction,
                onOpenFile = {
                    onOpenFile(it)
                    selectedTab = 1
                }
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
    models: List<CodexModel>,
    selectedModel: String,
    selectedReasoningEffort: String,
    selectedProfile: String,
    includeContext: Boolean,
    chatHistory: List<CodexChatMessage>,
    actionEvents: List<CodexActionEvent>,
    sendResult: CodexSendResponse?,
    threads: List<CodexThread>,
    currentThreadId: String,
    isLoading: Boolean,
    error: String?,
    onSendMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectModel: (String) -> Unit,
    onSelectReasoningEffort: (String) -> Unit,
    onSelectProfile: (String) -> Unit,
    onToggleContext: () -> Unit,
    onNewThread: () -> Unit,
    onLoadThreads: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onDeleteThread: (String) -> Unit,
    onStopGeneration: () -> Unit,
    onRespondToAction: (String, Boolean) -> Unit,
    onOpenFile: (String) -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    var showModelEffortSelector by remember { mutableStateOf(false) }
    var showProfileSelector by remember { mutableStateOf(false) }
    var showThreads by remember { mutableStateOf(false) }
    var pendingDeleteThread by remember { mutableStateOf<CodexThread?>(null) }
    var attachments by remember { mutableStateOf<List<MessageAttachment>>(emptyList()) }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val attachmentScope = rememberCoroutineScope()
    val attachmentPicker = rememberLauncherForActivityResult(contract = ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        attachmentScope.launch {
            var errorMessage: String? = null
            val next = withContext(Dispatchers.IO) {
                uris.take(4).mapNotNull { uri ->
                    runCatching { context.readMessageAttachment(uri) }
                        .onFailure { errorMessage = "Attachment failed: " + it.message }
                        .getOrNull()
                }
            }
            errorMessage?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
            if (next.isNotEmpty()) attachments = (attachments + next).takeLast(4)
        }
    }
    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val spoken = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (spoken.isNotBlank()) {
            messageText = listOf(messageText.trim(), spoken)
                .filter { it.isNotBlank() }
                .joinToString(" ")
        }
    }

    fun startVoiceInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Говорите")
        }
        try {
            speechLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, "На телефоне не найден голосовой ввод", Toast.LENGTH_LONG).show()
        }
    }

    val displayModels = models.ifEmpty {
        listOf(
            CodexModel("gpt-5.5", "GPT-5.5"),
            CodexModel("gpt-5.4", "GPT-5.4"),
            CodexModel("gpt-5.4-mini", "GPT-5.4-Mini"),
            CodexModel("gpt-5.3-codex", "GPT-5.3-Codex"),
            CodexModel("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"),
            CodexModel("gpt-5.2", "GPT-5.2")
        )
    }
    val currentModel = displayModels.find { it.id == selectedModel }
    val modelLabel = currentModel?.name ?: selectedModel.ifBlank { "GPT-5.5" }
    val reasoningOptions = listOf(
        "low" to "\u041D\u0438\u0437\u043A\u0438\u0439",
        "medium" to "\u0421\u0440\u0435\u0434\u043D\u0438\u0439",
        "high" to "\u0412\u044B\u0441\u043E\u043A\u0438\u0439",
        "xhigh" to "\u041E\u0447\u0435\u043D\u044C \u0432\u044B\u0441\u043E\u043A\u0438\u0439"
    )
    val profileOptions = listOf(
        "user" to "\u041F\u043E\u043B\u044C\u0437.",
        "review" to "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430",
        "fast" to "\u0411\u044B\u0441\u0442\u0440\u044B\u0439"
    )
    val reasoningLabel = reasoningOptions.firstOrNull { it.first == selectedReasoningEffort }?.second ?: "\u0421\u0440\u0435\u0434\u043D\u0438\u0439"
    val profileLabel = profileOptions.firstOrNull { it.first == selectedProfile }?.second ?: "\u041F\u043E\u043B\u044C\u0437."
    val currentThread = threads.find { it.id == currentThreadId }
    val visibleChatHistory = chatHistory.filterNot { isMobileActionResultMessage(it.content) }
    val timelineActionEvents = actionEvents
        .filterNot { it.actionable && it.status == "pending" }
        .takeLast(10)
    val approvalActionEvents = actionEvents
        .filter { it.actionable && it.status == "pending" }
        .takeLast(8)

    fun submitMessage() {
        if (messageText.isBlank() && attachments.isEmpty()) return
        onSendMessage(messageText.ifBlank { "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0438 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435." }, attachments)
        messageText = ""
        attachments = emptyList()
    }

    LaunchedEffect(
        visibleChatHistory.size,
        visibleChatHistory.lastOrNull()?.content,
        timelineActionEvents.size,
        timelineActionEvents.lastOrNull()?.status,
        approvalActionEvents.size,
        approvalActionEvents.lastOrNull()?.status
    ) {
        val statusRows = if (sendResult?.success == true) 1 else 0
        val timelineRows = if (timelineActionEvents.isNotEmpty()) 1 else 0
        val targetIndex = statusRows + visibleChatHistory.size + timelineRows + approvalActionEvents.size - 1
        if (targetIndex >= 0) listState.animateScrollToItem(targetIndex)
    }

    Column(modifier = Modifier.fillMaxSize().imePadding().background(DarkBackground)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(46.dp)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(currentThread?.let { threadDisplayTitle(it) } ?: "\u0414\u043E\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F", color = TextBright, fontSize = 15.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            IconButton(onClick = { onLoadThreads(); showThreads = true }, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Default.MoreHoriz, contentDescription = "\u0418\u0441\u0442\u043E\u0440\u0438\u044F", tint = TextSecondary, modifier = Modifier.size(21.dp))
            }
            IconButton(onClick = onNewThread, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Outlined.Edit, contentDescription = "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442", tint = TextSecondary, modifier = Modifier.size(20.dp))
            }
        }

        if (showThreads) {
            AlertDialog(
                modifier = Modifier.fillMaxWidth(0.94f),
                onDismissRequest = { showThreads = false },
                title = { Text("\u0418\u0441\u0442\u043E\u0440\u0438\u044F Codex", color = TextBright) },
                text = {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        if (threads.isEmpty()) item { Text("\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432", color = TextSecondary) }
                        else items(threads) { thread ->
                            val selected = thread.id == currentThreadId
                            Surface(
                                color = if (selected) Color(0xFF323039) else Color.Transparent,
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, if (selected) AccentBlue.copy(alpha = 0.28f) else Color.Transparent),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSwitchThread(thread.id)
                                            showThreads = false
                                        }
                                        .padding(start = 12.dp, end = 4.dp, top = 9.dp, bottom = 9.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(width = 3.dp, height = 34.dp)
                                            .background(if (selected) AccentBlue else Color.Transparent, RoundedCornerShape(999.dp))
                                    )
                                    Spacer(modifier = Modifier.width(9.dp))
                                    Column(modifier = Modifier.weight(1f).padding(end = 10.dp)) {
                                        Text(
                                            threadDisplayTitle(thread),
                                            color = if (selected) TextBright else TextPrimary,
                                            fontSize = 14.sp,
                                            lineHeight = 18.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            threadDisplaySubtitle(thread),
                                            color = TextSecondary,
                                            fontSize = 11.sp,
                                            lineHeight = 13.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                    }
                                    IconButton(onClick = { pendingDeleteThread = thread }, modifier = Modifier.size(40.dp)) {
                                        Icon(Icons.Outlined.Delete, contentDescription = "Удалить чат", tint = TextSecondary, modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { showThreads = false }) { Text("\u0417\u0430\u043A\u0440\u044B\u0442\u044C") } },
                containerColor = Color(0xFF242424)
            )
        }

        pendingDeleteThread?.let { thread ->
            AlertDialog(
                onDismissRequest = { pendingDeleteThread = null },
                title = { Text("Удалить чат?", color = TextBright) },
                text = {
                    Text(
                        "Чат \"${threadDisplayTitle(thread)}\" будет удалён из списка Remote Code.",
                        color = TextPrimary
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            onDeleteThread(thread.id)
                            pendingDeleteThread = null
                            showThreads = false
                        }
                    ) {
                        Text("Удалить", color = ErrorRed)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { pendingDeleteThread = null }) {
                        Text("Отмена")
                    }
                },
                containerColor = Color(0xFF242424)
            )
        }

        if (error != null) Text(error, color = ErrorRed, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))

        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(7.dp), contentPadding = PaddingValues(top = 14.dp, bottom = 10.dp)) {
                if (sendResult?.success == true) item { DesktopStatusLine("\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E", AccentGreen) }
                items(visibleChatHistory) { msg -> CodexMessageBubble(msg, onOpenFile) }
                if (timelineActionEvents.isNotEmpty()) item { MobileActionTimeline(timelineActionEvents) }
                items(approvalActionEvents) { event -> DesktopToolBlock(event, onRespondToAction) }
                if (chatHistory.isEmpty() && sendResult == null && actionEvents.isEmpty()) item {
                    Column(modifier = Modifier.padding(top = 32.dp)) {
                        Text("\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0438\u043B\u0438 \u0440\u0430\u0431\u043E\u0442\u0443 \u0441 \u0444\u0430\u0439\u043B\u0430\u043C\u0438.", color = TextSecondary, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(10.dp))
                        Text("\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F Codex \u0431\u0443\u0434\u0443\u0442 \u0437\u0434\u0435\u0441\u044C, \u043A\u0430\u043A \u043D\u0430 \u041F\u041A.", color = TextSecondary.copy(alpha = 0.75f), fontSize = 13.sp)
                    }
                }
            }
            val showJumpToBottom by remember { derivedStateOf { listState.canScrollForward } }
            if (showJumpToBottom) {
                FilledIconButton(
                    onClick = {
                        val targetIndex = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
                        attachmentScope.launch { listState.animateScrollToItem(targetIndex) }
                    },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(end = 18.dp, bottom = 18.dp).size(38.dp),
                    shape = CircleShape,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xCC2D2D2D))
                ) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = "К новым сообщениям", tint = TextPrimary, modifier = Modifier.size(22.dp))
                }
            }
        }

        Surface(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp), color = Color(0xFF2D2D2D), shape = RoundedCornerShape(22.dp), border = BorderStroke(1.dp, Color(0xFF363636))) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (attachments.isNotEmpty()) {
                    LazyColumn(modifier = Modifier.heightIn(max = 90.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(attachments) { attachment ->
                            Row(modifier = Modifier.fillMaxWidth().background(Color(0xFF242424), RoundedCornerShape(9.dp)).padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.AttachFile, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(attachment.name, color = TextPrimary, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                IconButton(onClick = { attachments = attachments - attachment }, modifier = Modifier.size(28.dp)) { Icon(Icons.Default.Close, contentDescription = "\u0423\u0431\u0440\u0430\u0442\u044C", tint = TextSecondary, modifier = Modifier.size(15.dp)) }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                }
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    placeholder = { Text("\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0432\u043D\u0435\u0441\u0435\u043D\u0438\u0435 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439", color = TextSecondary.copy(alpha = 0.62f)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 5,
                    colors = OutlinedTextFieldDefaults.colors(focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, focusedBorderColor = Color.Transparent, unfocusedBorderColor = Color.Transparent, focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, cursorColor = TextPrimary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { if (!isLoading) submitMessage() })
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { attachmentPicker.launch("*/*") },
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C", tint = TextSecondary, modifier = Modifier.size(21.dp))
                    }
                    Box {
                        TextButton(
                            onClick = { showProfileSelector = true },
                            contentPadding = PaddingValues(horizontal = 3.dp),
                            modifier = Modifier.width(44.dp)
                        ) {
                            Icon(Icons.Outlined.Settings, contentDescription = profileLabel, tint = TextSecondary, modifier = Modifier.size(18.dp))
                            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                        }
                        DropdownMenu(expanded = showProfileSelector, onDismissRequest = { showProfileSelector = false }, modifier = Modifier.background(Color(0xFF242424))) {
                            profileOptions.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.second, color = if (option.first == selectedProfile) AccentBlue else TextPrimary) },
                                    onClick = {
                                        onSelectProfile(option.first)
                                        showProfileSelector = false
                                    }
                                )
                            }
                        }
                    }
                    Box {
                        TextButton(
                            onClick = { showModelEffortSelector = true },
                            contentPadding = PaddingValues(horizontal = 5.dp),
                            modifier = Modifier.widthIn(min = 140.dp, max = 158.dp)
                        ) {
                            Text(
                                "$modelLabel $reasoningLabel",
                                color = TextSecondary,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                        }
                        DropdownMenu(expanded = showModelEffortSelector, onDismissRequest = { showModelEffortSelector = false }, modifier = Modifier.background(Color(0xFF242424))) {
                            Text("\u041C\u043E\u0434\u0435\u043B\u044C", color = TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                            displayModels.forEach { model ->
                                DropdownMenuItem(
                                    text = { Text(model.name, color = if (model.id == selectedModel) AccentBlue else TextPrimary) },
                                    onClick = {
                                        onSelectModel(model.id)
                                        showModelEffortSelector = false
                                    }
                                )
                            }
                            HorizontalDivider(color = DividerColor)
                            Text("\u0423\u0441\u0438\u043B\u0438\u0435", color = TextSecondary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                            reasoningOptions.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.second, color = if (option.first == selectedReasoningEffort) AccentBlue else TextPrimary) },
                                    onClick = {
                                        onSelectReasoningEffort(option.first)
                                        showModelEffortSelector = false
                                    }
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.weight(1f))
                    IconButton(onClick = onToggleContext, modifier = Modifier.size(36.dp)) {
                        Icon(
                            Icons.Default.AutoAwesome,
                            contentDescription = "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE",
                            tint = if (includeContext) AccentBlue else TextSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    IconButton(onClick = { startVoiceInput() }, modifier = Modifier.size(36.dp)) {
                        Icon(
                            Icons.Default.Mic,
                            contentDescription = "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 \u0432\u0432\u043E\u0434",
                            tint = TextSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    FilledIconButton(
                        onClick = { if (isLoading) onStopGeneration() else submitMessage() },
                        enabled = isLoading || messageText.isNotBlank() || attachments.isNotEmpty(),
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFFD9D9D9), disabledContainerColor = Color(0xFF414141)),
                        modifier = Modifier.size(42.dp)
                    ) {
                        if (isLoading) {
                            Icon(Icons.Default.Stop, contentDescription = "Остановить", tint = Color.Black)
                        } else {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C", tint = Color.Black)
                        }
                    }
                }
            }
        }
    }
}

private fun threadDisplayTitle(thread: CodexThread): String {
    val rawTitle = thread.title.trim()
    if (rawTitle.isBlank()) return "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442"
    if (rawTitle.startsWith("rollout-", ignoreCase = true)) return "\u0421\u0435\u0441\u0441\u0438\u044F Codex"
    if (rawTitle.startsWith("codex-file:", ignoreCase = true)) return "\u0421\u0435\u0441\u0441\u0438\u044F Codex"
    if (rawTitle.startsWith("remote-code-", ignoreCase = true)) return "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442"
    return rawTitle.replace(Regex("\\s+"), " ")
}

private fun threadDisplaySubtitle(thread: CodexThread): String {
    val source = when {
        thread.id.startsWith("codex-file:", ignoreCase = true) -> "Codex Desktop"
        thread.id.startsWith("remote-code-", ignoreCase = true) -> "Remote Code"
        else -> "\u0427\u0430\u0442"
    }
    val rolloutDate = Regex("""rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})""")
        .find(thread.title)
        ?.destructured
        ?.let { (year, month, day, hour, minute) -> "$day.$month.$year $hour:$minute" }
    return listOfNotNull(source, rolloutDate).joinToString(" · ")
}

private fun isMobileActionResultMessage(content: String): Boolean {
    val text = content.trimStart()
    return text.startsWith("Действие выполнено:") || text.startsWith("Действие завершилось ошибкой:")
}

@Composable
private fun DesktopStatusLine(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(16.dp)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(text, color = TextSecondary, fontSize = 13.sp)
    }
}

@Composable
private fun DesktopToolBlock(
    event: CodexActionEvent,
    onRespondToAction: (String, Boolean) -> Unit
) {
    val isFailed = event.status == "failed"
    val isDone = event.status == "completed"
    val isRunning = event.status == "running" || event.status == "pending"
    Surface(
        color = Color(0xFF242424),
        shape = RoundedCornerShape(11.dp),
        border = BorderStroke(1.dp, Color(0xFF303030)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isRunning) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = TextSecondary
                    )
                } else {
                    Icon(
                        imageVector = when {
                            event.type.contains("patch") -> Icons.Default.Build
                            event.type.contains("command") -> Icons.Default.Terminal
                            event.type.contains("error") -> Icons.Default.Error
                            else -> Icons.Default.Build
                        },
                        contentDescription = null,
                        tint = when {
                            isFailed -> ErrorRed
                            isDone -> AccentGreen
                            else -> TextSecondary
                        },
                        modifier = Modifier.size(18.dp)
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    event.title.ifBlank { event.type },
                    color = TextPrimary,
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    event.status,
                    color = when {
                        isFailed -> ErrorRed
                        isDone -> AccentGreen
                        else -> TextSecondary
                    },
                    fontSize = 12.sp
                )
            }
            if (event.detail.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    event.detail,
                    color = TextSecondary,
                    fontSize = 13.sp,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (event.actionable) {
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onRespondToAction(event.id, false) }) {
                        Text("\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C")
                    }
                    Button(
                        onClick = { onRespondToAction(event.id, true) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF323039))
                    ) {
                        Text("\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C")
                    }
                }
            }
        }
    }
}

@Composable
private fun MobileActionTimeline(events: List<CodexActionEvent>) {
    val completedCommands = events.filter { it.status == "completed" && it.type.contains("command") }
    val otherEvents = events
        .filterNot { it.status == "completed" && it.type.contains("command") }
        .takeLast(6)
    var expanded by remember(completedCommands.map { it.id }) { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        if (completedCommands.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 2.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Terminal, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(15.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "Выполнено ${completedCommands.size} ${pluralRu(completedCommands.size, "команда", "команды", "команд")}",
                    color = TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
                Icon(
                    if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = null,
                    tint = TextSecondary,
                    modifier = Modifier.size(17.dp)
                )
            }
            AnimatedVisibility(visible = expanded) {
                Column(
                    modifier = Modifier.padding(start = 24.dp, end = 4.dp, bottom = 2.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    completedCommands.takeLast(5).forEach { event ->
                        Text(
                            compactActionText(event),
                            color = TextSecondary,
                            fontSize = 11.sp,
                            lineHeight = 14.sp,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
        otherEvents.forEach { event ->
            MobileActionLine(event)
        }
    }
}

@Composable
private fun MobileActionLine(event: CodexActionEvent) {
    val isRunning = event.status == "running" || event.status == "approved"
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isRunning) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
                color = TextSecondary
            )
        } else {
            Icon(
                imageVector = when {
                    event.status == "failed" -> Icons.Default.Error
                    event.status == "denied" -> Icons.Default.Close
                    event.type.contains("patch") -> Icons.Default.Build
                    event.type.contains("command") -> Icons.Default.Terminal
                    else -> Icons.Default.CheckCircle
                },
                contentDescription = null,
                tint = when {
                    event.status == "failed" -> ErrorRed
                    event.status == "denied" -> TextSecondary
                    event.status == "completed" -> AccentGreen.copy(alpha = 0.85f)
                    else -> TextSecondary
                },
                modifier = Modifier.size(15.dp)
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            actionStatusText(event),
            color = TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        val detail = compactActionText(event)
        if (detail.isNotBlank()) {
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                detail,
                color = TextSecondary.copy(alpha = 0.72f),
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

private fun actionStatusText(event: CodexActionEvent): String {
    return when (event.status) {
        "running", "approved" -> "Выполняется"
        "pending" -> if (event.actionable) "Ожидает подтверждения" else "Ожидает"
        "completed" -> "Выполнено"
        "failed" -> "Ошибка"
        "denied" -> "Отклонено"
        else -> event.title.ifBlank { event.type }
    }
}

private fun compactActionText(event: CodexActionEvent): String {
    return (event.detail.ifBlank { event.title.ifBlank { event.type } })
        .lineSequence()
        .firstOrNull { it.isNotBlank() }
        .orEmpty()
        .replace(Regex("\\s+"), " ")
        .take(120)
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
                    else -> TextSecondary.copy(alpha = 0.10f)
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
                            else -> TextSecondary
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
                            Text("\u041E\u0442\u043A\u043B.", color = ErrorRed, fontSize = 11.sp)
                        }
                        Button(
                            onClick = { onRespondToAction(event.id, true) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF323039)),
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp)
                        ) {
                            Text("\u0414\u0430", color = TextBright, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CodexMessageBubble(
    message: CodexChatMessage,
    onOpenFile: (String) -> Unit
) {
    val isUser = message.role == "user"
    val cleanedContent = remember(message.content) { cleanMobileMessageContent(message.content) }
    val changeSummary = remember(message.content, message.changeSummary) {
        message.changeSummary?.takeIf { it.files.isNotEmpty() } ?: parseMobileChangeSummary(message.content)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 1.dp)
    ) {
        if (isUser) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                Surface(
                    color = Color(0xFF242424),
                    shape = RoundedCornerShape(18.dp),
                    border = BorderStroke(1.dp, Color(0xFF2F2F2F)),
                    modifier = Modifier.widthIn(max = 520.dp)
                ) {
                    Column {
                        Text(
                            highlightedText(cleanedContent.ifBlank { "..." }),
                            color = TextBright,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                        )
                        if (message.attachments.isNotEmpty()) {
                            MobileMessageAttachments(
                                attachments = message.attachments,
                                modifier = Modifier.padding(start = 10.dp, end = 10.dp, bottom = 8.dp)
                            )
                        }
                    }
                }
            }
        } else {
            if (message.isStreaming) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(13.dp),
                        strokeWidth = 2.dp,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("\u0414\u0443\u043C\u0430\u044E", color = TextSecondary, fontSize = 12.sp)
                }
            }
            HighlightedMessageText(cleanedContent.ifBlank { "..." })
            if (message.attachments.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                MobileMessageAttachments(message.attachments)
            }
            message.model?.takeIf { it.isNotBlank() }?.let {
                Spacer(modifier = Modifier.height(7.dp))
                Text(it, color = TextSecondary, fontSize = 11.sp)
            }
            if (changeSummary != null) {
                Spacer(modifier = Modifier.height(10.dp))
                MobileChangeCard(changeSummary, onOpenFile)
            }
        }
    }
}

@Composable
private fun MobileMessageAttachments(
    attachments: List<MessageAttachment>,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF242424), RoundedCornerShape(10.dp))
                    .padding(horizontal = 9.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .background(Color(0xFF171717), RoundedCornerShape(9.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                }
                Spacer(modifier = Modifier.width(9.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(attachment.name, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(fileSubtitle(attachment), color = TextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

private fun fileSubtitle(attachment: MessageAttachment): String {
    val ext = attachment.name.substringAfterLast('.', "").uppercase(Locale.getDefault()).takeIf { it.isNotBlank() }
    val type = when {
        ext == "MD" -> "Документ · MD"
        ext != null -> "Файл · $ext"
        attachment.mimeType.startsWith("image/") -> "Изображение"
        else -> attachment.mimeType
    }
    val size = if (attachment.size > 0) formatAttachmentSize(attachment.size) else ""
    return listOf(type, size).filter { it.isNotBlank() }.joinToString(" · ")
}

private fun formatAttachmentSize(size: Long): String {
    return when {
        size < 1024 -> "$size B"
        size < 1024 * 1024 -> "${size / 1024} KB"
        else -> String.format(Locale.getDefault(), "%.1f MB", size / 1024.0 / 1024.0)
    }
}

@Composable
private fun HighlightedMessageText(text: String) {
    Text(
        highlightedText(text),
        color = TextPrimary,
        fontSize = 14.sp,
        lineHeight = 20.sp
    )
}

@Composable
private fun MobileChangeCard(
    summary: CodexChangeSummary,
    onOpenFile: (String) -> Unit
) {
    var expanded by remember(summary.files) { mutableStateOf(false) }
    val visibleFiles = if (expanded) summary.files else summary.files.take(3)
    Surface(
        color = Color(0xFF242424),
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, Color(0xFF303030)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2D2D2D))
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    changeHeaderText(summary),
                    color = TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                    Text(if (expanded) "Скрыть" else "Показать", color = TextSecondary, fontSize = 12.sp)
                }
            }
            visibleFiles.forEach { file ->
                ChangeFileRow(file, onOpenFile)
            }
        }
    }
}

private fun changeHeaderText(summary: CodexChangeSummary): AnnotatedString {
    return buildAnnotatedString {
        append("Изменено ${summary.files.size} ${pluralRu(summary.files.size, "файл", "файла", "файлов")} ")
        val plusStart = length
        append("+${summary.additions}")
        addStyle(SpanStyle(color = AccentGreen), plusStart, length)
        append(" ")
        val minusStart = length
        append("-${summary.deletions}")
        addStyle(SpanStyle(color = ErrorRed), minusStart, length)
    }
}

@Composable
private fun ChangeFileRow(
    file: CodexChangeFile,
    onOpenFile: (String) -> Unit
) {
    Surface(
        onClick = { onOpenFile(file.path) },
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(file.path, color = TextPrimary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (file.additions > 0) Text("+${file.additions}", color = AccentGreen, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            if (file.deletions > 0) {
                Spacer(modifier = Modifier.width(6.dp))
                Text("-${file.deletions}", color = ErrorRed, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
            Icon(Icons.Default.KeyboardArrowDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
        }
    }
}

private fun highlightedText(text: String): AnnotatedString {
    val tokenRegex = Regex("""(`[^`]+`|C:\\[^\s`]+|(?:[\w.-]+[\\/])+[\w.@%+\-()]+|\b\d+\.\d+\.\d+\b|\b[0-9a-f]{7,40}\b|\b(?:npm run compile|vsce package|assembleDebug|lintDebug|Developer: Reload Window|200 OK)\b)""", RegexOption.IGNORE_CASE)
    return buildAnnotatedString {
        var index = 0
        tokenRegex.findAll(text).forEach { match ->
            append(text.substring(index, match.range.first))
            val raw = match.value.trim('`')
            val start = length
            append(raw)
            addStyle(
                SpanStyle(
                    color = TextPrimary,
                    background = Color(0xFF232323),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp
                ),
                start,
                length
            )
            index = match.range.last + 1
        }
        append(text.substring(index))
    }
}

private fun cleanMobileMessageContent(content: String): String {
    val lines = content.lines()
    val cleaned = mutableListOf<String>()
    var index = 0
    while (index < lines.size) {
        val trimmed = lines[index].trim()
        if (isGitDirectiveLine(trimmed)) {
            index++
            continue
        }
        if (trimmed.matches(Regex("""Изменено\s+\d+\s+файл.*""", RegexOption.IGNORE_CASE))) {
            index++
            while (index < lines.size && isChangeFileLine(lines[index])) index++
            continue
        }
        cleaned += lines[index]
        index++
    }
    return cleaned.joinToString("\n")
        .replace(Regex("(?m)^\\s*[-*]\\s+"), "• ")
        .replace(Regex("\n{3,}"), "\n\n")
        .trimEnd()
}

private fun parseMobileChangeSummary(content: String): CodexChangeSummary? {
    val lines = content.lines()
    val headerIndex = lines.indexOfFirst { it.trim().matches(Regex("""Изменено\s+\d+\s+файл.*""", RegexOption.IGNORE_CASE)) }
    if (headerIndex < 0) return null
    val files = mutableListOf<CodexChangeFile>()
    for (line in lines.drop(headerIndex + 1)) {
        val match = Regex("""^\s*(?:[-*•]\s*)?(.+?)\s+\+(\d+)(?:\s+-(\d+))?\s*$""").find(line) ?: break
        val path = match.groupValues[1].trim()
        if (!path.contains("/") && !path.contains("\\") && !path.contains(".")) break
        files += CodexChangeFile(
            path = path,
            additions = match.groupValues[2].toIntOrNull() ?: 0,
            deletions = match.groupValues.getOrNull(3)?.toIntOrNull() ?: 0
        )
    }
    if (files.isEmpty()) return null
    return CodexChangeSummary(
        files = files,
        additions = files.sumOf { it.additions },
        deletions = files.sumOf { it.deletions }
    )
}

private fun isChangeFileLine(line: String): Boolean {
    return Regex("""^\s*(?:[-*•]\s*)?.+?\s+\+\d+(?:\s+-\d+)?\s*$""").matches(line)
}

private fun isGitDirectiveLine(line: String): Boolean {
    if (!line.startsWith("::git-")) return false
    val action = line.substringAfter("::git-").substringBefore("{")
    return action in setOf(
        "stage",
        "commit",
        "push",
        "create-branch",
        "create-pr"
    )
}

private fun pluralRu(count: Int, one: String, few: String, many: String): String {
    val mod10 = count % 10
    val mod100 = count % 100
    return when {
        mod10 == 1 && mod100 != 11 -> one
        mod10 in 2..4 && mod100 !in 12..14 -> few
        else -> many
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
        throw IllegalStateException("file is larger than 6 MB")
    }
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val data = input.readBytes()
        if (data.size > maxBytes) throw IllegalStateException("file is larger than 6 MB")
        data
    } ?: throw IllegalStateException("file unavailable")
    if (bytes.isEmpty()) throw IllegalStateException("empty file")
    return MessageAttachment(
        name = name,
        mimeType = mimeType,
        size = if (size > 0) size else bytes.size.toLong(),
        base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
    )
}
