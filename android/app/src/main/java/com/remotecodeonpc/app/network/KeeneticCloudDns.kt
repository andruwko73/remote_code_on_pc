package com.remotecodeonpc.app.network

import com.remotecodeonpc.app.CrashLogger
import okhttp3.Dns
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.Locale

object KeeneticCloudDns : Dns {
    const val CLOUD_PROXY_IP = "78.47.125.180"

    override fun lookup(hostname: String): List<InetAddress> {
        val systemError = runCatching { Dns.SYSTEM.lookup(hostname) }
            .onSuccess { addresses ->
                if (addresses.isNotEmpty()) return addresses
            }
            .exceptionOrNull()

        if (!supportsFallback(hostname)) {
            throw systemError as? UnknownHostException
                ?: UnknownHostException(hostname)
        }

        val fallback = runCatching {
            listOf(InetAddress.getByName(CLOUD_PROXY_IP))
        }.getOrDefault(emptyList())

        if (fallback.isNotEmpty()) {
            CrashLogger.w("KeeneticDns", "System DNS failed for $hostname; using Keenetic cloud proxy fallback")
            return fallback
        }

        throw systemError as? UnknownHostException
            ?: UnknownHostException(hostname)
    }

    private fun supportsFallback(hostname: String): Boolean {
        val host = hostname.trim().trimEnd('.').lowercase(Locale.US)
        return host.endsWith(".netcraze.pro") ||
            host.endsWith(".keenetic.link") ||
            host.endsWith(".keenetic.name") ||
            host.endsWith(".keenetic.pro") ||
            host.endsWith(".keenetic.io") ||
            host.endsWith(".keenetic.net")
    }
}
