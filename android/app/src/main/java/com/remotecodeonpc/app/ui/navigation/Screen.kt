package com.remotecodeonpc.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(
    val route: String,
    val title: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector
) {
    data object Codex : Screen("codex", "Codex", Icons.Outlined.SmartToy, Icons.Filled.SmartToy)
    data object Diagnostics : Screen("diagnostics", "Ошибки", Icons.Outlined.BugReport, Icons.Filled.BugReport)
    data object Settings : Screen("settings", "Настройки", Icons.Outlined.Settings, Icons.Filled.Settings)
    data object Files : Screen("files", "Файлы", Icons.Outlined.Folder, Icons.Filled.Folder)
    data object Terminal : Screen("terminal", "Терминал", Icons.Outlined.Terminal, Icons.Filled.Terminal)

    companion object {
        val items = listOf(Codex, Diagnostics, Settings)
        val all = listOf(Codex, Files, Diagnostics, Settings, Terminal)
    }
}
