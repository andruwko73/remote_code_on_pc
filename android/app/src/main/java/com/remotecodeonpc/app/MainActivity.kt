package com.remotecodeonpc.app

import android.content.Intent
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodeonpc.app.ui.theme.AccentBlue
import com.remotecodeonpc.app.ui.theme.DarkBackground
import com.remotecodeonpc.app.ui.theme.ErrorRed
import com.remotecodeonpc.app.ui.theme.RemoteCodeTheme
import com.remotecodeonpc.app.ui.theme.TextBright
import com.remotecodeonpc.app.ui.theme.TextSecondary
import com.remotecodeonpc.app.network.ConnectionUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import kotlin.system.exitProcess
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private val publicUpdateUrl = "https://raw.githubusercontent.com/andruwko73/remote_code_on_pc/main/apk/app-debug.apk"
    private val crashPrefsName = "remote_code_crash_recovery"
    private val appPrefsName = "remote_code_prefs"
    private var pendingUpdateApk: File? = null
    private var pendingUpdateConfig: ServerConfig? = null
    private var waitingForInstallPermission = false
    private var isUpdateInProgress = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        CrashLogger.init(applicationContext)
        installCrashRecoveryHandler()
        sanitizeStateAfterUpgrade()
        CrashLogger.i("MainActivity", "App started, version=${BuildConfig.VERSION_NAME}")

        enableEdgeToEdge()
        val shouldShowRecovery = getSharedPreferences(crashPrefsName, Context.MODE_PRIVATE)
            .getBoolean("pending_crash", false)
        val lastCrash = getSharedPreferences(crashPrefsName, Context.MODE_PRIVATE)
            .getString("last_crash", "")
        setContent {
            var recoveryMode by remember { mutableStateOf(shouldShowRecovery) }
            RemoteCodeTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = DarkBackground
                ) {
                    if (recoveryMode) {
                        CrashRecoveryScreen(
                            versionName = BuildConfig.VERSION_NAME,
                            lastCrash = lastCrash.orEmpty(),
                            onOpenNormally = {
                                clearCrashRecoveryFlag()
                                recoveryMode = false
                            },
                            onResetAndOpen = {
                                resetLocalAppState()
                                clearCrashRecoveryFlag()
                                recoveryMode = false
                            },
                            onShareLogs = { shareLogs() }
                        )
                    } else {
                        RemoteCodeApp(
                            onShareLogs = { shareLogs() },
                            onClearLogs = { clearLogs() },
                            onUpdateApp = { config -> downloadAndInstallUpdate(config) }
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (
            waitingForInstallPermission &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls())
        ) {
            waitingForInstallPermission = false
            val apk = pendingUpdateApk?.takeIf { it.exists() && it.length() >= 1024 * 1024 }
            if (apk != null) {
                installApk(apk)
            } else {
                pendingUpdateConfig?.let { downloadAndInstallUpdate(it) }
            }
        }
    }

    private fun shareLogs() {
        try {
            val intent = CrashLogger.createShareIntent(this)
            startActivity(Intent.createChooser(intent, "Share logs"))
        } catch (e: Exception) {
            CrashLogger.e("MainActivity", "Failed to share logs: ${e.message}", e)
        }
    }

    private fun clearLogs() {
        CrashLogger.clear()
        Toast.makeText(this, "Logs cleared", Toast.LENGTH_SHORT).show()
    }

    private fun installCrashRecoveryHandler() {
        val defaultCrashHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                CrashLogger.e("UNCAUGHT", "Unhandled error in thread ${thread.name}", throwable)
                getSharedPreferences(crashPrefsName, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean("pending_crash", true)
                    .putLong("last_crash_time", System.currentTimeMillis())
                    .putString("last_crash", throwable.stackTraceToString().take(6000))
                    .apply()
            } catch (_: Exception) {
            }
            if (defaultCrashHandler != null) {
                defaultCrashHandler.uncaughtException(thread, throwable)
            } else {
                exitProcess(2)
            }
        }
    }

    private fun sanitizeStateAfterUpgrade() {
        val prefs = getSharedPreferences(appPrefsName, Context.MODE_PRIVATE)
        val lastVersion = runCatching { prefs.getInt("last_version_code", -1) }.getOrDefault(-1)
        if (lastVersion == BuildConfig.VERSION_CODE) return

        val host = safeStringPref(prefs, "host")
        val port = safeIntPref(prefs, "port", 8799).coerceIn(1, 65535)
        val authToken = safeStringPref(prefs, "authToken")
        val useTunnel = safeBooleanPref(prefs, "useTunnel", false)
        val tunnelUrl = safeStringPref(prefs, "tunnelUrl")

        prefs.edit()
            .clear()
            .putString("host", host)
            .putInt("port", port)
            .putString("authToken", authToken)
            .putBoolean("useTunnel", useTunnel)
            .putString("tunnelUrl", tunnelUrl)
            .putInt("last_version_code", BuildConfig.VERSION_CODE)
            .apply()

        cacheDir.listFiles()
            ?.filter { it.name.startsWith("remote-code-update-") && it.extension == "apk" }
            ?.forEach { it.delete() }
        CrashLogger.i("MainActivity", "Sanitized app state after upgrade: $lastVersion -> ${BuildConfig.VERSION_CODE}")
    }

    private fun safeStringPref(prefs: android.content.SharedPreferences, key: String): String {
        return runCatching { prefs.getString(key, "") ?: "" }
            .recoverCatching { prefs.all[key]?.toString().orEmpty() }
            .getOrDefault("")
    }

    private fun safeIntPref(prefs: android.content.SharedPreferences, key: String, defaultValue: Int): Int {
        return runCatching { prefs.getInt(key, defaultValue) }
            .recoverCatching { prefs.all[key]?.toString()?.toIntOrNull() ?: defaultValue }
            .getOrDefault(defaultValue)
    }

    private fun safeBooleanPref(prefs: android.content.SharedPreferences, key: String, defaultValue: Boolean): Boolean {
        return runCatching { prefs.getBoolean(key, defaultValue) }
            .recoverCatching { prefs.all[key]?.toString()?.toBooleanStrictOrNull() ?: defaultValue }
            .getOrDefault(defaultValue)
    }

    private fun clearCrashRecoveryFlag() {
        getSharedPreferences(crashPrefsName, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("pending_crash", false)
            .apply()
    }

    private fun resetLocalAppState() {
        getSharedPreferences(appPrefsName, Context.MODE_PRIVATE).edit().clear().apply()
        cacheDir.listFiles()
            ?.filter { it.name.startsWith("remote-code-update-") && it.extension == "apk" }
            ?.forEach { it.delete() }
        CrashLogger.i("MainActivity", "Local app state reset from recovery screen")
        Toast.makeText(this, "Local settings reset", Toast.LENGTH_SHORT).show()
    }

    private fun downloadAndInstallUpdate(config: ServerConfig) {
        if (isUpdateInProgress) {
            Toast.makeText(this, "Обновление уже загружается...", Toast.LENGTH_SHORT).show()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingUpdateConfig = config
            pendingUpdateApk = null
            waitingForInstallPermission = true
            Toast.makeText(this, "Разрешите установку из приложения и вернитесь сюда", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:$packageName")
            })
            return
        }

        val updateUrls = buildUpdateUrls(config)
        if (updateUrls.isEmpty()) {
            Toast.makeText(this, "Сначала укажите адрес подключения", Toast.LENGTH_LONG).show()
            return
        }

        isUpdateInProgress = true
        pendingUpdateConfig = config
        Toast.makeText(this, "Загружаю обновление...", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(120, TimeUnit.SECONDS)
                    .build()
                var lastError: Exception? = null
                for (updateUrl in updateUrls) {
                    try {
                        CrashLogger.i("MainActivity", "Downloading update from $updateUrl")
                        val request = Request.Builder()
                            .url(updateUrl)
                            .header("Cache-Control", "no-cache")
                            .apply {
                                if (config.authToken.isNotBlank() && !updateUrl.startsWith(publicUpdateUrl)) {
                                    header("Authorization", "Bearer ${config.authToken}")
                                }
                            }
                            .build()
                        client.newCall(request).execute().use { response ->
                            if (!response.isSuccessful) {
                                throw IllegalStateException("HTTP ${response.code}")
                            }
                            val body = response.body ?: throw IllegalStateException("Empty update body")
                            cacheDir.listFiles()
                                ?.filter { it.name.startsWith("remote-code-update-") && it.extension == "apk" }
                                ?.forEach { it.delete() }
                            val apkFile = File(cacheDir, "remote-code-update-${System.currentTimeMillis()}.apk")
                            if (apkFile.exists()) apkFile.delete()
                            apkFile.outputStream().use { output ->
                                body.byteStream().copyTo(output)
                                output.flush()
                            }
                            if (apkFile.length() < 1024 * 1024) {
                                throw IllegalStateException("Файл обновления слишком маленький")
                            }
                            pendingUpdateApk = apkFile
                            runOnUiThread {
                                isUpdateInProgress = false
                                installApk(apkFile)
                            }
                            return@Thread
                        }
                    } catch (e: Exception) {
                        lastError = e
                        CrashLogger.w("MainActivity", "Update source failed: $updateUrl -> ${e.message}")
                    }
                }
                throw lastError ?: IllegalStateException("Не удалось скачать обновление ни из одного источника")
            } catch (e: Exception) {
                CrashLogger.e("MainActivity", "Update failed", e)
                runOnUiThread {
                    isUpdateInProgress = false
                    Toast.makeText(this, "Обновление не удалось: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun buildUpdateUrls(config: ServerConfig): List<String> {
        val ts = System.currentTimeMillis()
        val urls = mutableListOf<String>()
        if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            urls += "${ConnectionUrl.httpBase(config).trimEnd('/')}/api/app/apk?ts=$ts"
        }
        if (config.tunnelUrl.isNotBlank()) {
            urls += "${ConnectionUrl.httpBase(config.copy(useTunnel = true)).trimEnd('/')}/api/app/apk?ts=$ts"
        }
        if (config.host.isNotBlank()) {
            urls += "${ConnectionUrl.httpBase(config.copy(useTunnel = false)).trimEnd('/')}/api/app/apk?ts=$ts"
        }
        urls += "$publicUpdateUrl?ts=$ts"
        return urls.distinct()
    }

    private fun installApk(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingUpdateApk = apkFile
            waitingForInstallPermission = true
            isUpdateInProgress = false
            Toast.makeText(this, "Разрешите установку из приложения и вернитесь сюда", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:$packageName")
            })
            return
        }

        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }
}

