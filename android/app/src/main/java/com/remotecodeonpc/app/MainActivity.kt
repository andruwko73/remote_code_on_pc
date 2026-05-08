package com.remotecodeonpc.app

import android.content.Intent
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.remotecodeonpc.app.network.KeeneticCloudDns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import kotlin.system.exitProcess
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private val publicUpdateUrl = "https://raw.githubusercontent.com/andruwko73/remote_code_on_pc/main/apk/app-debug.apk"
    private val publicUpdateSha256Url = "$publicUpdateUrl.sha256"
    private val crashPrefsName = "remote_code_crash_recovery"
    private val appPrefsName = "remote_code_prefs"
    private val apkMimeType = "application/vnd.android.package-archive"
    private val updateInstallRequestCode = 12078
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
            var pendingVerifiedApk by remember { mutableStateOf<PendingVerifiedApk?>(null) }
            var updateStatus by remember { mutableStateOf<String?>(null) }
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
                            onUpdateApp = { config ->
                                downloadAndInstallUpdate(
                                    config = config,
                                    onStatus = { updateStatus = it },
                                    onReady = { pendingVerifiedApk = it }
                                )
                            }
                        )
                        updateStatus?.let { status ->
                            UpdateStatusDialog(status = status)
                        }
                        pendingVerifiedApk?.let { update ->
                            UpdateReadyDialog(
                                update = update,
                                onInstall = {
                                    val apkFile = File(update.filePath)
                                    updateStatus = "Открываю системный установщик..."
                                    Handler(Looper.getMainLooper()).post {
                                        openVerifiedUpdateApk(
                                            apkFile = apkFile,
                                            onStatus = { updateStatus = it },
                                            onReadyDialogFinished = { pendingVerifiedApk = null },
                                            onInstallPermissionRequired = { pendingVerifiedApk = update }
                                        )
                                    }
                                },
                                onDismiss = { pendingVerifiedApk = null }
                            )
                        }
                    }
                }
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

    private fun downloadAndInstallUpdate(
        config: ServerConfig,
        onStatus: (String?) -> Unit,
        onReady: (PendingVerifiedApk) -> Unit
    ) {
        if (isUpdateInProgress) {
            Toast.makeText(this, "Обновление уже загружается...", Toast.LENGTH_SHORT).show()
            return
        }

        val updateUrls = buildUpdateUrls(config)
        if (updateUrls.isEmpty()) {
            Toast.makeText(this, "Сначала укажите адрес подключения", Toast.LENGTH_LONG).show()
            return
        }

        isUpdateInProgress = true
        onStatus("Скачивание обновления...")
        Toast.makeText(this, "Загружаю обновление...", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val client = OkHttpClient.Builder()
                    .dns(KeeneticCloudDns)
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(120, TimeUnit.SECONDS)
                    .build()
                var lastError: Exception? = null
                for (updateUrl in updateUrls) {
                    try {
                        CrashLogger.i("MainActivity", "Downloading update from $updateUrl")
                        runOnUiThread {
                            onStatus(if (updateUrl.startsWith(publicUpdateUrl)) "Скачивание APK из резервного источника..." else "Скачивание APK из подключенного расширения...")
                        }
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
                            if (apkFile.length() > 120L * 1024L * 1024L) {
                                throw IllegalStateException("Файл обновления слишком большой")
                            }
                            runOnUiThread { onStatus("Проверка APK и SHA-256...") }
                            val expectedSha256 = resolveExpectedUpdateSha256(client, updateUrl, response.headers["X-Remote-Code-Apk-Sha256"])
                                ?: throw IllegalStateException("Источник обновления не отдал SHA-256 для проверки APK")
                            runOnUiThread { onStatus("Проверка подписи APK...") }
                            val archiveInfo = validateDownloadedApk(apkFile, expectedSha256)
                            val archiveVersionCode = packageVersionCode(archiveInfo)
                            val archiveVersionName = archiveInfo.versionName?.takeIf { it.isNotBlank() }
                                ?: archiveVersionCode.toString()
                            runOnUiThread {
                                isUpdateInProgress = false
                                onStatus(null)
                                onReady(
                                    PendingVerifiedApk(
                                        filePath = apkFile.absolutePath,
                                        versionName = archiveVersionName,
                                        versionCode = archiveVersionCode,
                                        sizeBytes = apkFile.length(),
                                        sha256 = expectedSha256
                                    )
                                )
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
                    onStatus(null)
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

    private fun resolveExpectedUpdateSha256(client: OkHttpClient, updateUrl: String, headerValue: String?): String? {
        normalizeSha256(headerValue)?.let { return it }
        if (!updateUrl.startsWith(publicUpdateUrl)) return null
        val shaUrl = "$publicUpdateSha256Url?ts=${System.currentTimeMillis()}"
        val request = Request.Builder()
            .url(shaUrl)
            .header("Cache-Control", "no-cache")
            .build()
        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                normalizeSha256(response.body?.string())
            }
        }.getOrNull()
    }

    private fun validateDownloadedApk(apkFile: File, expectedSha256: String): PackageInfo {
        val actualSha256 = sha256Hex(apkFile)
        if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
            throw IllegalStateException("SHA-256 APK не совпал")
        }

        val archiveInfo = readPackageInfo(apkFile.absolutePath)
            ?: throw IllegalStateException("Скачанный APK не читается как Android package")
        if (archiveInfo.packageName != packageName) {
            throw IllegalStateException("APK предназначен для другого пакета: ${archiveInfo.packageName}")
        }
        val archiveVersion = packageVersionCode(archiveInfo)
        if (archiveVersion <= BuildConfig.VERSION_CODE) {
            throw IllegalStateException("APK не новее установленной версии")
        }

        val installedInfo = readInstalledPackageInfo()
            ?: throw IllegalStateException("Не удалось прочитать подпись установленного приложения")
        val installedSigners = signingCertificateDigests(installedInfo)
        val archiveSigners = signingCertificateDigests(archiveInfo)
        if (installedSigners.isNotEmpty() && archiveSigners.isNotEmpty() && installedSigners != archiveSigners) {
            throw IllegalStateException("Подпись APK не совпадает с установленным приложением")
        }
        return archiveInfo
    }

    @Suppress("DEPRECATION")
    private fun readPackageInfo(apkPath: String): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return packageManager.getPackageArchiveInfo(apkPath, flags)
    }

    @Suppress("DEPRECATION")
    private fun readInstalledPackageInfo(): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return packageManager.getPackageInfo(packageName, flags)
    }

    @Suppress("DEPRECATION")
    private fun packageVersionCode(info: PackageInfo): Long {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            info.versionCode.toLong()
        }
    }

    @Suppress("DEPRECATION")
    private fun signingCertificateDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        } ?: return emptySet()
        return signatures
            .map { signature -> sha256Hex(signature.toByteArray()) }
            .toSet()
    }

    private fun normalizeSha256(value: String?): String? {
        return Regex("""\b[a-fA-F0-9]{64}\b""")
            .find(value.orEmpty())
            ?.value
            ?.lowercase()
    }

    private fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun openVerifiedUpdateApk(
        apkFile: File,
        onStatus: (String?) -> Unit = {},
        onReadyDialogFinished: () -> Unit = {},
        onInstallPermissionRequired: () -> Unit = {}
    ) {
        if (!apkFile.exists() || apkFile.length() <= 0L) {
            onStatus(null)
            onReadyDialogFinished()
            Toast.makeText(this, "APK обновления не найден. Скачайте обновление заново.", Toast.LENGTH_LONG).show()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            onStatus(null)
            Toast.makeText(this, "Разрешите установку обновлений для Remote Code, затем нажмите «Установить» ещё раз.", Toast.LENGTH_LONG).show()
            val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:$packageName")
            }
            try {
                startActivity(settingsIntent)
                onInstallPermissionRequired()
            } catch (e: Exception) {
                CrashLogger.e("MainActivity", "Failed to open APK install permission settings", e)
                Toast.makeText(this, "Не удалось открыть настройки разрешения установки: ${e.message}", Toast.LENGTH_LONG).show()
            }
            return
        }
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, apkMimeType)
            putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            putExtra(Intent.EXTRA_RETURN_RESULT, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            grantApkUriReadPermissions(uri, intent)
            startActivityForResult(intent, updateInstallRequestCode)
            onStatus(null)
            onReadyDialogFinished()
        } catch (e: Exception) {
            CrashLogger.w("MainActivity", "Package installer did not accept view intent: ${e.message}")
            val installIntent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                data = uri
                putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
                putExtra(Intent.EXTRA_RETURN_RESULT, true)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try {
                grantApkUriReadPermissions(uri, installIntent)
                startActivityForResult(installIntent, updateInstallRequestCode)
                onStatus(null)
                onReadyDialogFinished()
                return
            } catch (installError: Exception) {
                CrashLogger.w("MainActivity", "Package installer did not accept install intent: ${installError.message}")
            }
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = apkMimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try {
                grantApkUriReadPermissions(uri, shareIntent)
                startActivity(Intent.createChooser(shareIntent, "Открыть APK обновления"))
                onStatus(null)
                onReadyDialogFinished()
            } catch (fallbackError: Exception) {
                onStatus(null)
                onReadyDialogFinished()
                CrashLogger.e("MainActivity", "Failed to open verified update APK", fallbackError)
                Toast.makeText(this, "Не удалось открыть системный установщик: ${fallbackError.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun grantApkUriReadPermissions(uri: Uri, intent: Intent) {
        packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .forEach { resolveInfo ->
                val packageName = resolveInfo.activityInfo?.packageName ?: return@forEach
                grantUriPermission(packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
    }
}

@Composable
private fun UpdateStatusDialog(status: String) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Обновление APK") },
        text = {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(30.dp),
                    color = AccentBlue,
                    strokeWidth = 3.dp
                )
                Text(status, textAlign = TextAlign.Center)
            }
        },
        confirmButton = {}
    )
}

@Composable
private fun UpdateReadyDialog(
    update: PendingVerifiedApk,
    onInstall: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("APK готов к установке") },
        text = {
            Text(
                "Версия ${update.versionName} проверена. Нажмите «Установить», затем подтвердите обновление в системном окне. Если Android попросит разрешение на установку, вернитесь сюда и нажмите «Установить» ещё раз."
            )
        },
        confirmButton = {
            Button(onClick = onInstall) {
                Text("Установить")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Позже")
            }
        }
    )
}

private data class PendingVerifiedApk(
    val filePath: String,
    val versionName: String,
    val versionCode: Long,
    val sizeBytes: Long,
    val sha256: String
)

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

