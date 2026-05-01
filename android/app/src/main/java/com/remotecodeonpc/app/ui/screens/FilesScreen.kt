package com.remotecodeonpc.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.FileContent
import com.remotecodeonpc.app.FileTreeItem
import com.remotecodeonpc.app.FolderInfo
import com.remotecodeonpc.app.FoldersResponse
import com.remotecodeonpc.app.ui.theme.*

@Composable
fun FilesScreen(
    folders: FoldersResponse?,
    currentFiles: FileTreeItem?,
    fileContent: FileContent?,
    isLoading: Boolean,
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onGoUp: () -> Unit,
    onBack: () -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }

    // При получении дерева файлов переключаемся на вкладку "Файлы"
    LaunchedEffect(currentFiles) {
        if (currentFiles != null && selectedTab != 2) {
            selectedTab = 1
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
    ) {
        // Вкладки
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = DarkSurface,
            contentColor = AccentBlue
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = { Text("Проекты", color = if (selectedTab == 0) AccentBlue else TextSecondary) }
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = { Text("Файлы", color = if (selectedTab == 1) AccentBlue else TextSecondary) }
            )
            Tab(
                selected = selectedTab == 2,
                onClick = { selectedTab = 2 },
                text = { Text("Просмотр", color = if (selectedTab == 2) AccentBlue else TextSecondary) }
            )
        }

        when (selectedTab) {
            0 -> ProjectListTab(folders, onOpenFolder, onNavigateToDir)
            1 -> FileTreeTab(currentFiles, isLoading, onNavigateToDir, onOpenFile, onGoUp)
            2 -> FileViewerTab(fileContent, onBack)
        }
    }
}

@Composable
private fun ProjectListTab(
    folders: FoldersResponse?,
    onOpenFolder: (String) -> Unit,
    onNavigateToDir: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Открытые папки
        if (folders != null && folders.current.isNotEmpty()) {
            item {
                Text(
                    "Открытые папки",
                    color = AccentBlue,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
            items(folders.current) { folder ->
                FolderProjectCard(folder, isOpen = true) {
                    onOpenFolder(folder.path)
                    // Открываем дерево
                }
            }
        }

        // Недавние проекты
        if (folders != null && folders.recent.isNotEmpty()) {
            item {
                Text(
                    "Недавние проекты (Git)",
                    color = AccentGreen,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
            items(folders.recent) { folder ->
                FolderProjectCard(folder, isOpen = false) {
                    onOpenFolder(folder.path)
                }
            }
        }

        // Диски
        if (folders != null && folders.systemDrives.isNotEmpty()) {
            item {
                Text(
                    "Диски",
                    color = TextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
            }
            items(folders.systemDrives) { drive ->
                DriveCard(drive) {
                    onNavigateToDir(drive)
                }
            }
        }

        if (folders == null) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = AccentBlue, modifier = Modifier.size(32.dp))
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Загрузка...", color = TextSecondary)
                    }
                }
            }
        }
    }
}

@Composable
private fun FolderProjectCard(folder: FolderInfo, isOpen: Boolean, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (isOpen) AccentBlue.copy(alpha = 0.1f) else CardBg
        ),
        shape = RoundedCornerShape(10.dp)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = if (isOpen) AccentBlue else AccentOrange,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(folder.name, color = TextBright, fontWeight = FontWeight.Medium)
                Text(folder.path, color = TextSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = TextSecondary
            )
        }
    }
}

@Composable
private fun DriveCard(drive: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = CardBg),
        shape = RoundedCornerShape(10.dp)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Storage,
                contentDescription = null,
                tint = AccentOrange,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text("Диск $drive", color = TextBright, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun FileTreeTab(
    root: FileTreeItem?,
    isLoading: Boolean,
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onGoUp: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        // Путь
        if (root != null) {
            Surface(
                color = DarkSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onGoUp, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.ArrowUpward, contentDescription = "Наверх", tint = AccentBlue, modifier = Modifier.size(18.dp))
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        root.path,
                        color = TextSecondary,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        if (isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = AccentBlue)
            }
        } else if (root != null) {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                items(root.children ?: emptyList()) { item ->
                    FileTreeItemRow(item, onNavigateToDir, onOpenFile)
                }

                if (root.children.isNullOrEmpty()) {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("Папка пуста", color = TextSecondary.copy(alpha = 0.6f))
                        }
                    }
                }

                if (root.truncated) {
                    item {
                        Text(
                            "Показаны первые 50 элементов",
                            color = WarningYellow,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(8.dp)
                        )
                    }
                }
            }
        } else {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("Выберите папку для просмотра", color = TextSecondary)
            }
        }
    }
}

@Composable
private fun FileTreeItemRow(
    item: FileTreeItem,
    onNavigateToDir: (String) -> Unit,
    onOpenFile: (String) -> Unit
) {
    val icon = when {
        item.isDirectory -> Icons.Default.Folder
        item.extension in listOf(".ts", ".js", ".jsx", ".tsx") -> Icons.Default.Code
        item.extension in listOf(".py") -> Icons.Default.Code
        item.extension in listOf(".html", ".css") -> Icons.Default.Code
        item.extension in listOf(".json", ".xml", ".yaml", ".yml") -> Icons.Default.DataObject
        item.extension in listOf(".md") -> Icons.Default.Description
        item.extension in listOf(".kt", ".java") -> Icons.Default.Code
        else -> if (item.isDirectory) Icons.Default.Folder else Icons.AutoMirrored.Filled.InsertDriveFile
    }
    val iconColor = when {
        item.isDirectory -> AccentOrange
        item.extension in listOf(".kt", ".java", ".ts", ".tsx") -> AccentBlue
        item.extension in listOf(".py") -> AccentYellow
        item.extension in listOf(".js", ".jsx") -> WarningYellow
        item.extension in listOf(".html", ".css") -> AccentBlue
        else -> TextSecondary
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                if (item.isDirectory) {
                    onNavigateToDir(item.path)
                } else {
                    onOpenFile(item.path)
                }
            },
        color = DarkBackground,
        shape = RoundedCornerShape(6.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                item.name,
                color = TextPrimary,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            if (!item.isDirectory && item.size > 0) {
                Text(
                    formatFileSize(item.size),
                    color = TextSecondary.copy(alpha = 0.5f),
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
private fun FileViewerTab(
    file: FileContent?,
    onBack: () -> Unit
) {
    if (file == null) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    Icons.Default.Code,
                    contentDescription = null,
                    tint = TextSecondary.copy(alpha = 0.3f),
                    modifier = Modifier.size(48.dp)
                )
                Text("Выберите файл для просмотра", color = TextSecondary)
            }
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(color = DarkSurfaceVariant, modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.InsertDriveFile,
                    contentDescription = null,
                    tint = AccentBlue,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(file.path.split("\\").lastOrNull() ?: file.path, color = TextBright, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                Spacer(modifier = Modifier.weight(1f))
                Text(file.language, color = TextSecondary, fontSize = 11.sp)
            }
        }

        // Содержимое
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(8.dp)
                .background(CardBg, RoundedCornerShape(8.dp))
        ) {
            val lines = file.content.split("\n")
            items(lines.size) { index ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 1.dp)
                ) {
                    Text(
                        "${index + 1}",
                        color = TextSecondary.copy(alpha = 0.4f),
                        fontSize = 12.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        modifier = Modifier.width(36.dp)
                    )
                    Text(
                        lines[index],
                        color = TextPrimary,
                        fontSize = 12.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                    )
                }
            }
        }
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> "${bytes / (1024 * 1024)} MB"
    }
}
