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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
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
    selectedReasoningEffort: String,
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
    onToggleContext: () -> Unit,
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
                        color = if (selectedTab == 0) AccentBlue else TextSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                TextButton(
                    onClick = { selectedTab = 0 },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                ) {
                    Text(
                        "\u0427\u0410\u0422",
                        color = if (selectedTab == 0) TextBright else TextSecondary,
                        fontSize = 13.sp
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
                status = status,
                models = models,
                selectedModel = selectedModel,
                selectedReasoningEffort = selectedReasoningEffort,
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
                onToggleContext = onToggleContext,
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
    selectedReasoningEffort: String,
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
    onToggleContext: () -> Unit,
    onLaunchCodex: () -> Unit,
    onLoadThreads: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onRespondToAction: (String, Boolean) -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    var showModelSelector by remember { mutableStateOf(false) }
    var showReasoningSelector by remember { mutableStateOf(false) }
    var showThreads by remember { mutableStateOf(false) }
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
    val reasoningLabel = reasoningOptions.firstOrNull { it.first == selectedReasoningEffort }?.second ?: "\u0421\u0440\u0435\u0434\u043D\u0438\u0439"
    val currentThread = threads.find { it.id == currentThreadId }

    fun submitMessage() {
        if (messageText.isBlank() && attachments.isEmpty()) return
        onSendMessage(messageText.ifBlank { "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0438 \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435." }, attachments)
        messageText = ""
        attachments = emptyList()
    }

    LaunchedEffect(chatHistory.size, chatHistory.lastOrNull()?.content) {
        if (chatHistory.isNotEmpty()) listState.animateScrollToItem(chatHistory.size - 1)
    }

    Column(modifier = Modifier.fillMaxSize().imePadding().background(Color(0xFF151617))) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(42.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(currentThread?.title ?: "\u0414\u043E\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F", color = TextBright, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            IconButton(onClick = { onLoadThreads(); showThreads = true }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.MoreHoriz, contentDescription = "\u0418\u0441\u0442\u043E\u0440\u0438\u044F", tint = TextSecondary, modifier = Modifier.size(22.dp))
            }
            IconButton(onClick = onLaunchCodex, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Outlined.Edit, contentDescription = "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442", tint = TextSecondary, modifier = Modifier.size(20.dp))
            }
        }

        if (showThreads) {
            AlertDialog(
                onDismissRequest = { showThreads = false },
                title = { Text("\u0418\u0441\u0442\u043E\u0440\u0438\u044F Codex", color = TextBright) },
                text = {
                    LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                        if (threads.isEmpty()) item { Text("\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432", color = TextSecondary) }
                        else items(threads) { thread ->
                            Surface(onClick = { onSwitchThread(thread.id); showThreads = false }, color = if (thread.id == currentThreadId) Color(0xFF2A2D2E) else Color.Transparent, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text(thread.title, color = TextPrimary, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(thread.id, color = TextSecondary, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { showThreads = false }) { Text("\u0417\u0430\u043A\u0440\u044B\u0442\u044C") } },
                containerColor = Color(0xFF202123)
            )
        }

        if (error != null) Text(error, color = ErrorRed, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))

        LazyColumn(state = listState, modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(top = 16.dp, bottom = 12.dp)) {
            item { Text(currentThread?.title ?: "Codex \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F", color = TextPrimary, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            if (sendResult?.success == true) item { DesktopStatusLine("\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E", AccentGreen) }
            items(actionEvents.takeLast(8)) { event -> DesktopToolBlock(event, onRespondToAction) }
            items(chatHistory) { msg -> CodexMessageBubble(msg) }
            if (chatHistory.isEmpty() && sendResult == null && actionEvents.isEmpty()) item {
                Column(modifier = Modifier.padding(top = 32.dp)) {
                    Text("\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0438\u043B\u0438 \u0440\u0430\u0431\u043E\u0442\u0443 \u0441 \u0444\u0430\u0439\u043B\u0430\u043C\u0438.", color = TextSecondary, fontSize = 15.sp)
                    Spacer(modifier = Modifier.height(10.dp))
                    Text("\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F Codex \u0431\u0443\u0434\u0443\u0442 \u0437\u0434\u0435\u0441\u044C, \u043A\u0430\u043A \u043D\u0430 \u041F\u041A.", color = TextSecondary.copy(alpha = 0.75f), fontSize = 13.sp)
                }
            }
        }

        Surface(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp), color = Color(0xFF18191A), shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, Color(0xFF26282A))) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (attachments.isNotEmpty()) {
                    LazyColumn(modifier = Modifier.heightIn(max = 90.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(attachments) { attachment ->
                            Row(modifier = Modifier.fillMaxWidth().background(Color(0xFF25272A), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
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
                    placeholder = { Text("\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0432\u043D\u0435\u0441\u0435\u043D\u0438\u0435 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439", color = TextSecondary.copy(alpha = 0.55f)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 5,
                    colors = OutlinedTextFieldDefaults.colors(focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, focusedBorderColor = Color.Transparent, unfocusedBorderColor = Color.Transparent, focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, cursorColor = TextPrimary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { submitMessage() })
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { attachmentPicker.launch("*/*") },
                        modifier = Modifier.size(42.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C", tint = TextSecondary)
                    }
                    Box {
                        TextButton(
                            onClick = { showModelSelector = true },
                            contentPadding = PaddingValues(horizontal = 6.dp),
                            modifier = Modifier.widthIn(min = 92.dp, max = 156.dp)
                        ) {
                            Text(
                                modelLabel,
                                color = TextSecondary,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        DropdownMenu(expanded = showModelSelector, onDismissRequest = { showModelSelector = false }, modifier = Modifier.background(Color(0xFF202123))) {
                            displayModels.forEach { model -> DropdownMenuItem(text = { Text(model.name, color = if (model.id == selectedModel) AccentBlue else TextPrimary) }, onClick = { onSelectModel(model.id); showModelSelector = false }) }
                        }
                    }
                    Box {
                        TextButton(
                            onClick = { showReasoningSelector = true },
                            contentPadding = PaddingValues(horizontal = 6.dp),
                            modifier = Modifier.widthIn(min = 82.dp, max = 134.dp)
                        ) {
                            Text(
                                reasoningLabel,
                                color = TextSecondary,
                                fontSize = 13.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                        }
                        DropdownMenu(expanded = showReasoningSelector, onDismissRequest = { showReasoningSelector = false }, modifier = Modifier.background(Color(0xFF202123))) {
                            reasoningOptions.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.second, color = if (option.first == selectedReasoningEffort) AccentBlue else TextPrimary) },
                                    onClick = {
                                        onSelectReasoningEffort(option.first)
                                        showReasoningSelector = false
                                    }
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.weight(1f))
                    IconButton(onClick = onToggleContext, modifier = Modifier.size(40.dp)) {
                        Icon(
                            Icons.Default.AutoAwesome,
                            contentDescription = "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE",
                            tint = if (includeContext) AccentBlue else TextSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    FilledIconButton(onClick = { submitMessage() }, enabled = messageText.isNotBlank() || attachments.isNotEmpty(), shape = CircleShape, colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFF8E8E8E), disabledContainerColor = Color(0xFF3A3A3A)), modifier = Modifier.size(44.dp)) {
                        if (isLoading) Text("...", color = Color.Black) else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C", tint = Color.Black)
                    }
                }
            }
        }
    }
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
    Surface(
        color = Color(0xFF1D1F20),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, Color(0xFF25282B)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
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
                Text(event.status, color = TextSecondary, fontSize = 12.sp)
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
                    Button(onClick = { onRespondToAction(event.id, true) }) {
                        Text("\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C")
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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (isUser) "\u0412\u044B" else "Codex",
                color = if (isUser) TextSecondary else TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
            if (!isUser && message.isStreaming) {
                Spacer(modifier = Modifier.width(8.dp))
                Text("\u043F\u0438\u0448\u0435\u0442...", color = TextSecondary, fontSize = 11.sp)
            }
            message.model?.takeIf { it.isNotBlank() }?.let {
                Spacer(modifier = Modifier.width(8.dp))
                Text(it, color = TextSecondary, fontSize = 10.sp)
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            message.content.ifBlank { "..." },
            color = TextPrimary,
            fontSize = 15.sp,
            lineHeight = 22.sp
        )
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
