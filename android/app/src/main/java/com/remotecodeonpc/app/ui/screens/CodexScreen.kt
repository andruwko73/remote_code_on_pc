package com.remotecodeonpc.app.ui.screens

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.database.Cursor
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
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
import com.remotecodeonpc.app.CodexChangeActionResponse
import com.remotecodeonpc.app.CodexChangeFile
import com.remotecodeonpc.app.CodexChangeSummary
import com.remotecodeonpc.app.CodexProject
import com.remotecodeonpc.app.CodexThread
import com.remotecodeonpc.app.FileContent
import com.remotecodeonpc.app.FileTreeItem
import com.remotecodeonpc.app.FoldersResponse
import com.remotecodeonpc.app.MessageAttachment
import com.remotecodeonpc.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
    projects: List<CodexProject>,
    currentThreadId: String,
    currentProjectId: String,
    isLoading: Boolean,
    error: String?,
    changeDiff: CodexChangeActionResponse? = null,
    isChangeDiffLoading: Boolean = false,
    // Optional file context for the Codex workspace surface.
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
    onDeleteMessage: (String) -> Unit = {},
    onRegenerateMessage: (String) -> Unit = {},
    onLoadChangeDiff: (String, String?, String?) -> Unit = { _, _, _ -> },
    onReviewChange: (String?, String?, String?) -> Unit = { _, _, _ -> },
    onUndoChange: (String?, String?, String?) -> Unit = { _, _, _ -> },
    onClearChangeDiff: () -> Unit = {},
    onStopGeneration: () -> Unit,
    onRespondToAction: (String, Boolean) -> Unit,
    // Optional file callbacks.
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val useWideSidebar = LocalConfiguration.current.screenWidthDp >= 840
    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }

    fun closeDrawerThen(action: () -> Unit) {
        scope.launch {
            drawerState.close()
            action()
        }
    }

    val chatContent: @Composable () -> Unit = {
        CodexChatTab(
            models = models,
            selectedModel = selectedModel,
            selectedReasoningEffort = selectedReasoningEffort,
            selectedProfile = selectedProfile,
            includeContext = includeContext,
            chatHistory = chatHistory,
            actionEvents = actionEvents,
            sendResult = sendResult,
            threads = threads,
            projects = projects,
            currentThreadId = currentThreadId,
            currentProjectId = currentProjectId,
            isLoading = isLoading,
            error = error,
            changeDiff = changeDiff,
            isChangeDiffLoading = isChangeDiffLoading,
            onOpenNavigation = {
                onLoadThreads()
                if (!useWideSidebar) scope.launch { drawerState.open() }
            },
            onSendMessage = onSendMessage,
            onSelectModel = onSelectModel,
            onSelectReasoningEffort = onSelectReasoningEffort,
            onSelectProfile = onSelectProfile,
            onToggleContext = onToggleContext,
            onNewThread = onNewThread,
            onLoadThreads = onLoadThreads,
            onDeleteThread = onDeleteThread,
            onDeleteMessage = onDeleteMessage,
            onRegenerateMessage = onRegenerateMessage,
            onLoadChangeDiff = onLoadChangeDiff,
            onReviewChange = onReviewChange,
            onUndoChange = onUndoChange,
            onClearChangeDiff = onClearChangeDiff,
            onStopGeneration = onStopGeneration,
            onRespondToAction = onRespondToAction,
            onNavigateToSettings = onNavigateToSettings,
            onOpenFile = onOpenFile
        )
    }

    if (useWideSidebar) {
        Row(modifier = Modifier.fillMaxSize()) {
            Surface(
                color = DarkSurface,
                modifier = Modifier
                    .fillMaxHeight()
                    .width(332.dp)
            ) {
                CodexNavigationPanel(
                    projects = projects,
                    threads = threads,
                    currentThreadId = currentThreadId,
                    onNewThread = onNewThread,
                    onSwitchThread = onSwitchThread,
                    onOpenFolder = onOpenFolder,
                    onNavigateToSettings = onNavigateToSettings
                )
            }
            VerticalDivider(color = DividerColor, thickness = 1.dp)
            Box(modifier = Modifier.weight(1f)) {
                chatContent()
            }
        }
    } else {
        ModalNavigationDrawer(
            drawerState = drawerState,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = DarkSurface,
                    drawerContentColor = TextPrimary,
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(332.dp)
                ) {
                    CodexNavigationPanel(
                        projects = projects,
                        threads = threads,
                        currentThreadId = currentThreadId,
                        onNewThread = { closeDrawerThen(onNewThread) },
                        onSwitchThread = { threadId -> closeDrawerThen { onSwitchThread(threadId) } },
                        onOpenFolder = { path -> closeDrawerThen { onOpenFolder(path) } },
                        onNavigateToSettings = { closeDrawerThen(onNavigateToSettings) }
                    )
                }
            }
        ) {
            chatContent()
        }
    }
}

@Composable
private fun CodexNavigationPanel(
    projects: List<CodexProject>,
    threads: List<CodexThread>,
    currentThreadId: String,
    onNewThread: () -> Unit,
    onSwitchThread: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onNavigateToSettings: () -> Unit
) {
    val projectGroups = remember(projects, threads) {
        projects.ifEmpty { buildMobileCodexProjects(threads) }
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkSurface)
            .padding(horizontal = 10.dp, vertical = 10.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            CodexDrawerAction(
                icon = Icons.Outlined.Edit,
                label = "Новый чат",
                onClick = onNewThread
            )
            CodexDrawerAction(
                icon = Icons.Outlined.Search,
                label = "Поиск",
                enabled = false,
                onClick = {}
            )
            CodexDrawerAction(
                icon = Icons.Outlined.Extension,
                label = "Плагины",
                enabled = false,
                onClick = {}
            )
            CodexDrawerAction(
                icon = Icons.Outlined.Schedule,
                label = "Автоматизации",
                enabled = false,
                onClick = {}
            )
        }

        Text(
            "Проекты",
            color = TextSecondary,
            fontSize = 12.sp,
            modifier = Modifier.padding(start = 10.dp, top = 18.dp, bottom = 7.dp)
        )

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            contentPadding = PaddingValues(bottom = 64.dp)
        ) {
            if (projectGroups.isEmpty()) {
                item {
                    Text(
                        "Чаты появятся внутри проекта после первого запроса.",
                        color = TextSecondary,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)
                    )
                }
            }
            projectGroups.forEach { project ->
                item(key = "drawer-project-${project.id}") {
                    CodexDrawerProjectRow(
                        project = project,
                        selected = project.threads.any { it.id == currentThreadId },
                        onClick = { project.threads.firstOrNull()?.id?.let(onSwitchThread) },
                        onOpenFolder = onOpenFolder
                    )
                }
                items(project.threads, key = { "drawer-thread-${it.id}" }) { thread ->
                    CodexDrawerThreadRow(
                        thread = thread,
                        selected = thread.id == currentThreadId,
                        onClick = { onSwitchThread(thread.id) }
                    )
                }
            }
        }

        HorizontalDivider(color = DividerColor.copy(alpha = 0.55f))
        CodexDrawerAction(
            icon = Icons.Outlined.Settings,
            label = "Настройки",
            modifier = Modifier.padding(top = 7.dp),
            onClick = onNavigateToSettings
        )
    }
}

