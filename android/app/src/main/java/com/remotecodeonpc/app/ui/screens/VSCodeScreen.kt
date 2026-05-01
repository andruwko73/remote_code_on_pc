package com.remotecodeonpc.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.*
import com.remotecodeonpc.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VSCodeScreen(
    agents: List<ChatAgent>,
    selectedAgent: String,
    chatHistory: List<ChatMessage>,
    conversations: List<ChatConversation>,
    currentChatId: String,
    isChatLoading: Boolean,
    chatError: String?,
    isThinking: Boolean,
    folders: FoldersResponse?,
    currentFiles: FileTreeItem?,
    fileContent: FileContent?,
    isLoadingFiles: Boolean,
    onSendMessage: (String) -> Unit,
    onSelectAgent: (String) -> Unit,
    onNewChat: () -> Unit,
    onSwitchChat: (String) -> Unit,
    codexStatus: CodexStatus?,
    codexModels: List<CodexModel>,
    codexSelectedModel: String,
    codexChatHistory: List<CodexChatMessage>,
    codexActionEvents: List<CodexActionEvent>,
    codexSendResult: CodexSendResponse?,
    codexThreads: List<CodexThread>,
    currentCodexThreadId: String,
    isCodexLoading: Boolean,
    codexError: String?,
    onSendCodexMessage: (String, List<MessageAttachment>) -> Unit,
    onSelectCodexModel: (String) -> Unit,
    onLaunchCodex: () -> Unit,
    onLoadCodexThreads: () -> Unit,
    onSwitchCodexThread: (String) -> Unit,
    onRespondToCodexAction: (String, Boolean) -> Unit,
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Codex", "VS Code", "Файлы")

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
                Icon(
                    Icons.Filled.DesktopWindows,
                    contentDescription = "Remote Code",
                    tint = AccentBlue,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "Remote Code",
                    color = TextBright,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 112.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                tabs.forEachIndexed { index, title ->
                    TextButton(
                        onClick = { selectedTab = index },
                        modifier = Modifier
                            .height(34.dp)
                            .weight(1f),
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
                status = codexStatus,
                models = codexModels,
                selectedModel = codexSelectedModel,
                chatHistory = codexChatHistory,
                actionEvents = codexActionEvents,
                sendResult = codexSendResult,
                threads = codexThreads,
                currentThreadId = currentCodexThreadId,
                isLoading = isCodexLoading,
                error = codexError,
                onSendMessage = onSendCodexMessage,
                onSelectModel = onSelectCodexModel,
                onLaunchCodex = onLaunchCodex,
                onLoadThreads = onLoadCodexThreads,
                onSwitchThread = onSwitchCodexThread,
                onRespondToAction = onRespondToCodexAction
            )
            1 -> ChatScreen(
                agents = agents,
                selectedAgent = selectedAgent,
                chatHistory = chatHistory,
                conversations = conversations,
                currentChatId = currentChatId,
                isChatLoading = isChatLoading,
                chatError = chatError,
                isThinking = isThinking,
                onSendMessage = onSendMessage,
                onSelectAgent = onSelectAgent,
                onNewChat = onNewChat,
                onSwitchChat = onSwitchChat
            )
            2 -> FilesScreen(
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
