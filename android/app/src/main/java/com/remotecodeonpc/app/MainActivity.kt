package com.remotecodeonpc.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.remotecodeonpc.app.ui.theme.DarkBackground
import com.remotecodeonpc.app.ui.theme.RemoteCodeTheme
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private val publicUpdateUrl = "https://raw.githubusercontent.com/andruwko73/remote_code_on_pc/main/apk/app-debug.apk"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        CrashLogger.init(applicationContext)
        CrashLogger.i("MainActivity", "App started, version=1.0.2")

        val defaultCrashHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            CrashLogger.e("UNCAUGHT", "Unhandled error in thread ${thread.name}", throwable)
            defaultCrashHandler?.uncaughtException(thread, throwable)
        }

        enableEdgeToEdge()
        setContent {
            RemoteCodeTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = DarkBackground
                ) {
                    RemoteCodeApp(
                        onShareLogs = { shareLogs() },
                        onUpdateApp = { config -> downloadAndInstallUpdate(config) }
                    )
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

    private fun downloadAndInstallUpdate(config: ServerConfig) {
        val updateUrl = buildUpdateUrl(config)
        if (updateUrl == null) {
            Toast.makeText(this, "Enter PC IP first", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "Downloading update...", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val client = OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(120, TimeUnit.SECONDS)
                    .build()
                val request = Request.Builder()
                    .url(updateUrl)
                    .header("Cache-Control", "no-cache")
                    .apply {
                        if (config.authToken.isNotBlank() && updateUrl != publicUpdateUrl) {
                            header("Authorization", "Bearer ${config.authToken}")
                        }
                    }
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IllegalStateException("HTTP ${response.code}")
                    }
                    val body = response.body ?: throw IllegalStateException("Empty update body")
                    val apkFile = File(cacheDir, "remote-code-update.apk")
                    apkFile.outputStream().use { output ->
                        body.byteStream().copyTo(output)
                    }
                    if (apkFile.length() < 1024 * 1024) {
                        throw IllegalStateException("Downloaded file is too small")
                    }
                    runOnUiThread { installApk(apkFile) }
                }
            } catch (e: Exception) {
                CrashLogger.e("MainActivity", "Update failed", e)
                runOnUiThread {
                    Toast.makeText(this, "Update failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun buildUpdateUrl(config: ServerConfig): String? {
        if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            return "${config.tunnelUrl.trimEnd('/')}/api/app/apk"
        }
        if (config.host.isNotBlank()) {
            return "http://${config.host}:${config.port}/api/app/apk"
        }
        return null
    }

    private fun installApk(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            Toast.makeText(this, "Allow installs from this app, then press update again", Toast.LENGTH_LONG).show()
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