@Composable
private fun CrashRecoveryScreen(
    versionName: String,
    lastCrash: String,
    onOpenNormally: () -> Unit,
    onResetAndOpen: () -> Unit,
    onShareLogs: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.BugReport,
            contentDescription = null,
            tint = ErrorRed,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        Text(
            "Remote Code восстановлен после сбоя",
            color = TextBright,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "APK $versionName запустился в безопасном режиме. Можно открыть приложение обычно или сбросить локальные настройки подключения.",
            color = TextSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center
        )
        if (lastCrash.isNotBlank()) {
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                lastCrash.lineSequence().firstOrNull().orEmpty(),
                color = TextSecondary.copy(alpha = 0.75f),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                maxLines = 2
            )
        }
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onOpenNormally,
            colors = ButtonDefaults.buttonColors(containerColor = AccentBlue),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.PlayArrow, contentDescription = null)
            Spacer(modifier = Modifier.size(8.dp))
            Text("Открыть приложение")
        }
        Spacer(modifier = Modifier.height(10.dp))
        OutlinedButton(onClick = onResetAndOpen, shape = RoundedCornerShape(12.dp)) {
            Icon(Icons.Default.Delete, contentDescription = null)
            Spacer(modifier = Modifier.size(8.dp))
            Text("Сбросить настройки и открыть")
        }
        Spacer(modifier = Modifier.height(10.dp))
        OutlinedButton(onClick = onShareLogs, shape = RoundedCornerShape(12.dp)) {
            Icon(Icons.Default.Share, contentDescription = null)
            Spacer(modifier = Modifier.size(8.dp))
            Text("Отправить логи")
        }
    }
}
