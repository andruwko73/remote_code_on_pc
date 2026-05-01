package com.remotecodeonpc.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    output: String,
    isRunning: Boolean,
    onExecCommand: (String) -> Unit,
    onClearTerminal: () -> Unit = {},
    onBack: () -> Unit
) {
    var commandText by remember { mutableStateOf("") }
    val scrollState = rememberScrollState()
    var history by remember { mutableStateOf(listOf<String>()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        // Верхняя панель
        Surface(
            color = DarkSurface,
            shadowElevation = 2.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Terminal,
                    contentDescription = "Терминал",
                    tint = AccentOrange,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "Терминал",
                    color = TextBright,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.weight(1f))
                // Кнопка очистки
                Text(
                    "Очистить",
                    color = TextSecondary,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .padding(end = 12.dp)
                        .clickable { onClearTerminal() }
                )
                Text(
                    "Назад",
                    color = AccentBlue,
                    fontSize = 13.sp,
                    modifier = Modifier.clickable { onBack() }
                )
            }
        }

        // Вывод терминала
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color(0xFF1A1A1A))
                .padding(12.dp)
        ) {
            val displayText = if (output.isBlank()) "> Терминал готов. Введите команду ниже." else output
            Text(
                displayText,
                color = AccentGreen,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.verticalScroll(scrollState)
            )
        }

        // Строка ввода
        Surface(
            color = DarkSurface,
            shadowElevation = 8.dp
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
                // Быстрые команды
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    QuickCommandChip("node -v") { commandText = it }
                    QuickCommandChip("npm list -g --depth=0") { commandText = it }
                    QuickCommandChip("code .") { commandText = it }
                    QuickCommandChip("dir") { commandText = it }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = commandText,
                        onValueChange = { commandText = it },
                        placeholder = { Text("Введите команду...", color = TextSecondary) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = AccentOrange,
                            unfocusedBorderColor = DividerColor,
                            cursorColor = AccentOrange,
                            focusedContainerColor = DarkSurfaceVariant,
                            unfocusedContainerColor = DarkSurfaceVariant
                        ),
                        shape = RoundedCornerShape(20.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(
                            onGo = {
                                if (commandText.isNotBlank()) {
                                    history = history + commandText
                                    onExecCommand(commandText)
                                    commandText = ""
                                }
                            }
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = {
                            if (commandText.isNotBlank()) {
                                history = history + commandText
                                onExecCommand(commandText)
                                commandText = ""
                            }
                        },
                        enabled = commandText.isNotBlank() && !isRunning,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = AccentOrange,
                            disabledContainerColor = AccentOrange.copy(alpha = 0.3f)
                        ),
                        modifier = Modifier.size(48.dp)
                    ) {
                        if (isRunning) {
                            Text("\u23F3", fontSize = 18.sp)
                        } else {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Выполнить", tint = TextBright)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickCommandChip(cmd: String, onClick: (String) -> Unit) {
    Surface(
        onClick = { onClick(cmd) },
        color = DarkSurfaceVariant,
        shape = RoundedCornerShape(6.dp)
    ) {
        Text(
            cmd,
            color = AccentOrange,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}
