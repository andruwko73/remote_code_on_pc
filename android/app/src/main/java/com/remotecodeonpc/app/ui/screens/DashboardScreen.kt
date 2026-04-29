package com.remotecodeonpc.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.WorkspaceStatus
import com.remotecodeonpc.app.DiagnosticsResponse
import com.remotecodeonpc.app.FoldersResponse
import com.remotecodeonpc.app.ui.theme.*

@Composable
fun DashboardScreen(
    status: WorkspaceStatus?,
    diagnostics: DiagnosticsResponse?,
    folders: FoldersResponse?,
    isConnected: Boolean,
    onNavigateToChat: () -> Unit,
    onNavigateToFiles: () -> Unit,
    onNavigateToDiagnostics: () -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Заголовок
        item {
            Text(
                "Remote Code on PC",
                color = TextBright,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                if (isConnected) "🟢 Подключено к ${status?.appName ?: "VS Code"}" else "🔴 Не подключено",
                color = if (isConnected) AccentGreen else ErrorRed,
                fontSize = 14.sp
            )
        }

        // Статус-карточка
        if (status != null) {
            item {
                StatusCard(status)
            }
        }

        // Быстрые действия
        item {
            Text(
                "Быстрые действия",
                color = TextSecondary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
            )
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                QuickActionCard(
                    icon = Icons.Default.Chat,
                    title = "Чат с AI",
                    subtitle = "Copilot / Codex",
                    color = AccentBlue,
                    onClick = onNavigateToChat,
                    modifier = Modifier.weight(1f)
                )
                QuickActionCard(
                    icon = Icons.Default.Folder,
                    title = "Файлы",
                    subtitle = "Обзор проекта",
                    color = AccentGreen,
                    onClick = onNavigateToFiles,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                QuickActionCard(
                    icon = Icons.Default.BugReport,
                    title = "Ошибки",
                    subtitle = "${diagnostics?.errors ?: 0} ошибок, ${diagnostics?.warnings ?: 0} предупреждений",
                    color = ErrorRed,
                    onClick = onNavigateToDiagnostics,
                    modifier = Modifier.weight(1f)
                )
                QuickActionCard(
                    icon = Icons.Default.Terminal,
                    title = "Терминал",
                    subtitle = "Команды",
                    color = AccentOrange,
                    onClick = { },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        // Статистика
        if (diagnostics != null) {
            item {
                Text(
                    "Диагностика проекта",
                    color = TextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                )
                DiagnosticsSummaryCard(diagnostics)
            }
        }

        // Открытые папки
        if (folders != null && folders.current.isNotEmpty()) {
            item {
                Text(
                    "Открытые папки",
                    color = TextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                )
                folders.current.forEach { folder ->
                    FolderCard(
                        name = folder.name,
                        path = folder.path,
                        isCurrent = true
                    )
                }
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

@Composable
private fun StatusCard(status: WorkspaceStatus) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = AccentBlue,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Информация", color = TextBright, fontWeight = FontWeight.SemiBold)
            }
            Spacer(modifier = Modifier.height(12.dp))
            InfoRow("VS Code", "${status.appName} v${status.version}")
            InfoRow("Платформа", status.platform)
            InfoRow("Активный файл", status.workspace?.activeFile ?: "—")
            InfoRow("Uptime", "${status.uptime.toInt()} сек")
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = TextSecondary, fontSize = 13.sp)
        Text(
            value,
            color = TextPrimary,
            fontSize = 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 180.dp)
        )
    }
}

@Composable
private fun QuickActionCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    color: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(28.dp))
            Text(title, color = TextBright, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, color = TextSecondary, fontSize = 12.sp, maxLines = 2)
        }
    }
}

@Composable
private fun DiagnosticsSummaryCard(diagnostics: DiagnosticsResponse) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatItem("${diagnostics.total}", "Всего", TextPrimary)
            StatItem("${diagnostics.errors}", "Ошибки", ErrorRed)
            StatItem("${diagnostics.warnings}", "Предупреждения", WarningYellow)
        }
    }
}

@Composable
private fun StatItem(value: String, label: String, color: androidx.compose.ui.graphics.Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = color, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, color = TextSecondary, fontSize = 12.sp)
    }
}

@Composable
private fun FolderCard(name: String, path: String, isCurrent: Boolean) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isCurrent) AccentBlue.copy(alpha = 0.15f) else CardBg
        ),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = if (isCurrent) AccentBlue else AccentOrange,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(name, color = TextBright, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                Text(path, color = TextSecondary, fontSize = 11.sp)
            }
        }
    }
}