@Composable
private fun CodexDrawerAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(32.dp)
            .background(Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) TextSecondary else TextSecondary.copy(alpha = 0.42f), modifier = Modifier.size(17.dp))
        Spacer(modifier = Modifier.width(10.dp))
        Text(label, color = if (enabled) TextPrimary else TextSecondary.copy(alpha = 0.42f), fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun CodexDrawerProjectRow(
    project: CodexProject,
    selected: Boolean,
    onClick: () -> Unit,
    onOpenFolder: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 34.dp)
            .background(if (selected) Color(0xFF2A302E) else Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(enabled = project.threads.isNotEmpty(), onClick = onClick)
            .padding(start = 9.dp, end = 2.dp, top = 5.dp, bottom = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Outlined.Folder, contentDescription = null, tint = if (selected) AccentBlue else TextSecondary, modifier = Modifier.size(17.dp))
        Spacer(modifier = Modifier.width(9.dp))
        Text(project.name.ifBlank { "Без проекта" }, color = TextPrimary, fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        project.path?.takeIf { it.isNotBlank() }?.let { path ->
            IconButton(onClick = { onOpenFolder(path) }, modifier = Modifier.size(30.dp)) {
                Icon(Icons.Default.NorthEast, contentDescription = "Открыть проект", tint = TextSecondary, modifier = Modifier.size(15.dp))
            }
        }
    }
}

@Composable
private fun CodexDrawerThreadRow(
    thread: CodexThread,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 25.dp)
            .background(if (selected) Color(0xFF323039) else Color.Transparent, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(width = 3.dp, height = 24.dp)
                .background(if (selected) AccentBlue else Color.Transparent, RoundedCornerShape(999.dp))
        )
        Spacer(modifier = Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(threadDisplayTitle(thread), color = if (selected) TextBright else TextPrimary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(threadSourceLabel(thread), color = TextSecondary, fontSize = 10.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun CodexProjectsTab(
    projects: List<CodexProject>,
    threads: List<CodexThread>,
    currentThreadId: String,
    onSwitchThread: (String) -> Unit,
    onNewThread: () -> Unit,
    onOpenFolder: (String) -> Unit
) {
    val projectGroups = remember(projects, threads) {
        projects.ifEmpty { buildMobileCodexProjects(threads) }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(top = 14.dp, bottom = 18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Проекты",
                    color = TextBright,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onNewThread, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Outlined.Edit, contentDescription = "Новый чат", tint = TextSecondary, modifier = Modifier.size(19.dp))
                }
            }
        }
        if (projectGroups.isEmpty()) {
            item {
                Text(
                    "Чаты появятся внутри проекта после первого запроса.",
                    color = TextSecondary,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 18.dp)
                )
            }
        }
        projectGroups.forEach { project ->
            item(key = "project-${project.id}") {
                MobileProjectHeader(
                    project = project,
                    selected = project.threads.any { it.id == currentThreadId },
                    onClick = { project.threads.firstOrNull()?.id?.let(onSwitchThread) },
                    onOpenFolder = onOpenFolder
                )
            }
            items(
                items = project.threads,
                key = { "thread-${it.id}" }
            ) { thread ->
                MobileProjectThreadRow(
                    thread = thread,
                    selected = thread.id == currentThreadId,
                    onClick = { onSwitchThread(thread.id) }
                )
            }
        }
    }
}

@Composable
private fun MobileProjectHeader(
    project: CodexProject,
    selected: Boolean,
    onClick: () -> Unit,
    onOpenFolder: (String) -> Unit
) {
    Surface(
        color = if (selected) Color(0xFF26302D) else Color(0xFF242424),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, if (selected) AccentBlue.copy(alpha = 0.22f) else Color(0xFF303030)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(start = 12.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Outlined.Folder, contentDescription = null, tint = if (selected) AccentBlue else TextSecondary, modifier = Modifier.size(20.dp))
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(project.name.ifBlank { "Без проекта" }, color = TextBright, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(mobileProjectSubtitle(project), color = TextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            project.path?.takeIf { it.isNotBlank() }?.let { path ->
                IconButton(onClick = { onOpenFolder(path) }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Default.NorthEast, contentDescription = "Открыть проект", tint = TextSecondary, modifier = Modifier.size(17.dp))
                }
            }
        }
    }
}

