package com.remotecodeonpc.app

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object CrashLogger {
    private const val TAG = "CrashLogger"
    private const val MAX_LOG_SIZE = 256 * 1024
    private const val MAX_OLD_LOG_SIZE = 256 * 1024
    private const val MAX_SHARE_SIZE = 256 * 1024
    private const val MAX_ENTRY_CHARS = 8 * 1024

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    private var logDir: File? = null
    private var enabled = false

    fun init(context: Context) {
        logDir = File(context.filesDir, "logs").apply { mkdirs() }
        trimExistingLogs()
        enabled = true
        i(TAG, "CrashLogger initialized: ${logDir?.absolutePath}")
    }

    fun getLogFile(): File? {
        val file = File(logDir ?: return null, "app_logs.txt")
        return if (file.exists()) file else null
    }

    fun d(tag: String, message: String) {
        Log.d(tag, message)
        writeToFile("D", tag, message)
    }

    fun i(tag: String, message: String) {
        Log.i(tag, message)
        writeToFile("I", tag, message)
    }

    fun w(tag: String, message: String) {
        Log.w(tag, message)
        writeToFile("W", tag, message)
    }

    fun e(tag: String, message: String, tr: Throwable? = null) {
        Log.e(tag, message, tr)
        writeToFile("E", tag, "$message${if (tr != null) " | ${tr::class.simpleName}: ${tr.message}" else ""}")
        if (tr != null) {
            writeToFile("E", tag, stackTrace(tr))
        }
    }

    fun logException(tag: String, tr: Throwable) {
        Log.e(tag, "Exception: ${tr.message}", tr)
        writeToFile("E", tag, "${tr::class.simpleName}: ${tr.message}")
        writeToFile("E", tag, stackTrace(tr))
    }

    fun clear() {
        val dir = logDir ?: return
        File(dir, "app_logs.txt").delete()
        File(dir, "app_logs_old.txt").delete()
        i(TAG, "Log files cleared")
    }

    fun getLogContent(): String {
        val file = getLogFile() ?: return "No logs"
        return try {
            file.readText().takeLast(MAX_SHARE_SIZE)
        } catch (e: Exception) {
            "Failed to read logs: ${e.message}"
        }
    }

    fun createShareIntent(context: Context): Intent {
        val snapshotFile = File(context.cacheDir, "crash_log_snapshot.txt")
        try {
            snapshotFile.writeText(getLogContent())
        } catch (e: Exception) {
            snapshotFile.writeText("Failed to create log snapshot: ${e.message}")
        }

        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            snapshotFile
        )
        return Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "RemoteCode Logs")
            putExtra(Intent.EXTRA_TEXT, "RemoteCode logs\n")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun writeToFile(level: String, tag: String, message: String) {
        if (!enabled) return
        val dir = logDir ?: return
        val file = File(dir, "app_logs.txt")
        try {
            if (file.exists() && file.length() > MAX_LOG_SIZE) {
                rotate(file, File(dir, "app_logs_old.txt"))
            }
            val timestamp = dateFormat.format(Date())
            val safeMessage = if (message.length > MAX_ENTRY_CHARS) {
                message.take(MAX_ENTRY_CHARS) + "\n... truncated ..."
            } else {
                message
            }
            file.appendText("[$timestamp] [$level] [$tag] $safeMessage\n")
        } catch (_: Exception) {
        }
    }

    private fun trimExistingLogs() {
        val dir = logDir ?: return
        val current = File(dir, "app_logs.txt")
        val old = File(dir, "app_logs_old.txt")
        if (old.exists() && old.length() > MAX_OLD_LOG_SIZE) old.delete()
        if (current.exists() && current.length() > MAX_LOG_SIZE) rotate(current, old)
    }

    private fun rotate(current: File, old: File) {
        if (old.exists()) old.delete()
        current.renameTo(old)
    }

    private fun stackTrace(tr: Throwable): String {
        val sw = java.io.StringWriter()
        val pw = java.io.PrintWriter(sw)
        tr.printStackTrace(pw)
        pw.flush()
        return sw.toString().take(MAX_ENTRY_CHARS)
    }
}
