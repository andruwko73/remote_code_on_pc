package com.remotecodeonpc.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(
    val route: String,
    val title: String,
    val icon: ImageVector
) {
    data object Dashboard : Screen("dashboard", "Дашборд", Icons.Default.Dashboard)
    data object Chat : Screen("chat", "Чат", Icons.Default.Chat)
    data object Files : Screen("files", "Файлы", Icons.Default.Folder)
    data object Diagnostics : Screen("diagnostics", "Ошибки", Icons.Default.BugReport)
    data object Settings : Screen("settings", "Настройки", Icons.Default.Settings)
    data object Terminal : Screen("terminal", "Терминал", Icons.Default.Terminal)

    companion object {
        val items = listOf(Dashboard, Chat, Files, Diagnostics, Settings)
        val all = listOf(Dashboard, Chat, Files, Diagnostics, Settings, Terminal)
    }
}
