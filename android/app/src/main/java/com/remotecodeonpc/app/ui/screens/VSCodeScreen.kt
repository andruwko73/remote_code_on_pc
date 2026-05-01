package com.remotecodeonpc.app.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
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
    // Chat params
    agents: List<ChatAgent>,
    selectedAgent: String,
    chatHistory: List<ChatMessage>,
    conversations: List<ChatConversation>,
    currentChatId: String,
    isChatLoading: Boolean,
    chatError: String?,
    isThinking: Boolean,
    // Files params
    folders: FoldersResponse?,
    currentFiles: FileTreeItem?,
    fileContent: FileContent?,
    isLoadingFiles: Boolean,
    // Callbacks
    onSendMessage: (String) -> Unit,
    onSelectAgent: (String) -> Unit,
    onNewChat: () -> Unit,
    onSwitchChat: (String) -> Unit,
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
            .background(DarkBackground)
    ) {
        // Верхняя панель с табами
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
                        Icons.Filled.Code,
                        contentDescription = "VS Code",
                        tint = AccentBlue,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "VS Code",
                        color = TextBright,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    // Кнопка настроек
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            Icons.Outlined.Settings,
                            contentDescription = "Настройки",
                            tint = TextSecondary
                        )
                    }
                }
                // Табы
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

        // Контент табов
        when (selectedTab) {
            0 -> ChatScreen(
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
