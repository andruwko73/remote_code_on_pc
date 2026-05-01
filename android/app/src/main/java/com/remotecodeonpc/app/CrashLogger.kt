package com.remotecodeonpc.app

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Простой файловый логгер.
 * Пишет все логи в файл app_logs.txt во внутреннем хранилище.
 * Потом можно открыть/отправить из UI кнопкой "Отправить логи".
 */
object CrashLogger {
    private const val TAG = "CrashLogger"
    private const val MAX_LOG_SIZE = 512 * 1024 // 512KB
    private var logDir: File? = null
    private var enabled = false

    fun init(context: Context) {
        logDir = File(context.filesDir, "logs")
        logDir?.mkdirs()
        enabled = true
        i(TAG, "CrashLogger initialized: ${logDir?.absolutePath}")
    }

    fun getLogFile(): File? {
        val dir = logDir ?: return null
        val file = File(dir, "app_logs.txt")
        if (!file.exists()) return null
        return file
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
        // Дополнительно печатаем stacktrace в файл
        if (tr != null) {
            writeToFile("E", tag, getStackTraceString(tr))
        }
    }

    /** Записать exception напрямую */
    fun logException(tag: String, tr: Throwable) {
        Log.e(tag, "Exception: ${tr.message}", tr)
        writeToFile("E", tag, "${tr::class.simpleName}: ${tr.message}")
        writeToFile("E", tag, getStackTraceString(tr))
    }

    /** Очистить лог-файл */
    fun clear() {
        val file = getLogFile() ?: return
        file.delete()
        i(TAG, "Log file cleared")
    }

    /** Получить содержимое логов */
    fun getLogContent(): String {
        val file = getLogFile() ?: return "Логов нет"
        return try {
            file.readText()
        } catch (e: Exception) {
            "Ошибка чтения логов: ${e.message}"
        }
    }

    /** Создать intent для отправки логов */
    fun createShareIntent(context: Context): Intent {
        // Сохраняем актуальный снимок
        val snapshotFile = File(context.cacheDir, "crash_log_snapshot.txt")
        try {
            snapshotFile.writeText(getLogContent())
        } catch (e: Exception) {
            snapshotFile.writeText("Ошибка создания снимка: ${e.message}")
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
            putExtra(Intent.EXTRA_TEXT, "Логи RemoteCode на PC\n\nВерсия: 1.0.0\n\n")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    // ===== PRIVATE =====

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    private fun writeToFile(level: String, tag: String, message: String) {
        if (!enabled) return
        val dir = logDir ?: return
        val file = File(dir, "app_logs.txt")
        try {
            // Ротация при превышении размера
            if (file.exists() && file.length() > MAX_LOG_SIZE) {
                val old = File(dir, "app_logs_old.txt")
                file.renameTo(old)
            }
            val timestamp = dateFormat.format(Date())
            file.appendText("[$timestamp] [$level] [$tag] $message\n")
        } catch (e: Exception) {
            // Игнорируем ошибки записи — не хотим циклических ошибок
        }
    }

    private fun getStackTraceString(tr: Throwable): String {
        val sw = java.io.StringWriter()
        val pw = java.io.PrintWriter(sw)
        tr.printStackTrace(pw)
        pw.flush()
        return sw.toString()
    }
}
