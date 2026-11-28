package com.awu05.streambert

import java.net.URI

object ServerAddress {
    private val hasScheme = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

    fun normalize(input: String): Result<String> = runCatching {
        val address = input.trim()
        require(address.isNotEmpty()) { "Enter your server address" }
        val candidate = if (hasScheme.containsMatchIn(address)) address else "http://$address"
        val scheme = candidate.substringBefore("://").lowercase()
        require(scheme == "http" || scheme == "https") { "Use an http:// or https:// address" }

        val uri = parseOrigin(candidate)
        require(uri != null && uri.userInfo == null) { "That isn't a valid address" }
        val default = defaultPort(scheme)
        val port = if (uri.port == -1 || uri.port == default) "" else ":${uri.port}"
        "$scheme://${uri.host.lowercase()}$port"
    }

    fun sameOrigin(url: String, origin: String): Boolean {
        val page = parseOrigin(url) ?: return false
        val server = parseOrigin(origin) ?: return false
        return page.scheme.equals(server.scheme, ignoreCase = true) &&
            page.host.equals(server.host, ignoreCase = true) &&
            effectivePort(page) == effectivePort(server)
    }

    private fun parseOrigin(value: String): URI? {
        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()
        return uri.takeIf {
            (scheme == "http" || scheme == "https") && it.host != null &&
                (it.port == -1 || it.port in 1..65535)
        }
    }

    private fun effectivePort(uri: URI): Int =
        if (uri.port == -1) defaultPort(uri.scheme.lowercase()) else uri.port

    private fun defaultPort(scheme: String): Int = if (scheme == "https") 443 else 80
}
