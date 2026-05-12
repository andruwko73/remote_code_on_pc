package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.ServerConfig
import java.net.URI
import java.util.Locale

object ConnectionUrl {
    fun httpBase(config: ServerConfig): String {
        val raw = if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            config.tunnelUrl
        } else {
            "http://${config.host}:${config.port}"
        }
        val normalized = normalizeHttpBase(raw)
        if (normalized.isBlank()) return normalized
        if (config.useTunnel && !hasExplicitScheme(raw) && looksLikePublicHost(raw) && !looksLikePrivateHost(hostFromBase(normalized))) {
            return toScheme(normalized, "https")
        }
        return normalized
    }

    fun wsBase(config: ServerConfig): String {
        return httpBase(config)
            .replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "ws://")
            .replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "wss://")
    }

    fun isUnsafePublicHttp(config: ServerConfig): Boolean {
        if (!config.useTunnel || config.tunnelUrl.isBlank()) return false
        return isUnsafePublicHttpUrl(config.tunnelUrl)
    }

    fun isUnsafePublicHttpUrl(raw: String): Boolean {
        val normalized = normalizeHttpBase(raw)
        if (!normalized.startsWith("http://", ignoreCase = true)) return false
        return looksLikePublicHost(hostFromBase(normalized))
    }

    private fun normalizeHttpBase(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isBlank()) return trimmed
        val withScheme = when {
            trimmed.startsWith("http://", ignoreCase = true) ||
                trimmed.startsWith("https://", ignoreCase = true) -> trimmed
            trimmed.startsWith("//") -> "http:$trimmed"
            else -> {
                "http://$trimmed"
            }
        }
        return parseRootUrl(withScheme)
    }

    private fun parseRootUrl(value: String): String {
        return runCatching {
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase(Locale.getDefault()) ?: "http"
            val host = uri.host
            val port = uri.port
            when {
                host != null && host.isNotBlank() -> if (port == -1) "$scheme://$host" else "$scheme://$host:$port"
                uri.authority.isNullOrBlank() -> {
                    val fallback = value.substringAfter("://", value).trim().split('?', '#')[0].split('/')[0]
                    if (fallback.isBlank()) value else "$scheme://$fallback"
                }
                else -> {
                    "$scheme://${uri.authority.split('@').last()}"
                }
            }
        }.getOrElse {
            val trimmed = value.trim().trimEnd('/')
            when {
                trimmed.isBlank() -> trimmed
                trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true) -> trimmed
                else -> "http://$trimmed"
            }
        }.trimEnd('/')
    }

    private fun toScheme(value: String, scheme: String): String {
        return when {
            value.startsWith("http://", ignoreCase = true) ->
                value.replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "${scheme}://")
            value.startsWith("https://", ignoreCase = true) ->
                value.replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "${scheme}://")
            else -> "$scheme://${value.trimStart('/')}"
        }
    }

    private fun stripPort(value: String): String {
        return value
            .split(':')
            .firstOrNull()
            ?.trim()
            ?.trimStart('[')
            ?.trimEnd(']')
            ?: value
    }

    private fun hostFromBase(value: String): String {
        return runCatching {
            URI(value).host
        }.getOrNull()
            ?.trim()
            ?.trimStart('[')
            ?.trimEnd(']')
            ?: value.substringAfter("://", value).split('?', '#', '/').firstOrNull().orEmpty().let(::stripPort)
    }

    private fun hasExplicitScheme(value: String): Boolean {
        return value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true)
    }

    private fun looksLikePublicHost(value: String): Boolean {
        val normalized = value.trim().lowercase(Locale.getDefault())
        if (normalized.isBlank()) return false
        if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
            return !looksLikePrivateHost(stripPort(normalized.substringAfter("://", "")))
        }
        if (!normalized.contains('.')) return false
        return !looksLikePrivateHost(stripPort(normalized))
    }

    private fun looksLikePrivateHost(value: String): Boolean {
        val host = stripPort(value.trim().lowercase(Locale.getDefault()))
        if (host.isBlank()) return true
        if (host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1") return true
        if (host.startsWith("10.") || host.startsWith("192.168.")) return true
        if (host.startsWith("172.")) {
            val parts = host.split('.')
            val second = parts.getOrNull(1)?.toIntOrNull()
            if (second != null && second in 16..31) return true
        }
        return false
    }
}
