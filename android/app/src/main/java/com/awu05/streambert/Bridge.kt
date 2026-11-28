package com.awu05.streambert

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import org.json.JSONObject

class Bridge(private val activity: MainActivity, private val origin: String) {
    fun install(webView: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, "StreambertAndroid", setOf(origin)) {
                view, message, sourceOrigin, isMainFrame, proxy ->
            if (!isMainFrame || !ServerAddress.sameOrigin(sourceOrigin.toString(), origin)) {
                return@addWebMessageListener
            }
            val currentUrl = view.url
            if (currentUrl == null || !ServerAddress.sameOrigin(currentUrl, origin)) {
                return@addWebMessageListener
            }
            if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            val request = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull()
                ?: return@addWebMessageListener
            val id = request.optInt("id", -1)
            if (id < 1) return@addWebMessageListener
            fun reply(body: JSONObject) {
                runCatching { proxy.postMessage(body.put("id", id).toString()) }
            }
            when (request.optString("type")) {
                "getInfo" -> reply(JSONObject()
                    .put("type", "info")
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("server", origin))
                "changeServer" -> {
                    reply(JSONObject().put("type", "ok"))
                    activity.changeServer()
                }
                "checkUpdates" -> activity.checkForUpdates(::reply)
            }
        }
    }
}
