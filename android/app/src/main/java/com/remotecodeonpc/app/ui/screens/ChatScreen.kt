package com.remotecodeonpc.app.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.ChatAgent
import com.remotecodeonpc.app.ChatConversation
import com.remotecodeonpc.app.ChatMessage
import com.remotecodeonpc.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    agents: List<ChatAgent>,
    selectedAgent: String,
    chatHistory: List<ChatMessage>,
    conversations: List<ChatConversation>,
    currentChatId: String,
    isChatLoading: Boolean,
    chatError: String?,
    isThinking: Boolean,
    onSendMessage: (String) -> Unit,
    onSelectAgent: (String) -> Unit,
    onNewChat: () -> Unit,
    onSwitchChat: (String) -> Unit
) {
    var messageText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    var showAgentSelector by remember { mutableStateOf(false) }
    var showConversations by remember { mutableStateOf(false) }

    // Автоскролл
    LaunchedEffect(chatHistory.size) {
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
        // Верхняя панель
        Surface(
            color = DarkSurface,
            shadowElevation = 2.dp
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                // Заголовок + кнопки
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Выбор агента
                    Box {
                        AgentChip(
                            agentName = selectedAgent,
                            agents = agents,
                            onClick = { showAgentSelector = true }
                        )
                        DropdownMenu(
                            expanded = showAgentSelector,
                            onDismissRequest = { showAgentSelector = false },
                            modifier = Modifier
                                .background(DarkSurface)
                                .widthIn(min = 220.dp)
                        ) {
                            agents.forEach { agent ->
                                val aColor = when {
                                    agent.name == "auto" -> AccentBlue
                                    agent.name == "gpt-4o" -> AccentBlue
                                    agent.name == "gpt-4o-mini" -> AccentGreen
                                    agent.name == "deepseek-v3" -> AccentOrange
                                    agent.name == "o3-mini" -> AccentPink
                                    agent.name == "o4-mini" -> WarningYellow
                                    agent.name == "claude-sonnet" -> ErrorRed
                                    else -> AccentBlue
                                }
                                DropdownMenuItem(
                                    text = {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(
                                                Icons.Default.SmartToy,
                                                contentDescription = null,
                                                tint = if (agent.name == selectedAgent) aColor else TextSecondary,
                                                modifier = Modifier.size(20.dp)
                                            )
                                            Spacer(modifier = Modifier.width(10.dp))
                                            Column {
                                                Text(
                                                    agent.displayName,
                                                    color = if (agent.name == selectedAgent) aColor else TextPrimary,
                                                    fontWeight = if (agent.name == selectedAgent) FontWeight.Bold else FontWeight.Normal,
                                                    fontSize = 14.sp
                                                )
                                                Row {
                                                    agent.model?.let {
                                                        Text(it, color = TextSecondary, fontSize = 11.sp)
                                                    }
                                                    agent.vendor?.let {
                                                        if (agent.model != null) Text(" · ", color = TextSecondary, fontSize = 11.sp)
                                                        Text(it, color = TextSecondary.copy(alpha = 0.7f), fontSize = 11.sp)
                                                    }
                                                }
                                            }
                                            if (agent.name == selectedAgent) {
                                                Spacer(modifier = Modifier.weight(1f))
                                                Icon(
                                                    Icons.Default.Check,
                                                    contentDescription = null,
                                                    tint = aColor,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                            }
                                        }
                                    },
                                    onClick = {
                                        onSelectAgent(agent.name)
                                        showAgentSelector = false
                                    },
                                    modifier = Modifier.background(if (agent.name == selectedAgent) aColor.copy(alpha = 0.08f) else DarkSurface)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.weight(1f))

                    // Кнопка истории чатов
                    IconButton(onClick = { showConversations = true }) {
                        Icon(Icons.Default.History, contentDescription = "История", tint = TextSecondary)
                    }

                    // Кнопка нового чата
                    IconButton(onClick = onNewChat) {
                        Icon(Icons.Default.Add, contentDescription = "Новый чат", tint = AccentBlue)
                    }
                }

                // Выбранная модель
                Text(
                    agents.find { it.name == selectedAgent }?.let {
                        "${it.displayName}${it.model?.let { " ($it)" } ?: ""}"
                    } ?: selectedAgent,
                    color = TextSecondary,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 16.dp, bottom = 4.dp)
                )
            }
        }

        // Диалог истории чатов
        if (showConversations) {
            AlertDialog(
                onDismissRequest = { showConversations = false },
                title = { Text("История чатов", color = TextBright) },
                text = {
                    LazyColumn {
                        items(conversations) { conv ->
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSwitchChat(conv.id)
                                        showConversations = false
                                    }
                                    .padding(vertical = 2.dp),
                                color = if (conv.id == currentChatId) AccentBlue.copy(alpha = 0.15f) else DarkSurfaceVariant,
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        conv.title.ifBlank { "Чат #${conv.id.takeLast(6)}" },
                                        color = TextBright,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (conv.lastMessage.isNotBlank()) {
                                        Text(
                                            conv.lastMessage,
                                            color = TextSecondary,
                                            fontSize = 12.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.padding(top = 2.dp)
                                        )
                                    } else {
                                        Text(
                                            "${conv.messageCount} сообщений",
                                            color = TextSecondary,
                                            fontSize = 12.sp,
                                            modifier = Modifier.padding(top = 2.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showConversations = false }) {
                        Text("Закрыть", color = AccentBlue)
                    }
                },
                containerColor = DarkSurface
            )
        }

        // Сообщения
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 12.dp)
        ) {
            if (chatHistory.isEmpty()) {
                item {
                    // Пустой чат
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Chat,
                            contentDescription = null,
                            tint = TextSecondary.copy(alpha = 0.3f),
                            modifier = Modifier.size(64.dp)
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            "Новый чат",
                            color = TextSecondary,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            "Выберите агента и задайте вопрос",
                            color = TextSecondary.copy(alpha = 0.6f),
                            fontSize = 13.sp
                        )
                    }
                }
            }

            items(chatHistory) { msg ->
                ChatBubble(msg)
            }

            // Индикатор "думает"
            if (isThinking) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .background(DarkSurfaceVariant, RoundedCornerShape(16.dp))
                                .padding(horizontal = 16.dp, vertical = 10.dp)
                        ) {
                            Text("⏳", fontSize = 14.sp)
                            Spacer(modifier = Modifier.width(10.dp))
                            Text("Думаю...", color = TextSecondary, fontSize = 13.sp)
                        }
                    }
                }
            }
        }

        // Ошибка
        chatError?.let {
            Text(
                it,
                color = ErrorRed,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }

        // Поле ввода
        Surface(
            color = DarkSurface,
            shadowElevation = 8.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    placeholder = {
                        Text(
                            "Сообщение агенту ${agents.find { a -> a.name == selectedAgent }?.displayName ?: ""}...",
                            color = TextSecondary
                        )
                    },
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
                    keyboardActions = KeyboardActions(
                        onSend = {
                            if (messageText.isNotBlank()) {
                                onSendMessage(messageText)
                                messageText = ""
                            }
                        }
                    )
                )
                Spacer(modifier = Modifier.width(8.dp))
                FilledIconButton(
                    onClick = {
                        if (messageText.isNotBlank()) {
                            onSendMessage(messageText)
                            messageText = ""
                        }
                    },
                    enabled = messageText.isNotBlank() && !isChatLoading,
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = AccentBlue,
                        disabledContainerColor = AccentBlue.copy(alpha = 0.3f)
                    ),
                    modifier = Modifier.size(48.dp)
                ) {
                    if (isChatLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = TextBright
                        )
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

@Composable
private fun AgentChip(agentName: String, agents: List<ChatAgent>, onClick: () -> Unit) {
    val agent = agents.find { it.name == agentName }
    val displayName = agent?.displayName ?: agentName
    val modelName = agent?.model
    val accent = when {
        agentName == "auto" -> AccentBlue
        agentName == "gpt-4o" -> AccentBlue
        agentName == "gpt-4o-mini" -> AccentGreen
        agentName == "deepseek-v3" -> AccentOrange
        agentName == "o3-mini" -> AccentPink
        agentName == "o4-mini" -> WarningYellow
        agentName == "claude-sonnet" -> ErrorRed
        else -> AccentBlue
    }

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = accent.copy(alpha = 0.15f),
        modifier = Modifier.heightIn(min = 36.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.SmartToy,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(16.dp)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Column {
                Text(
                    displayName,
                    color = accent,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    maxLines = 1
                )
                if (modelName != null) {
                    Text(
                        modelName,
                        color = accent.copy(alpha = 0.7f),
                        fontSize = 9.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            Spacer(modifier = Modifier.width(4.dp))
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

@Composable
private fun ChatBubble(message: ChatMessage) {
    val isUser = message.role == "user"
    val bubbleColor = if (isUser) AccentBlue.copy(alpha = 0.2f) else DarkSurfaceVariant
    val align = if (isUser) Alignment.End else Alignment.Start

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        // Имя агента для ответов
        if (!isUser && message.agentName != null) {
            Text(
                message.agentName,
                color = AccentGreen,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(start = 4.dp, bottom = 2.dp)
            )
        }

        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isUser) 16.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 16.dp
            ),
            color = bubbleColor
        ) {
            Text(
                message.content,
                color = TextPrimary,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                lineHeight = 20.sp
            )
        }

        Text(
            formatTimestamp(message.timestamp),
            color = TextSecondary.copy(alpha = 0.5f),
            fontSize = 10.sp,
            modifier = Modifier.padding(
                start = if (isUser) 0.dp else 4.dp,
                end = if (isUser) 4.dp else 0.dp,
                top = 2.dp
            )
        )
    }
}

private fun formatTimestamp(timestamp: Long): String {
    if (timestamp == 0L) return ""
    val s = (System.currentTimeMillis() - timestamp) / 1000
    return when {
        s < 60 -> "только что"
        s < 3600 -> "${s / 60} мин назад"
        s < 86400 -> "${s / 3600} ч назад"
        else -> "${s / 86400} д назад"
    }
}
