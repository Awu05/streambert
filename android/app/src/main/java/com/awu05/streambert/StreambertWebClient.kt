package com.awu05.streambert

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import java.net.URISyntaxException

class StreambertWebClient(
    private val activity: MainActivity,
    private val origin: String,
) : WebViewClient() {
    private var loadingUrl: String? = null

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        request.isForMainFrame && openOutside(LinkRouter.route(request.url.toString(), origin))

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        val target = LinkRouter.route(url, origin)
        if (target != LinkTarget.InApp) {
            view.stopLoading()
            openOutside(target)
            return
        }
        loadingUrl = url
    }

    override fun onPageFinished(view: WebView, url: String) {
        if (loadingUrl == url) loadingUrl = null
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (isServerPage(request)) activity.showServerError()
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (isServerPage(request)) activity.showServerError()
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        if (loadingUrl?.substringBefore('#') == error.url.substringBefore('#')) {
            activity.showServerError(R.string.certificate_untrusted)
        }
    }

    private fun isServerPage(request: WebResourceRequest): Boolean =
        request.isForMainFrame && ServerAddress.sameOrigin(request.url.toString(), origin)

    private fun openOutside(target: LinkTarget): Boolean {
        when (target) {
            LinkTarget.InApp -> return false
            is LinkTarget.AndroidIntent -> launchIntentLink(target.uri)
            is LinkTarget.External -> {
                if (!launchView(Uri.parse(target.uri))) toast(R.string.no_link_app)
            }
        }
        return true
    }

    private fun launchIntentLink(uri: String) {
        val parsed = try {
            Intent.parseUri(uri, Intent.URI_INTENT_SCHEME)
        } catch (_: URISyntaxException) {
            toast(R.string.no_player)
            return
        }
        if (launchView(parsed.data, parsed.type, parsed.`package`)) return
        val fallback = parsed.getStringExtra("browser_fallback_url")?.let(Uri::parse)
        if (fallback?.scheme in listOf("http", "https") && launchView(fallback)) return
        toast(R.string.no_player)
    }

    private fun launchView(uri: Uri?, mimeType: String? = null, packageName: String? = null): Boolean {
        val scheme = uri?.scheme?.lowercase() ?: return false
        if (scheme in LOCAL_SCHEMES) return false
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mimeType)
            .setPackage(packageName)
            .addCategory(Intent.CATEGORY_BROWSABLE)
        return try {
            activity.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }

    private fun toast(message: Int) {
        Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        val LOCAL_SCHEMES = setOf("file", "content", "android.resource", "intent")
    }
}
