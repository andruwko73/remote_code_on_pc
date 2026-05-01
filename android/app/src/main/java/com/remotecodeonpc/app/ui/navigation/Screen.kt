package com.remotecodeonpc.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(
    val route: String,
    val title: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector
) {
    // Основные экраны (нижнее меню)
    data object VSCode : Screen("vscode", "VS Code", Icons.Outlined.DesktopWindows, Icons.Filled.DesktopWindows)
    data object Codex : Screen("codex", "Codex", Icons.Outlined.SmartToy, Icons.Filled.SmartToy)
    data object Diagnostics : Screen("diagnostics", "Ошибки", Icons.Outlined.BugReport, Icons.Filled.BugReport)
    data object Settings : Screen("settings", "Настройки", Icons.Outlined.Settings, Icons.Filled.Settings)

    // Внутренние экраны (не в нижнем меню)
    data object Chat : Screen("chat", "Чат", Icons.Outlined.Chat, Icons.Filled.Chat)
    data object Files : Screen("files", "Файлы", Icons.Outlined.Folder, Icons.Filled.Folder)
    data object Terminal : Screen("terminal", "Терминал", Icons.Outlined.Terminal, Icons.Filled.Terminal)

    companion object {
        val items = listOf(VSCode, Codex, Diagnostics, Settings)
        val all = listOf(VSCode, Chat, Files, Codex, Diagnostics, Settings, Terminal)
    }
}
