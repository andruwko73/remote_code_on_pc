package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.ServerConfig

object ConnectionUrl {
    fun httpBase(config: ServerConfig): String {
        val raw = if (config.useTunnel && config.tunnelUrl.isNotBlank()) {
            config.tunnelUrl
        } else {
            "http://${config.host}:${config.port}"
        }
        return normalizeHttpBase(raw)
    }

    fun wsBase(config: ServerConfig): String {
        return httpBase(config)
            .replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "ws://")
            .replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "wss://")
    }

    private fun normalizeHttpBase(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isBlank()) return trimmed
        return if (trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true)) {
            trimmed
        } else {
            "http://$trimmed"
        }
    }
}
