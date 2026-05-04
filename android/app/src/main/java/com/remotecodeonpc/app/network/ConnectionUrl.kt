package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.ServerConfig

object ConnectionUrl {
    fun httpBase(config: ServerConfig): String {
        val raw = if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            config.tunnelUrl
        } else {
            "http://${config.host}:${config.port}"
        }
        return normalizeHttpBase(raw, config)
    }

    fun wsBase(config: ServerConfig): String {
        return httpBase(config)
            .replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "ws://")
            .replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "wss://")
    }

    private fun normalizeHttpBase(raw: String, config: ServerConfig): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isBlank()) return trimmed
        val withScheme = when {
            trimmed.startsWith("http://", ignoreCase = true) ||
                trimmed.startsWith("https://", ignoreCase = true) -> trimmed
            trimmed.startsWith("//") -> "http:$trimmed"
            else -> "http://$trimmed"
        }
        return if (config.useTunnel) withKeeneticPort(withScheme, config.port) else withScheme
    }

    private fun withKeeneticPort(raw: String, port: Int): String {
        return try {
            val uri = java.net.URI(raw)
            val host = uri.host?.lowercase() ?: return raw
            val hasExplicitPort = uri.port > 0
            val looksLikeKeenetic = host.contains(".keenetic.") ||
                host.endsWith(".netcraze.io") ||
                host.contains(".netcraze.")
            if (hasExplicitPort || !looksLikeKeenetic) return raw
            val path = uri.rawPath?.takeIf { it.isNotBlank() } ?: ""
            val query = uri.rawQuery?.let { "?$it" } ?: ""
            val fragment = uri.rawFragment?.let { "#$it" } ?: ""
            "${uri.scheme ?: "http"}://${uri.host}:$port$path$query$fragment"
        } catch (_: Exception) {
            raw
        }
    }
}
