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
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.DiagnosticItem
import com.remotecodeonpc.app.DiagnosticsResponse
import com.remotecodeonpc.app.ui.theme.*

@Composable
fun DiagnosticsScreen(
    diagnostics: DiagnosticsResponse?,
    onRefresh: () -> Unit
) {
    var filter by remember { mutableStateOf("all") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        // Заголовок
        Surface(color = DarkSurface, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Ошибки и проблемы", color = TextBright, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.weight(1f))
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = AccentBlue)
                    }
                }
                if (diagnostics != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        FilterChip(
                            selected = filter == "all",
                            onClick = { filter = "all" },
                            label = { Text("Все (${diagnostics.total})") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AccentBlue.copy(alpha = 0.2f),
                                selectedLabelColor = AccentBlue
                            )
                        )
                        FilterChip(
                            selected = filter == "error",
                            onClick = { filter = "error" },
                            label = { Text("Ошибки (${diagnostics.errors})") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = ErrorRed.copy(alpha = 0.2f),
                                selectedLabelColor = ErrorRed
                            )
                        )
                        FilterChip(
                            selected = filter == "warning",
                            onClick = { filter = "warning" },
                            label = { Text("Предупреждения (${diagnostics.warnings})") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = WarningYellow.copy(alpha = 0.2f),
                                selectedLabelColor = WarningYellow
                            )
                        )
                    }
                }
            }
        }

        if (diagnostics == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = AccentBlue)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Загрузка...", color = TextSecondary)
                }
            }
        } else if (diagnostics.total == 0) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = AccentGreen, modifier = Modifier.size(64.dp))
                    Text("Проблем не найдено!", color = AccentGreen, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                    Text("Код выглядит чистым", color = TextSecondary)
                }
            }
        } else {
            val filtered = diagnostics.items.filter {
                when (filter) {
                    "error" -> it.severity == "error"
                    "warning" -> it.severity == "warning"
                    else -> true
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(filtered) { item -> DiagnosticRow(item) }
            }
        }
    }
}

@Composable
private fun DiagnosticRow(item: DiagnosticItem) {
    val severityColor = when (item.severity) {
        "error" -> ErrorRed
        "warning" -> WarningYellow
        else -> InfoBlue
    }
    val severityIcon = when (item.severity) {
        "error" -> Icons.Default.Error
        "warning" -> Icons.Default.Warning
        else -> Icons.Default.Info
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Icon(
                severityIcon,
                contentDescription = null,
                tint = severityColor,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    item.message,
                    color = TextPrimary,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row {
                    Text(
                        item.file.split("\\").lastOrNull() ?: item.file,
                        color = AccentBlue,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "стр. ${item.line}:${item.column}",
                        color = TextSecondary,
                        fontSize = 11.sp
                    )
                }
                item.code?.let {
                    Text(
                        "Код: $it",
                        color = TextSecondary.copy(alpha = 0.7f),
                        fontSize = 11.sp
                    )
                }
            }
        }
    }
}