@Composable
private fun MobileProjectThreadRow(
    thread: CodexThread,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 24.dp)
            .background(if (selected) Color(0xFF323039) else Color.Transparent, RoundedCornerShape(9.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(width = 3.dp, height = 28.dp)
                .background(if (selected) AccentBlue else Color.Transparent, RoundedCornerShape(999.dp))
        )
        Spacer(modifier = Modifier.width(9.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(threadDisplayTitle(thread), color = if (selected) TextBright else TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(threadSourceLabel(thread), color = TextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
    projects: List<CodexProject>,
    currentThreadId: String,
    currentProjectId: String,
    isLoading: Boolean,
    error: String?,
    changeDiff: CodexChangeActionResponse? = null,
    isChangeDiffLoading: Boolean = false,
    onOpenNavigation: () -> Unit = {},
    onSendMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectModel: (String) -> Unit,
    onSelectReasoningEffort: (String) -> Unit,
    onSelectProfile: (String) -> Unit,
    onToggleContext: () -> Unit,
    onNewThread: () -> Unit,
    onLoadThreads: () -> Unit,
    onDeleteThread: (String) -> Unit,
    onDeleteMessage: (String) -> Unit = {},
    onRegenerateMessage: (String) -> Unit = {},
    onLoadChangeDiff: (String, String?, String?) -> Unit = { _, _, _ -> },
    onReviewChange: (String?, String?, String?) -> Unit = { _, _, _ -> },
    onUndoChange: (String?, String?, String?) -> Unit = { _, _, _ -> },
    onClearChangeDiff: () -> Unit = {},
    onStopGeneration: () -> Unit,
    onRespondToAction: (String, Boolean) -> Unit,
    onNavigateToSettings: () -> Unit = {},
    onOpenFile: (String) -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    var showModelEffortSelector by remember { mutableStateOf(false) }
    var showProfileSelector by remember { mutableStateOf(false) }
    var showCurrentThreadMenu by remember { mutableStateOf(false) }
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
    val modelLabel = shortMobileModelName(currentModel?.name ?: selectedModel.ifBlank { "GPT-5.5" })
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
    val projectGroups = remember(projects, threads) { projects.ifEmpty { buildMobileCodexProjects(threads) } }
    val currentProjectLabel = currentThread?.let { threadProjectName(it) }
        ?: projectGroups.firstOrNull { project -> project.id == currentProjectId }?.name
        ?: projectGroups.firstOrNull { project -> project.threads.any { it.id == currentThreadId } }?.name
    val visibleChatHistory = remember(chatHistory) {
        dedupeMobileChatMessages(chatHistory.filterNot { isMobileActionResultMessage(it.content) })
    }
    val timelineActionEvents = actionEvents
        .filterNot { it.actionable && it.status == "pending" }
        .takeLast(10)
    val approvalActionEvents = actionEvents
        .filter { it.actionable && it.status == "pending" }
        .takeLast(8)
    val chatConfiguration = LocalConfiguration.current
    val chatHorizontalPadding = if (chatConfiguration.screenWidthDp >= 600) 32.dp else 14.dp

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
        repeat(4) {
            delay(120)
            val targetIndex = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
            if (targetIndex > 0) {
                listState.scrollToItem(targetIndex)
            }
        }
        val targetIndex = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
        if (targetIndex > 0) {
            listState.animateScrollToItem(targetIndex)
        }
    }

    Column(modifier = Modifier.fillMaxSize().navigationBarsPadding().imePadding().background(DarkBackground)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(start = 6.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onOpenNavigation, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Menu, contentDescription = "Навигация", tint = TextSecondary, modifier = Modifier.size(22.dp))
            }
            Spacer(modifier = Modifier.width(2.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable {
                        onLoadThreads()
                        onOpenNavigation()
                    },
                verticalArrangement = Arrangement.Center
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        currentThread?.let { threadDisplayTitle(it) } ?: "\u0414\u043E\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F",
                        color = TextBright,
                        fontSize = 15.sp,
                        lineHeight = 18.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                }
                currentProjectLabel?.takeIf { it.isNotBlank() }?.let { label ->
                    Text(
                        label,
                        color = TextSecondary,
                        fontSize = 11.sp,
                        lineHeight = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Box {
                IconButton(onClick = { showCurrentThreadMenu = true }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Default.MoreHoriz, contentDescription = "\u041C\u0435\u043D\u044E \u0447\u0430\u0442\u0430", tint = TextSecondary, modifier = Modifier.size(21.dp))
                }
                DropdownMenu(
                    expanded = showCurrentThreadMenu,
                    onDismissRequest = { showCurrentThreadMenu = false },
                    modifier = Modifier.background(Color(0xFF242424))
                ) {
                    DropdownMenuItem(
                        text = { Text("\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442", color = TextPrimary) },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null, tint = TextSecondary) },
                        onClick = {
                            showCurrentThreadMenu = false
                            onNewThread()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0447\u0430\u0442\u043E\u0432", color = TextPrimary) },
                        leadingIcon = { Icon(Icons.Outlined.History, contentDescription = null, tint = TextSecondary) },
                        onClick = {
                            showCurrentThreadMenu = false
                            onLoadThreads()
                            onOpenNavigation()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0447\u0430\u0442", color = ErrorRed) },
                        leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = ErrorRed) },
                        enabled = currentThreadId.isNotBlank(),
                        onClick = {
                            showCurrentThreadMenu = false
                            pendingDeleteThread = currentThread ?: CodexThread(id = currentThreadId, title = "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0447\u0430\u0442")
                        }
                    )
                    HorizontalDivider(color = DividerColor)
                    DropdownMenuItem(
                        text = { Text("\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438", color = TextPrimary) },
                        leadingIcon = { Icon(Icons.Outlined.Settings, contentDescription = null, tint = TextSecondary) },
                        onClick = {
                            showCurrentThreadMenu = false
                            onNavigateToSettings()
                        }
                    )
                }
            }
            IconButton(onClick = onNewThread, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Outlined.Edit, contentDescription = "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442", tint = TextSecondary, modifier = Modifier.size(20.dp))
            }
        }
        HorizontalDivider(color = DividerColor.copy(alpha = 0.72f), thickness = 1.dp)

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

        changeDiff?.let { diff ->
            val diffSummary = findMobileChangeSummaryForDiff(diff, visibleChatHistory)
            MobileChangeDiffDialog(
                diff = diff,
                files = diffSummary?.files.orEmpty(),
                onSelectFile = { file ->
                    onLoadChangeDiff(
                        file.path,
                        diffSummary?.commit ?: diff.commit,
                        diffSummary?.cwd ?: diff.cwd
                    )
                },
                onDismiss = onClearChangeDiff
            )
        }

        if (error != null) Text(error, color = ErrorRed, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))

        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(horizontal = chatHorizontalPadding), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(top = 10.dp, bottom = 6.dp)) {
                val timelineInsertIndex = visibleChatHistory.indexOfLast { it.role == "assistant" }
                visibleChatHistory.forEachIndexed { index, msg ->
                    if (timelineActionEvents.isNotEmpty() && index == timelineInsertIndex) {
                        item(key = "action-timeline") { MobileActionTimeline(timelineActionEvents) }
                    }
                    item(key = msg.id.ifBlank { "msg-$index" }) {
                        CodexMessageBubble(
                            message = msg,
                            onOpenFile = onOpenFile,
                            isChangeDiffLoading = isChangeDiffLoading,
                            onLoadChangeDiff = onLoadChangeDiff,
                            onReviewChange = onReviewChange,
                            onUndoChange = onUndoChange,
                            onEditMessage = { text ->
                                messageText = text
                            },
                            onDeleteMessage = onDeleteMessage,
                            onRegenerateMessage = onRegenerateMessage
                        )
                    }
                }
                if (timelineActionEvents.isNotEmpty() && timelineInsertIndex < 0) item { MobileActionTimeline(timelineActionEvents) }
                items(approvalActionEvents) { event -> DesktopToolBlock(event, onRespondToAction) }
                if (chatHistory.isEmpty() && sendResult == null && actionEvents.isEmpty()) item {
                    Column(modifier = Modifier.padding(top = 32.dp)) {
                        Text("\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F, \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 \u0438\u043B\u0438 \u0440\u0430\u0431\u043E\u0442\u0443 \u0441 \u0444\u0430\u0439\u043B\u0430\u043C\u0438.", color = TextSecondary, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(10.dp))
                        Text("\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE \u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F Codex \u0431\u0443\u0434\u0443\u0442 \u0437\u0434\u0435\u0441\u044C, \u043A\u0430\u043A \u043D\u0430 \u041F\u041A.", color = TextSecondary.copy(alpha = 0.75f), fontSize = 13.sp)
                    }
                }
                item(key = "bottom-anchor") { Spacer(modifier = Modifier.height(1.dp)) }
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

        Surface(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), color = Color(0xFF2D2D2D), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, Color(0xFF3A3A3F))) {
            Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) {
                if (attachments.isNotEmpty()) {
                    LazyColumn(modifier = Modifier.heightIn(max = 90.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(attachments) { attachment ->
                            Row(modifier = Modifier.fillMaxWidth().background(Color(0xFF242424), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.AttachFile, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(attachment.name, color = TextPrimary, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                IconButton(onClick = { attachments = attachments - attachment }, modifier = Modifier.size(28.dp)) { Icon(Icons.Default.Close, contentDescription = "\u0423\u0431\u0440\u0430\u0442\u044C", tint = TextSecondary, modifier = Modifier.size(15.dp)) }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                }
                BasicTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp, max = 108.dp),
                    textStyle = LocalTextStyle.current.copy(color = TextPrimary, fontSize = 13.5.sp, lineHeight = 19.sp),
                    cursorBrush = SolidColor(TextPrimary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { if (!isLoading) submitMessage() }),
                    decorationBox = { innerTextField ->
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
                            contentAlignment = Alignment.TopStart
                        ) {
                            if (messageText.isBlank()) {
                                Text(
                                    "\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0432\u043D\u0435\u0441\u0435\u043D\u0438\u0435 \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0445 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439",
                                    color = TextSecondary.copy(alpha = 0.62f),
                                    fontSize = 13.5.sp,
                                    lineHeight = 19.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            innerTextField()
                        }
                    }
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 38.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { attachmentPicker.launch("*/*") },
                        modifier = Modifier.size(31.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C", tint = TextSecondary, modifier = Modifier.size(19.dp))
                    }
                    Box {
                        TextButton(
                            onClick = { showProfileSelector = true },
                            contentPadding = PaddingValues(horizontal = 3.dp),
                            modifier = Modifier.widthIn(min = 72.dp, max = 92.dp)
                        ) {
                            Icon(Icons.Outlined.Settings, contentDescription = profileLabel, tint = TextSecondary, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(profileLabel, color = TextSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
                            modifier = Modifier.widthIn(min = 116.dp, max = 148.dp)
                        ) {
                            Text(
                                "$modelLabel $reasoningLabel",
                                color = TextSecondary,
                                fontSize = 12.sp,
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
                    IconButton(onClick = onToggleContext, modifier = Modifier.size(31.dp)) {
                        Icon(
                            Icons.Default.AutoAwesome,
                            contentDescription = "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 IDE",
                            tint = if (includeContext) AccentBlue else TextSecondary,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                    IconButton(onClick = { startVoiceInput() }, modifier = Modifier.size(31.dp)) {
                        Icon(
                            Icons.Default.Mic,
                            contentDescription = "\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 \u0432\u0432\u043E\u0434",
                            tint = TextSecondary,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                    FilledIconButton(
                        onClick = { if (isLoading) onStopGeneration() else submitMessage() },
                        enabled = isLoading || messageText.isNotBlank() || attachments.isNotEmpty(),
                        shape = CircleShape,
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFFD9D9D9), disabledContainerColor = Color(0xFF414141)),
                        modifier = Modifier.size(37.dp)
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

private fun shortMobileModelName(value: String): String {
    return value
        .replace(Regex("^gpt-", RegexOption.IGNORE_CASE), "")
        .replace(Regex("^GPT-", RegexOption.IGNORE_CASE), "")
        .replace("Codex-Spark", "Spark", ignoreCase = true)
        .replace("Codex", "Codex", ignoreCase = true)
        .trim()
        .ifBlank { "5.5" }
}

private fun threadProjectName(thread: CodexThread): String? {
    return thread.workspaceName
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: thread.workspacePath
            ?.replace("\\", "/")
            ?.trimEnd('/')
            ?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() }
}

private fun threadDisplaySubtitle(thread: CodexThread): String {
    val project = thread.workspaceName
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: thread.workspacePath
            ?.replace("\\", "/")
            ?.trimEnd('/')
            ?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() }
    val source = when {
        thread.id.startsWith("codex-file:", ignoreCase = true) -> "Codex Desktop"
        thread.id.startsWith("remote-code-", ignoreCase = true) -> "Remote Code"
        else -> "\u0427\u0430\u0442"
    }
    val rolloutDate = Regex("""rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})""")
        .find(thread.title)
        ?.destructured
        ?.let { (year, month, day, hour, minute) -> "$day.$month.$year $hour:$minute" }
    return listOfNotNull(project, source, rolloutDate).joinToString(" · ")
}

private fun threadSourceLabel(thread: CodexThread): String {
    return when {
        thread.id.startsWith("codex-file:", ignoreCase = true) -> "Codex Desktop"
        thread.id.startsWith("remote-code-", ignoreCase = true) -> "Remote Code"
        else -> "Чат"
    }
}

private fun mobileProjectSubtitle(project: CodexProject): String {
    val count = "${project.threadCount.coerceAtLeast(project.threads.size)} ${pluralRu(project.threadCount.coerceAtLeast(project.threads.size), "чат", "чата", "чатов")}"
    val active = if (project.active) "открыт" else null
    val path = project.path
        ?.replace("\\", "/")
        ?.trimEnd('/')
        ?.takeIf { it.isNotBlank() }
    return listOfNotNull(count, active, path).joinToString(" · ")
}

private fun buildMobileCodexProjects(threads: List<CodexThread>): List<CodexProject> {
    return threads
        .groupBy { mobileProjectKey(it.projectId, it.workspaceName, it.workspacePath) }
        .map { (id, groupedThreads) ->
            val sortedThreads = groupedThreads.sortedByDescending { it.timestamp }
            val first = sortedThreads.firstOrNull()
            CodexProject(
                id = id,
                name = first?.workspaceName?.trim()?.takeIf { it.isNotBlank() }
                    ?: first?.workspacePath
                        ?.replace("\\", "/")
                        ?.trimEnd('/')
                        ?.substringAfterLast('/')
                        ?.takeIf { it.isNotBlank() }
                    ?: "Без проекта",
                path = first?.workspacePath,
                threadCount = sortedThreads.size,
                timestamp = sortedThreads.maxOfOrNull { it.timestamp } ?: 0,
                threads = sortedThreads
            )
        }
        .sortedByDescending { it.timestamp }
}

private fun mobileProjectKey(projectId: String?, workspaceName: String?, workspacePath: String?): String {
    projectId?.trim()?.takeIf { it.isNotBlank() }?.let { return it }
    val path = workspacePath
        ?.trim()
        ?.replace('\\', '/')
        ?.trimEnd('/')
        ?.takeIf { it.isNotBlank() }
    if (path != null) return "path:${path.lowercase()}"
    val name = workspaceName?.trim()?.takeIf { it.isNotBlank() }
    return name?.let { "name:${it.lowercase()}" } ?: "unassigned"
}

private fun isMobileActionResultMessage(content: String): Boolean {
    val text = content.trimStart()
    return text.startsWith("Действие выполнено:") || text.startsWith("Действие завершилось ошибкой:")
}

private fun dedupeMobileChatMessages(messages: List<CodexChatMessage>): List<CodexChatMessage> {
    val result = mutableListOf<CodexChatMessage>()
    messages.forEach { message ->
        val previous = result.lastOrNull()
        if (previous != null && mobileMessageDedupeKey(previous) == mobileMessageDedupeKey(message)) {
            return@forEach
        }
        result += message
    }
    return result
}

private fun mobileMessageDedupeKey(message: CodexChatMessage): String {
    return message.role + "\u0000" + message.content.replace(Regex("\\s+"), " ").trim()
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
    val visibleEvents = (otherEvents + completedCommands.takeLast(5)).takeLast(8)
    var expanded by remember(events.map { it.id to it.status }) { mutableStateOf(false) }
    val running = events.any { it.status == "running" || it.status == "approved" }
    val summary = remember(events, running) { mobileWorkSummary(events, running) }
    val previewEvents = visibleEvents.takeLast(if (running) 4 else 3)

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 2.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (running) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = TextSecondary
                )
            } else {
                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(15.dp))
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                summary,
                color = TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Icon(
                if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                tint = TextSecondary,
                modifier = Modifier.size(17.dp)
            )
        }
        if (!expanded && previewEvents.isNotEmpty()) {
            Column(
                modifier = Modifier.padding(start = 23.dp, end = 4.dp, bottom = 1.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                previewEvents.forEach { event -> MobileTimelineEventPreview(event) }
            }
        }
        AnimatedVisibility(visible = expanded) {
            Column(
                modifier = Modifier.padding(start = 23.dp, end = 4.dp, bottom = 2.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                visibleEvents.forEach { event -> MobileTimelineEventPreview(event) }
                if (visibleEvents.isEmpty()) {
                    Text(
                        "Подробностей пока нет",
                        color = TextSecondary.copy(alpha = 0.72f),
                        fontSize = 11.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun MobileTimelineEventPreview(event: CodexActionEvent) {
    if (event.status == "completed" && event.type.contains("command")) {
        Text(
            compactActionText(event),
            color = TextSecondary,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            fontFamily = FontFamily.Monospace,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    } else {
        MobileActionLine(event)
    }
}

private const val MOBILE_WORK_SUMMARY_IDLE_GAP_MS = 30L * 60L * 1000L
private const val MOBILE_WORK_SUMMARY_MAX_MS = 3L * 60L * 60L * 1000L

private fun mobileWorkSummary(events: List<CodexActionEvent>, running: Boolean): String {
    val activeEvents = recentMobileWorkEvents(events)
    val timestamps = activeEvents.map { it.timestamp }.filter { it > 0 }
    val rawDuration = if (timestamps.size >= 2) {
        (timestamps.maxOrNull() ?: 0) - (timestamps.minOrNull() ?: 0)
    } else {
        0
    }
    val duration = if (rawDuration in 1..MOBILE_WORK_SUMMARY_MAX_MS) {
        formatMobileDuration(rawDuration)
    } else {
        ""
    }
    val verb = if (running) "Работает" else "Работал"
    val workLabel = if (duration.isBlank()) verb else "$verb на протяжении $duration"
    val completedCommandCount = activeEvents.count { it.status == "completed" && it.type.contains("command") }
    val commandLabel = if (completedCommandCount > 0) {
        ", выполнено $completedCommandCount ${pluralRu(completedCommandCount, "команда", "команды", "команд")}"
    } else {
        ""
    }
    return "$workLabel$commandLabel"
}

private fun recentMobileWorkEvents(events: List<CodexActionEvent>): List<CodexActionEvent> {
    val sorted = events
        .filter { it.timestamp > 0 }
        .sortedBy { it.timestamp }
    if (sorted.size <= 1) return sorted

    var startIndex = sorted.lastIndex
    for (index in sorted.lastIndex downTo 1) {
        val gap = sorted[index].timestamp - sorted[index - 1].timestamp
        if (gap > MOBILE_WORK_SUMMARY_IDLE_GAP_MS) break
        startIndex = index - 1
    }
    return sorted.drop(startIndex)
}

private fun formatMobileDuration(durationMs: Long): String {
    val totalSeconds = (durationMs / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return when {
        minutes > 0 && seconds > 0 -> "${minutes}м ${seconds}с"
        minutes > 0 -> "${minutes}м"
        seconds > 0 -> "${seconds}с"
        else -> ""
    }
}

@Composable
private fun MobileActionLine(event: CodexActionEvent) {
    val isRunning = event.status == "running" || event.status == "approved"
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isRunning) {
            CircularProgressIndicator(
                modifier = Modifier.size(13.dp),
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
                modifier = Modifier.size(14.dp)
            )
        }
        Spacer(modifier = Modifier.width(7.dp))
        Text(
            "${actionKindLabel(event)}: ${actionStatusText(event)}",
            color = TextSecondary,
            fontSize = 11.5.sp,
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
                fontSize = 11.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

private fun actionKindLabel(event: CodexActionEvent): String {
    val text = listOf(event.type, event.title, event.detail).joinToString(" ").lowercase(Locale.getDefault())
    return when {
        "test" in text || "gradle" in text || "npm test" in text -> "Tests"
        "git" in text || "commit" in text || "push" in text || "stage" in text -> "Git"
        "diff" in text || "patch" in text || "change" in text || "restore" in text -> "Changes"
        "diagnostic" in text || "problem" in text || "error" in text -> "Diagnostics"
        "read-file" in text || "file" in text -> "Files"
        event.type == "model_progress" -> "Codex"
        event.type.contains("command") -> "Command"
        else -> "Action"
    }
}

private fun actionStatusText(event: CodexActionEvent): String {
    val title = event.title.trim()
    if (title.isNotBlank() && !event.type.contains("command")) return title
    if (event.type == "model_progress") return title.ifBlank { "Прогресс модели" }
    return when (event.status) {
        "running", "approved" -> "Выполняется"
        "pending" -> if (event.actionable) "Ожидает подтверждения" else "Ожидает"
        "completed" -> "Выполнено"
        "failed" -> "Ошибка"
        "denied" -> "Отклонено"
        else -> title.ifBlank { event.type }
    }
}

private fun compactActionText(event: CodexActionEvent): String {
    val title = event.title.trim()
    val raw = if (title.isNotBlank() && !event.type.contains("command")) {
        event.detail
    } else {
        event.detail.ifBlank { title.ifBlank { event.type } }
    }
    return raw
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
    onOpenFile: (String) -> Unit,
    isChangeDiffLoading: Boolean,
    onLoadChangeDiff: (String, String?, String?) -> Unit,
    onReviewChange: (String?, String?, String?) -> Unit,
    onUndoChange: (String?, String?, String?) -> Unit,
    onEditMessage: (String) -> Unit,
    onDeleteMessage: (String) -> Unit,
    onRegenerateMessage: (String) -> Unit
) {
    val isUser = message.role == "user"
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val userBubbleMaxWidth = (configuration.screenWidthDp * 0.82f).coerceAtMost(680f).dp
    val cleanedContent = remember(message.content) { cleanMobileMessageContent(message.content) }
    val changeSummary = remember(message.content, message.changeSummary) {
        message.changeSummary?.takeIf { it.files.isNotEmpty() } ?: parseMobileChangeSummary(message.content)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 0.dp)
    ) {
        if (isUser) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Surface(
                    color = Color(0xFF242424),
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, Color(0xFF2F2F2F)),
                    modifier = Modifier.widthIn(max = userBubbleMaxWidth)
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
            MobileMessageToolbar(
                isUser = true,
                alignCenter = true,
                canDelete = message.id.isNotBlank(),
                onCopy = { context.copyMessageToClipboard(cleanedContent) },
                onEdit = { onEditMessage(cleanedContent) },
                onDelete = { onDeleteMessage(message.id) },
                onRegenerate = {}
            )
        } else {
            if (message.isStreaming) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 6.dp)) {
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
                Spacer(modifier = Modifier.height(7.dp))
                MobileMessageAttachments(message.attachments)
            }
            if (changeSummary != null) {
                Spacer(modifier = Modifier.height(7.dp))
                MobileChangeCard(
                    summary = changeSummary,
                    isDiffLoading = isChangeDiffLoading,
                    onOpenFile = onOpenFile,
                    onLoadDiff = onLoadChangeDiff,
                    onReview = onReviewChange,
                    onUndo = onUndoChange
                )
            }
            MobileMessageToolbar(
                isUser = false,
                alignCenter = false,
                canDelete = message.id.isNotBlank(),
                onCopy = { context.copyMessageToClipboard(cleanedContent) },
                onEdit = {},
                onDelete = { onDeleteMessage(message.id) },
                onRegenerate = { onRegenerateMessage(message.id) }
            )
        }
    }
}

@Composable
private fun MobileMessageToolbar(
    isUser: Boolean,
    alignCenter: Boolean,
    canDelete: Boolean,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRegenerate: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 1.dp),
        horizontalArrangement = if (alignCenter) Arrangement.Center else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isUser) {
            MobileMessageToolButton(
                icon = Icons.Outlined.Edit,
                contentDescription = "Редактировать",
                onClick = onEdit
            )
        }
        MobileMessageToolButton(
            icon = Icons.Outlined.ContentCopy,
            contentDescription = "Копировать",
            onClick = onCopy
        )
        if (!isUser) {
            MobileMessageToolButton(
                icon = Icons.Default.Refresh,
                contentDescription = "Повторить ответ",
                onClick = onRegenerate
            )
        }
        MobileMessageToolButton(
            icon = Icons.Outlined.Delete,
            contentDescription = "Удалить",
            enabled = canDelete,
            danger = true,
            onClick = onDelete
        )
    }
}

@Composable
private fun MobileMessageToolButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    enabled: Boolean = true,
    danger: Boolean = false,
    onClick: () -> Unit
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(26.dp)
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = when {
                !enabled -> TextSecondary.copy(alpha = 0.34f)
                danger -> TextSecondary.copy(alpha = 0.82f)
                else -> TextSecondary
            },
            modifier = Modifier.size(14.dp)
        )
    }
}

private fun Context.copyMessageToClipboard(text: String) {
    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("Remote Code message", text))
    Toast.makeText(this, "Сообщение скопировано", Toast.LENGTH_SHORT).show()
}

@Composable
private fun MobileMessageAttachments(
    attachments: List<MessageAttachment>,
    modifier: Modifier = Modifier
) {
    var previewAttachment by remember { mutableStateOf<MessageAttachment?>(null) }
    previewAttachment?.let { attachment ->
        MobileImagePreviewDialog(
            attachment = attachment,
            onDismiss = { previewAttachment = null }
        )
    }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF242424), RoundedCornerShape(8.dp))
                    .clickable(enabled = attachment.isImageAttachment() && attachment.base64.isNotBlank()) {
                        previewAttachment = attachment
                    }
                    .padding(horizontal = 9.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val imageBitmap = remember(attachment.base64, attachment.mimeType) { attachment.previewBitmap() }
                if (imageBitmap != null) {
                    Image(
                        bitmap = imageBitmap,
                        contentDescription = attachment.name,
                        modifier = Modifier
                            .size(width = 58.dp, height = 42.dp)
                            .background(Color(0xFF171717), RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .background(Color(0xFF171717), RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                    }
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

@Composable
private fun MobileImagePreviewDialog(
    attachment: MessageAttachment,
    onDismiss: () -> Unit
) {
    val imageBitmap = remember(attachment.base64, attachment.mimeType) { attachment.previewBitmap() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(attachment.name.ifBlank { "Изображение" }, color = TextBright, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        text = {
            if (imageBitmap != null) {
                Image(
                    bitmap = imageBitmap,
                    contentDescription = attachment.name,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 460.dp)
                        .background(Color(0xFF111111), RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Fit
                )
            } else {
                Text("Не удалось открыть изображение.", color = TextSecondary)
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Закрыть")
            }
        },
        containerColor = Color(0xFF242424)
    )
}

private fun MessageAttachment.isImageAttachment(): Boolean {
    return mimeType.startsWith("image/", ignoreCase = true)
}

private fun MessageAttachment.previewBitmap() = runCatching {
    if (!isImageAttachment() || base64.isBlank()) return@runCatching null
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

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
    val blocks = remember(text) { mobileTextBlocks(text) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        blocks.forEach { block ->
            when (block.kind) {
                MobileTextBlockKind.Bullet -> MobileBulletList(block.lines, ordered = false)
                MobileTextBlockKind.Ordered -> MobileBulletList(block.lines, ordered = true, startNumber = block.startNumber)
                MobileTextBlockKind.Code -> MobileCodeBlock(block.lines, block.language)
                else -> Text(
                    highlightedText(block.lines.joinToString("\n")),
                    color = TextPrimary,
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
            }
        }
    }
}

@Composable
private fun MobileCodeBlock(lines: List<String>, language: String = "text") {
    Surface(
        color = Color(0xFF171717),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, DividerColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Text(
                language.ifBlank { "text" },
                color = TextSecondary,
                fontSize = 11.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF202020))
                    .padding(horizontal = 10.dp, vertical = 7.dp)
            )
            Text(
                lines.joinToString("\n"),
                color = TextPrimary,
                fontSize = 12.5.sp,
                lineHeight = 18.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp)
            )
        }
    }
}

@Composable
private fun MobileBulletList(lines: List<String>, ordered: Boolean, startNumber: Int = 1) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        lines.forEachIndexed { index, line ->
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    if (ordered) "${startNumber + index}." else "•",
                    color = TextSecondary,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.width(24.dp)
                )
                Text(
                    highlightedText(line),
                    color = TextPrimary,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

private enum class MobileTextBlockKind { Paragraph, Bullet, Ordered, Code }

private data class MobileTextBlock(
    val kind: MobileTextBlockKind,
    val lines: List<String>,
    val startNumber: Int = 1,
    val language: String = "text"
)

private fun mobileTextBlocks(text: String): List<MobileTextBlock> {
    val blocks = mutableListOf<MobileTextBlock>()
    val paragraph = mutableListOf<String>()
    fun flushParagraph() {
        val clean = paragraph.map { it.trimEnd() }.filter { it.isNotBlank() }
        if (clean.isNotEmpty()) blocks += MobileTextBlock(MobileTextBlockKind.Paragraph, clean)
        paragraph.clear()
    }
    var index = 0
    val lines = text.replace("\r\n", "\n").lines()
    val bulletRegex = Regex("""^\s*[-*•]\s+(.+)$""")
    val orderedRegex = Regex("""^\s*(\d+)[.)]\s+(.+)$""")
    fun nextListItemIndex(start: Int, regex: Regex): Int? {
        var probe = start
        while (probe < lines.size && lines[probe].isBlank()) probe++
        return probe.takeIf { it < lines.size && regex.find(lines[it]) != null }
    }
    while (index < lines.size) {
        val raw = lines[index]
        val fence = Regex("""^\s*```([A-Za-z0-9_+.#-]*)\s*$""").find(raw)
        val bullet = bulletRegex.find(raw)
        val ordered = orderedRegex.find(raw)
        when {
            fence != null -> {
                flushParagraph()
                val codeLines = mutableListOf<String>()
                val language = fence.groupValues.getOrNull(1).orEmpty().ifBlank { "text" }
                index++
                while (index < lines.size && !Regex("""^\s*```\s*$""").matches(lines[index])) {
                    codeLines += lines[index]
                    index++
                }
                if (index < lines.size) index++
                blocks += MobileTextBlock(MobileTextBlockKind.Code, codeLines, language = language)
            }
            raw.isBlank() -> {
                flushParagraph()
                index++
            }
            bullet != null -> {
                flushParagraph()
                val items = mutableListOf<String>()
                while (index < lines.size) {
                    if (lines[index].isBlank()) {
                        val nextIndex = nextListItemIndex(index + 1, bulletRegex)
                        if (nextIndex == null) break
                        index = nextIndex
                    }
                    val match = bulletRegex.find(lines[index]) ?: break
                    items += match.groupValues[1].trim()
                    index++
                }
                blocks += MobileTextBlock(MobileTextBlockKind.Bullet, items)
            }
            ordered != null -> {
                flushParagraph()
                val items = mutableListOf<String>()
                val startNumber = ordered.groupValues[1].toIntOrNull() ?: 1
                while (index < lines.size) {
                    if (lines[index].isBlank()) {
                        val nextIndex = nextListItemIndex(index + 1, orderedRegex)
                        if (nextIndex == null) break
                        index = nextIndex
                    }
                    val match = orderedRegex.find(lines[index]) ?: break
                    items += match.groupValues[2].trim()
                    index++
                }
                blocks += MobileTextBlock(MobileTextBlockKind.Ordered, items, startNumber)
            }
            else -> {
                paragraph += raw
                index++
            }
        }
    }
    flushParagraph()
    return blocks.ifEmpty { listOf(MobileTextBlock(MobileTextBlockKind.Paragraph, listOf(text))) }
}

@Composable
private fun MobileChangeCard(
    summary: CodexChangeSummary,
    isDiffLoading: Boolean,
    onOpenFile: (String) -> Unit,
    onLoadDiff: (String, String?, String?) -> Unit,
    onReview: (String?, String?, String?) -> Unit,
    onUndo: (String?, String?, String?) -> Unit
) {
    var expanded by remember(summary.files) { mutableStateOf(false) }
    val visibleFiles = if (expanded) summary.files else summary.files.take(5)
    val primaryPath = summary.files.firstOrNull()?.path
    Surface(
        color = Color(0xFF242424),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Color(0xFF303030)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2D2D2D))
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        changeHeaderTitle(summary),
                        color = TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    ChangeDeltaStrip(
                        additions = summary.additions,
                        deletions = summary.deletions,
                        alwaysShowZero = true,
                        modifier = Modifier.padding(start = 2.dp)
                    )
                }
                TextButton(
                    onClick = { onUndo(summary.commit, summary.cwd, null) },
                    modifier = Modifier.height(30.dp),
                    contentPadding = PaddingValues(horizontal = 5.dp, vertical = 0.dp)
                ) {
                    Text("Undo", color = ErrorRed, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                }
                IconButton(
                    onClick = { onReview(summary.commit, summary.cwd, primaryPath) },
                    enabled = summary.files.isNotEmpty(),
                    modifier = Modifier.size(30.dp)
                ) {
                    Icon(Icons.Default.NorthEast, contentDescription = "Проверить", tint = TextSecondary, modifier = Modifier.size(14.dp))
                }
                IconButton(onClick = { expanded = !expanded }, modifier = Modifier.size(30.dp)) {
                    Icon(
                        if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = if (expanded) "Свернуть" else "Развернуть",
                        tint = TextSecondary,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
            if (isDiffLoading) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = AccentBlue,
                    trackColor = Color(0xFF303030)
                )
            }
            visibleFiles.forEach { file ->
                ChangeFileRow(
                    file = file,
                    onOpenFile = onOpenFile,
                    onLoadDiff = { onLoadDiff(file.path, summary.commit, summary.cwd) }
                )
            }
        }
    }
}

private fun changeHeaderTitle(summary: CodexChangeSummary): String {
    val fileCount = changeFileCount(summary)
    return "Изменено $fileCount ${pluralRu(fileCount, "файл", "файла", "файлов")}"
}

private fun changeFileCount(summary: CodexChangeSummary): Int {
    return summary.fileCount.takeIf { it > 0 } ?: summary.files.size
}

@Composable
private fun ChangeDeltaStrip(
    additions: Int,
    deletions: Int,
    alwaysShowZero: Boolean = false,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.widthIn(min = 92.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically
    ) {
        val showAdditions = alwaysShowZero || additions > 0
        val showDeletions = alwaysShowZero || deletions > 0
        if (showAdditions) ChangeDeltaText("+$additions", AccentGreen)
        if (showAdditions && showDeletions) Spacer(modifier = Modifier.width(7.dp))
        if (showDeletions) ChangeDeltaText("-$deletions", ErrorRed)
    }
}

@Composable
private fun ChangeDeltaText(value: String, color: Color) {
    Text(
        value,
        color = color,
        fontSize = 11.75.sp,
        lineHeight = 14.sp,
        fontFamily = FontFamily.Monospace,
        maxLines = 1,
        softWrap = false
    )
}

private fun findMobileChangeSummaryForDiff(
    diff: CodexChangeActionResponse,
    messages: List<CodexChatMessage>
): CodexChangeSummary? {
    val targetPath = diff.path.orEmpty().replace('\\', '/')
    val summaries = messages.mapNotNull { message ->
        message.changeSummary?.takeIf { it.files.isNotEmpty() } ?: parseMobileChangeSummary(message.content)
    }
    return summaries.firstOrNull { summary ->
        val sameCommit = diff.commit.isNullOrBlank() || summary.commit == diff.commit
        val sameCwd = diff.cwd.isNullOrBlank() || summary.cwd == diff.cwd
        val hasFile = summary.files.any { file ->
            val candidate = file.path.replace('\\', '/')
            candidate == targetPath || candidate.endsWith("/$targetPath") || targetPath.endsWith("/$candidate")
        }
        hasFile && (sameCommit || sameCwd)
    } ?: summaries.firstOrNull { summary ->
        summary.files.any { file -> file.path.replace('\\', '/') == targetPath }
    }
}

@Composable
private fun ChangeFileRow(
    file: CodexChangeFile,
    onOpenFile: (String) -> Unit,
    onLoadDiff: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onLoadDiff() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            file.path,
            color = TextPrimary,
            fontSize = 11.75.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        ChangeDeltaStrip(
            additions = file.additions,
            deletions = file.deletions,
            modifier = Modifier.padding(start = 8.dp)
        )
        IconButton(onClick = { onOpenFile(file.path) }, modifier = Modifier.size(26.dp)) {
            Icon(Icons.Default.NorthEast, contentDescription = "Open file", tint = TextSecondary, modifier = Modifier.size(13.dp))
        }
    }
}

@Composable
private fun MobileChangeDiffDialog(
    diff: CodexChangeActionResponse,
    files: List<CodexChangeFile>,
    onSelectFile: (CodexChangeFile) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val diffText = diff.diff.orEmpty().ifBlank { diff.message ?: "No diff available." }
    val activePath = diff.path.orEmpty().replace('\\', '/')
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text("Diff", color = TextBright, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                diff.path?.takeIf { it.isNotBlank() }?.let {
                    Text(it, color = TextSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (files.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(files) { file ->
                            val selected = file.path.replace('\\', '/') == activePath
                            AssistChip(
                                onClick = { onSelectFile(file) },
                                label = {
                                    Text(
                                        file.path.substringAfterLast('/').substringAfterLast('\\'),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                },
                                leadingIcon = {
                                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, contentDescription = null, modifier = Modifier.size(15.dp))
                                },
                                colors = AssistChipDefaults.assistChipColors(
                                    containerColor = if (selected) Color(0xFF34343A) else Color(0xFF202020),
                                    labelColor = if (selected) TextBright else TextSecondary,
                                    leadingIconContentColor = if (selected) AccentBlue else TextSecondary
                                ),
                                border = AssistChipDefaults.assistChipBorder(
                                    enabled = true,
                                    borderColor = if (selected) AccentBlue.copy(alpha = 0.55f) else Color(0xFF303030)
                                )
                            )
                        }
                    }
                }
                Surface(
                    color = Color(0xFF171717),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Color(0xFF303030)),
                    modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp)
                ) {
                    LazyColumn(modifier = Modifier.padding(10.dp)) {
                        item {
                            Text(
                                highlightedDiffText(diffText),
                                fontSize = 11.5.sp,
                                lineHeight = 15.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                context.copyMessageToClipboard(diffText)
                onDismiss()
            }) {
                Text("Copy")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        },
        containerColor = Color(0xFF242424)
    )
}

private fun highlightedDiffText(text: String): AnnotatedString {
    return buildAnnotatedString {
        text.lineSequence().forEach { line ->
            val start = length
            append(line)
            append('\n')
            val color = when {
                line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") -> AccentBlue
                line.startsWith("+") -> AccentGreen
                line.startsWith("-") -> ErrorRed
                line.startsWith("diff ") || line.startsWith("index ") -> TextSecondary
                else -> TextPrimary
            }
            addStyle(SpanStyle(color = color), start, length)
        }
    }
}

private fun highlightedText(text: String): AnnotatedString {
    val displayText = text.replace(Regex("""\[([^\]]+)]\(([^)]+)\)""")) { match ->
        match.groupValues[1].ifBlank { match.groupValues[2] }
    }
    val boldRegex = Regex("""\*\*(.+?)\*\*""", setOf(RegexOption.DOT_MATCHES_ALL))
    return buildAnnotatedString {
        var index = 0
        boldRegex.findAll(displayText).forEach { match ->
            appendHighlightedSegment(displayText.substring(index, match.range.first), bold = false)
            appendHighlightedSegment(match.groupValues[1], bold = true)
            index = match.range.last + 1
        }
        appendHighlightedSegment(displayText.substring(index), bold = false)
    }
}

private fun AnnotatedString.Builder.appendHighlightedSegment(segment: String, bold: Boolean) {
    val tokenRegex = Regex("""(`[^`]+`|C:\\[^\s`]+|(?:[\w.-]+[\\/])+[\w.@%+\-()]+|\b\d+\.\d+\.\d+\b|\b[0-9a-f]{7,40}\b|\b(?:npm run compile|npm test|vsce package|assembleDebug|testDebugUnitTest|lintDebug|Developer: Reload Window|200 OK|NO-SOURCE)\b)""", RegexOption.IGNORE_CASE)
    var index = 0
    tokenRegex.findAll(segment).forEach { match ->
        appendStyledPlain(segment.substring(index, match.range.first), bold)
        val raw = match.value.trim('`')
        val start = length
        append(raw)
        addStyle(
            SpanStyle(
                color = TextPrimary,
                background = Color(0xFF232323),
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                fontWeight = if (bold) FontWeight.Bold else null
            ),
            start,
            length
        )
        index = match.range.last + 1
    }
    appendStyledPlain(segment.substring(index), bold)
}

private fun AnnotatedString.Builder.appendStyledPlain(value: String, bold: Boolean) {
    if (value.isEmpty()) return
    val start = length
    append(value)
    if (bold) {
        addStyle(SpanStyle(fontWeight = FontWeight.Bold, color = TextBright), start, length)
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
        if (trimmed.startsWith("::code-comment{")) {
            codeCommentTitle(trimmed)?.let { cleaned += "• $it" }
            index++
            continue
        }
        if (isTechnicalMobileLine(trimmed)) {
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

private fun codeCommentTitle(line: String): String? {
    return Regex("title=\\\"([^\\\"]+)\\\"")
        .find(line)
        ?.groupValues
        ?.getOrNull(1)
        ?.replace("\\\"", "\"")
        ?.trim()
        ?.takeIf { it.isNotBlank() }
}

private fun parseMobileChangeSummary(content: String): CodexChangeSummary? {
    val lines = content.lines()
    val headerIndex = lines.indexOfFirst { it.trim().matches(Regex("""Изменено\s+\d+\s+файл.*""", RegexOption.IGNORE_CASE)) }
    if (headerIndex < 0) return null
    val headerTotals = Regex("""Изменено\s+(\d+)\s+файл\p{L}*\s+\+(\d+)\s+-(\d+)""", RegexOption.IGNORE_CASE)
        .find(lines[headerIndex].trim())
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
        commit = extractMobileCommitHash(content),
        cwd = extractMobileDirectiveCwd(content),
        fileCount = headerTotals?.groupValues?.getOrNull(1)?.toIntOrNull() ?: files.size,
        files = files,
        additions = headerTotals?.groupValues?.getOrNull(2)?.toIntOrNull() ?: files.sumOf { it.additions },
        deletions = headerTotals?.groupValues?.getOrNull(3)?.toIntOrNull() ?: files.sumOf { it.deletions }
    )
}

private fun extractMobileCommitHash(content: String): String? {
    return Regex("""(?:commit|коммит)\s*:?\s*`?([0-9a-f]{7,40})`?""", RegexOption.IGNORE_CASE)
        .find(content)
        ?.groupValues
        ?.getOrNull(1)
}

private fun extractMobileDirectiveCwd(content: String): String? {
    return Regex("::git-(?:stage|commit|push)\\{[^}]*cwd=\\\"([^\\\"]+)\\\"")
        .find(content)
        ?.groupValues
        ?.getOrNull(1)
        ?.replace("\\\\", "\\")
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

private fun isTechnicalMobileLine(line: String): Boolean {
    val normalized = line
        .replace("&lt;", "<", ignoreCase = true)
        .replace("&gt;", ">", ignoreCase = true)
        .replace("&amp;", "&", ignoreCase = true)
        .replace("`", "")
        .trim()
    if (normalized.isBlank() || normalized.matches(Regex("""^[.\-_*•]+$"""))) return true
    return normalized.matches(Regex("""^</?(image|video|audio|file|environment_context|attachments?|user|system)(\s|>|$).*""", RegexOption.IGNORE_CASE))
        || normalized.matches(Regex("""^<[^>]+>$"""))
        || normalized.matches(Regex("""^!\[[^\]]*]\([^)]+\)$"""))
        || normalized.matches(Regex("""^#{0,2}\s*Files mentioned by the user.*""", RegexOption.IGNORE_CASE))
        || normalized.matches(Regex("""^##\s+.+\.(png|jpe?g|webp|gif|txt|md|log|json):.*""", RegexOption.IGNORE_CASE))
        || normalized.matches(Regex("""^My request for (Codex|Code):?$""", RegexOption.IGNORE_CASE))
        || normalized.matches(Regex("""^[A-Za-z]:[\\/].*"""))
        || normalized.matches(Regex("""^(path|file|image|photo|screenshot)\s*[:=]\s*.*""", RegexOption.IGNORE_CASE))
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
