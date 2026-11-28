package com.awu05.streambert

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.AttributeSet
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import com.awu05.streambert.update.UpdateController
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private lateinit var updates: UpdateController
    private lateinit var webSurface: FrameLayout
    private lateinit var fullscreenSurface: FullscreenSurface
    private lateinit var serverError: View
    private var origin: String? = null
    private var webView: WebView? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenBackCallback: OnBackInvokedCallback? = null
    private var backPending = false
    private var exitDialog: AlertDialog? = null
    private var setupOpen = false
    val canShowUpdate: Boolean get() = origin != null && !setupOpen && exitDialog?.isShowing != true
    private val setup = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        setupOpen = false
        if (result.resultCode == RESULT_OK) {
            prefs.serverOrigin?.let(::openServer)
        } else if (origin == null) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        updates = UpdateController(this, prefs)
        setupOpen = savedInstanceState?.getBoolean("setupOpen") == true
        setContentView(R.layout.activity_main)
        webSurface = findViewById(R.id.web_surface)
        fullscreenSurface = findViewById(R.id.fullscreen_surface)
        fullscreenSurface.onBack = ::handleBack
        serverError = findViewById(R.id.server_error)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        findViewById<View>(R.id.retry).setOnClickListener { origin?.let(::openServer) }
        findViewById<View>(R.id.change_server).setOnClickListener { changeServer() }
        onBackPressedDispatcher.addCallback(this) { handleBack() }
        prefs.serverOrigin?.let(::openServer) ?: changeServer()
        updates.onAppStart()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("setupOpen", setupOpen)
        super.onSaveInstanceState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            WindowCompat.getInsetsController(window, window.decorView).apply {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            }
            if (::updates.isInitialized) updates.onWindowAvailable()
        }
    }

    private fun openServer(server: String) {
        disposeWebView()
        origin = server
        backPending = false
        serverError.isVisible = false
        webSurface.isVisible = true
        val page = WebView(this)
        webView = page
        webSurface.addView(page, FrameLayout.LayoutParams(-1, -1))
        page.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(page, true)
        }
        page.webViewClient = StreambertWebClient(this, server)
        page.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customViewCallback != null || serverError.isVisible) {
                    callback.onCustomViewHidden()
                    return
                }
                customViewCallback = callback
                fullscreenSurface.addView(view, FrameLayout.LayoutParams(-1, -1))
                fullscreenSurface.isVisible = true
                webSurface.isVisible = false
                view.requestFocus()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val back = OnBackInvokedCallback(::handleBack)
                    fullscreenBackCallback = back
                    onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, back)
                }
            }

            override fun onHideCustomView() = hideFullscreen()
        }
        Bridge(this, server).install(page)
        page.loadUrl(server)
        page.requestFocus()
    }

    fun changeServer() {
        if (setupOpen || isFinishing || isDestroyed) return
        setupOpen = true
        setup.launch(Intent(this, SetupActivity::class.java))
    }

    fun showServerError(message: Int? = null) {
        if (serverError.isVisible && message == null) return
        hideFullscreen()
        webSurface.isVisible = false
        serverError.isVisible = true
        findViewById<TextView>(R.id.server_error_detail).text =
            listOfNotNull(origin, message?.let(::getString)).joinToString("\n")
        findViewById<View>(R.id.retry).requestFocus()
    }

    fun onRendererGone(page: WebView) {
        if (webView !== page) return
        backPending = false
        hideFullscreen(notifyPage = false)
        disposeWebView()
        showServerError(R.string.web_view_stopped)
    }

    private fun hideFullscreen(notifyPage: Boolean = true) {
        val callback = customViewCallback ?: return
        customViewCallback = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            fullscreenBackCallback?.let(onBackInvokedDispatcher::unregisterOnBackInvokedCallback)
            fullscreenBackCallback = null
        }
        fullscreenSurface.removeAllViews()
        fullscreenSurface.isVisible = false
        webSurface.isVisible = !serverError.isVisible
        if (notifyPage) {
            webView?.requestFocus()
            callback.onCustomViewHidden()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        keyCode == KeyEvent.KEYCODE_BACK || super.onKeyDown(keyCode, event)

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyUp(keyCode, event)
        if (!event.isCanceled) handleBack()
        return true
    }

    private fun handleBack() {
        val page = webView
        if (serverError.isVisible || page == null) {
            finish()
            return
        }
        if (backPending || exitDialog?.isShowing == true) return
        backPending = true
        val fullscreen = customViewCallback != null
        val backAction = if (fullscreen) {
            "window.streambertAndroidBack?.dismissOverlay?.() === true"
        } else {
            "typeof window.streambertAndroidBack === 'function' && window.streambertAndroidBack()"
        }
        page.evaluateJavascript(backAction) { handled ->
            if (webView != page || isFinishing || isDestroyed) return@evaluateJavascript
            backPending = false
            if (handled == "true" || serverError.isVisible || setupOpen) return@evaluateJavascript
            if (fullscreen) {
                hideFullscreen()
                return@evaluateJavascript
            }
            val atSignIn = page.url?.let(Uri::parse)?.path == "/login"
            if (!atSignIn && page.canGoBack()) {
                page.goBack()
                return@evaluateJavascript
            }
            exitDialog = AlertDialog.Builder(this)
                .setTitle(R.string.exit_title)
                .setPositiveButton(R.string.exit) { _, _ -> finish() }
                .setNegativeButton(android.R.string.cancel, null)
                .setNeutralButton(R.string.change_server) { _, _ -> changeServer() }
                .show().apply { getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus() }
        }
    }

    fun checkForUpdates(reply: (JSONObject) -> Unit) = updates.checkNow(reply)

    override fun onResume() {
        super.onResume()
        updates.onResume()
    }

    override fun onPause() {
        updates.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    private fun disposeWebView() {
        hideFullscreen()
        webView?.let { page ->
            webView = null
            (page.parent as? ViewGroup)?.removeView(page)
            page.destroy()
        }
    }

    override fun onDestroy() {
        updates.close()
        exitDialog?.dismiss()
        disposeWebView()
        super.onDestroy()
    }
}

class FullscreenSurface(context: Context, attrs: AttributeSet) : FrameLayout(context, attrs) {
    var onBack: (() -> Unit)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val back = onBack
        if (event.keyCode != KeyEvent.KEYCODE_BACK || back == null) return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) back()
        return true
    }
}
