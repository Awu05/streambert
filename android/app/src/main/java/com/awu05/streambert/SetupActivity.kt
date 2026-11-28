package com.awu05.streambert

import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import javax.net.ssl.SSLException

class SetupActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var prefs: Prefs
    private lateinit var address: EditText
    private lateinit var connect: Button
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        setContentView(R.layout.activity_setup)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.setup_root)) { view, insets ->
            val padding = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.updatePadding(left = padding.left, top = padding.top, right = padding.right, bottom = padding.bottom)
            insets
        }
        address = findViewById(R.id.server_address)
        connect = findViewById(R.id.connect)
        status = findViewById(R.id.setup_status)
        if (savedInstanceState == null) address.setText(prefs.serverOrigin ?: "http://")
        address.requestFocus()
        address.setSelection(address.length())
        address.setOnEditorActionListener { _, action, _ ->
            if (action != EditorInfo.IME_ACTION_GO) return@setOnEditorActionListener false
            connect.performClick()
            true
        }
        connect.setOnClickListener { connectToServer() }
    }

    private fun connectToServer() {
        if (!connect.isEnabled) return
        val origin = ServerAddress.normalize(address.text.toString()).getOrElse {
            status.text = it.message
            return
        }
        connect.isEnabled = false
        status.setText(R.string.connecting)
        worker.execute {
            val result = runCatching { verifyServer(origin) }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                connect.isEnabled = true
                if (result.getOrDefault(false)) {
                    prefs.serverOrigin = origin
                    setResult(RESULT_OK)
                    finish()
                } else {
                    status.text = if (result.exceptionOrNull() is SSLException) {
                        getString(R.string.certificate_untrusted)
                    } else {
                        getString(R.string.server_not_found, origin)
                    }
                }
            }
        }
    }

    private fun verifyServer(origin: String): Boolean {
        var url = URI("$origin/login")
        repeat(4) {
            val connection = url.toURL().openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.instanceFollowRedirects = false
                when (connection.responseCode) {
                    HttpURLConnection.HTTP_OK -> return connection.inputStream.bufferedReader().use {
                        val prefix = CharArray(4096)
                        var count = 0
                        while (count < prefix.size) {
                            val read = it.read(prefix, count, prefix.size - count)
                            if (read < 0) break
                            count += read
                        }
                        "Streambert" in String(prefix, 0, count)
                    }
                    301, 302, 303, 307, 308 -> {
                        val location = connection.getHeaderField("Location") ?: return false
                        url = url.resolve(location)
                        if (!ServerAddress.sameOrigin(url.toString(), origin)) return false
                    }
                    else -> return false
                }
            } finally {
                connection.disconnect()
            }
        }
        return false
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }
}
