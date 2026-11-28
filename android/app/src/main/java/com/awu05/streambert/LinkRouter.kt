package com.awu05.streambert

sealed interface LinkTarget {
    data object InApp : LinkTarget
    data class AndroidIntent(val uri: String) : LinkTarget
    data class External(val uri: String) : LinkTarget
}

object LinkRouter {
    fun route(url: String, serverOrigin: String): LinkTarget =
        when (url.substringBefore(':').lowercase()) {
            "http", "https" -> if (ServerAddress.sameOrigin(url, serverOrigin)) {
                LinkTarget.InApp
            } else {
                LinkTarget.External(url)
            }
            "intent" -> LinkTarget.AndroidIntent(url)
            "about", "blob", "data", "javascript" -> LinkTarget.InApp
            else -> LinkTarget.External(url)
        }
}
