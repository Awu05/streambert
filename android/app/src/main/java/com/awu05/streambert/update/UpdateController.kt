package com.awu05.streambert.update

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import com.awu05.streambert.BuildConfig
import com.awu05.streambert.MainActivity
import com.awu05.streambert.Prefs
import com.awu05.streambert.R
import java.util.concurrent.Executors
import java.util.concurrent.Future
import org.json.JSONObject

class UpdateController(private val activity: MainActivity, private val prefs: Prefs) {
    private val executor = Executors.newSingleThreadExecutor()
    private val checker = UpdateChecker()
    private val installer = UpdateInstaller(activity)
    private val installed = checkNotNull(Version.parse(BuildConfig.VERSION_NAME))
    private val replies = mutableListOf<(JSONObject) -> Unit>()
    private var checking = false
    private var resumed = false
    private var dismissed = false
    private var pendingPrompt: AvailableUpdate? = null
    private var pendingPermission: AvailableUpdate? = null
    private var dialog: AlertDialog? = null
    private var download: Future<*>? = null
    private var downloadId = 0
    private val permission = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val update = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        if (activity.packageManager.canRequestPackageInstalls()) startDownload(update)
        else toast(activity.getString(R.string.update_permission_required))
    }

    fun onAppStart() = checkNow()

    fun onResume() {
        resumed = true
        pendingPrompt?.let(::showPrompt)
        val now = System.currentTimeMillis()
        if (now - prefs.lastUpdateCheck > CHECK_INTERVAL || prefs.lastUpdateCheck > now) checkNow()
    }

    fun onPause() {
        resumed = false
    }

    fun checkNow(reply: ((JSONObject) -> Unit)? = null) {
        if (reply != null) replies.add(reply)
        if (checking) return
        checking = true
        executor.execute {
            val result = checker.check(installed)
            activity.runOnUiThread {
                if (activity.isDestroyed || activity.isFinishing) return@runOnUiThread
                checking = false
                prefs.lastUpdateCheck = System.currentTimeMillis()
                val manual = replies.isNotEmpty()
                val update = result.getOrNull()
                val response = JSONObject().put("type", "updateResult")
                when {
                    result.isFailure -> response.put("status", "error").put(
                        "message", result.exceptionOrNull()?.localizedMessage ?: activity.getString(R.string.update_check_failed)
                    )
                    update == null -> response.put("status", "none")
                    else -> response.put("status", "available").put("version", update.version.toString())
                }
                replies.toList().also { replies.clear() }.forEach { it(JSONObject(response.toString())) }
                if (update != null && (manual || !dismissed)) {
                    pendingPrompt = update
                    showPrompt(update)
                }
            }
        }
    }

    private fun showPrompt(update: AvailableUpdate) {
        if (!resumed || !activity.canShowUpdate || dialog?.isShowing == true || pendingPermission != null) return
        pendingPrompt = null
        val prompt = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_available, update.version))
            .setMessage(update.notes)
            .setPositiveButton(R.string.install) { _, _ -> requestInstall(update) }
            .setNegativeButton(R.string.later) { _, _ -> dismissed = true }
            .setOnCancelListener { dismissed = true }
            .show()
        prompt.findViewById<TextView>(android.R.id.message)?.textSize = 20f
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus()
        dialog = prompt
    }

    private fun requestInstall(update: AvailableUpdate) {
        dismissed = true
        if (BuildConfig.DEBUG) {
            toast(activity.getString(R.string.update_debug_build))
            return
        }
        if (activity.packageManager.canRequestPackageInstalls()) {
            startDownload(update)
            return
        }
        dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.update_permission_title)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                pendingPermission = update
                val target = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                if (runCatching { permission.launch(target) }.isFailure) {
                    pendingPermission = null
                    toast(activity.getString(R.string.update_permission_required))
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun startDownload(update: AvailableUpdate) {
        val id = ++downloadId
        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val progressDialog = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_downloading, 0))
            .setView(progress)
            .setNegativeButton(android.R.string.cancel) { _, _ -> cancelDownload() }
            .setOnCancelListener { cancelDownload() }
            .show()
        dialog = progressDialog
        download = executor.submit {
            val result = runCatching {
                val apk = installer.download(update) { percent ->
                    activity.runOnUiThread {
                        if (downloadId == id) {
                            progress.progress = percent
                            progressDialog.setTitle(activity.getString(R.string.update_downloading, percent))
                        }
                    }
                }
                try {
                    if (!Thread.currentThread().isInterrupted) installer.install(apk)
                } finally {
                    apk.delete()
                }
            }
            activity.runOnUiThread {
                if (downloadId != id || activity.isDestroyed) return@runOnUiThread
                download = null
                progressDialog.dismiss()
                result.exceptionOrNull()?.let {
                    toast(it.localizedMessage ?: activity.getString(R.string.update_install_failed))
                }
            }
        }
    }

    private fun cancelDownload() {
        downloadId++
        download?.cancel(true)
        download = null
    }

    fun close() {
        cancelDownload()
        dialog?.dismiss()
        executor.shutdownNow()
    }

    private fun toast(message: String) {
        Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    }

    private companion object {
        const val CHECK_INTERVAL = 24 * 60 * 60 * 1000L
    }
}
