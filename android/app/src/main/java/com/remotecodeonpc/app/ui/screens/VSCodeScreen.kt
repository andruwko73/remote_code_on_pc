package com.remotecodeonpc.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.*
import com.remotecodeonpc.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VSCodeScreen(
    folders: FoldersResponse?,
    currentFiles: FileTreeItem?,
    fileContent: FileContent?,
    isLoadingFiles: Boolean,
    codexModels: List<CodexModel>,
    codexSelectedModel: String,
    codexReasoningEffort: String,
    codexProfile: String,
    codexIncludeContext: Boolean,
    codexChatHistory: List<CodexChatMessage>,
    codexActionEvents: List<CodexActionEvent>,
    codexSendResult: CodexSendResponse?,
    codexThreads: List<CodexThread>,
    codexProjects: List<CodexProject>,
    currentCodexThreadId: String,
    currentCodexProjectId: String,
    isCodexLoading: Boolean,
    codexError: String?,
    onSendCodexMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectCodexModel: (String) -> Unit,
    onSelectCodexReasoningEffort: (String) -> Unit,
    onSelectCodexProfile: (String) -> Unit,
    onToggleCodexContext: () -> Unit,
    onNewCodexThread: () -> Unit,
    onLoadCodexThreads: () -> Unit,
    onDeleteCodexThread: (String) -> Unit,
    onDeleteCodexMessage: (String) -> Unit = {},
    onRegenerateCodexMessage: (String) -> Unit = {},
    onStopCodexGeneration: () -> Unit,
    onRespondToCodexAction: (String, Boolean) -> Unit,
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("CODEX", "\u041F\u0420\u041E\u0415\u041A\u0422\u042B")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        Surface(
            color = DarkSurface,
            shadowElevation = 2.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                tabs.forEachIndexed { index, title ->
                    TextButton(
                        onClick = { selectedTab = index },
                        modifier = Modifier
                            .height(34.dp)
                            .widthIn(min = 72.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = if (selectedTab == index) AccentBlue else TextSecondary
                        )
                    ) {
                        Text(
                            title,
                            fontSize = 13.sp,
                            fontWeight = if (selectedTab == index) FontWeight.SemiBold else FontWeight.Normal,
                            maxLines = 1
                        )
                    }
                }
                Spacer(modifier = Modifier.weight(1f))
                IconButton(
                    onClick = onNavigateToSettings,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        Icons.Outlined.Settings,
                        contentDescription = "Settings",
                        tint = TextSecondary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }

        when (selectedTab) {
            0 -> CodexChatTab(
                models = codexModels,
                selectedModel = codexSelectedModel,
                selectedReasoningEffort = codexReasoningEffort,
                selectedProfile = codexProfile,
                includeContext = codexIncludeContext,
                chatHistory = codexChatHistory,
                actionEvents = codexActionEvents,
                sendResult = codexSendResult,
                threads = codexThreads,
                projects = codexProjects,
                currentThreadId = currentCodexThreadId,
                currentProjectId = currentCodexProjectId,
                isLoading = isCodexLoading,
                error = codexError,
                onSendMessage = onSendCodexMessage,
                onSelectModel = onSelectCodexModel,
                onSelectReasoningEffort = onSelectCodexReasoningEffort,
                onSelectProfile = onSelectCodexProfile,
                onToggleContext = onToggleCodexContext,
                onNewThread = onNewCodexThread,
                onLoadThreads = onLoadCodexThreads,
                onDeleteThread = onDeleteCodexThread,
                onDeleteMessage = onDeleteCodexMessage,
                onRegenerateMessage = onRegenerateCodexMessage,
                onStopGeneration = onStopCodexGeneration,
                onRespondToAction = onRespondToCodexAction,
                onNavigateToSettings = onNavigateToSettings,
                onOpenFile = onOpenFile
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
