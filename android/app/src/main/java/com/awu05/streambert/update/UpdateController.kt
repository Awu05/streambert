package com.awu05.streambert.update

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
    private data class UpdatePrompt(val update: AvailableUpdate, val manual: Boolean)

    private val restoredState = activity.savedStateRegistry.consumeRestoredStateForKey(SAVED_STATE)
    private val executor = Executors.newSingleThreadExecutor()
    private val checker = UpdateChecker()
    private val installer = UpdateInstaller(activity)
    private val installed = checkNotNull(Version.parse(BuildConfig.VERSION_NAME))
    private val replies = mutableListOf<(JSONObject) -> Unit>()
    private var checking = false
    private var resumed = false
    private var dismissed = restoredState?.getBoolean("dismissed") == true
    private var pendingPrompt: UpdatePrompt? = null
    private var manualPromptRequested = false
    private var pendingPermission = restoredState?.getBundle("permission")?.let(::restoreUpdate)
    private var dialog: AlertDialog? = null
    private var download: Future<*>? = null
    private var downloadId = 0
    private val permission = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val update = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        if (activity.packageManager.canRequestPackageInstalls()) startDownload(update)
        else toast(activity.getString(R.string.update_permission_required))
    }

    init {
        activity.savedStateRegistry.registerSavedStateProvider(SAVED_STATE) {
            Bundle().apply {
                putBoolean("dismissed", dismissed)
                pendingPermission?.let { update ->
                    putBundle("permission", Bundle().apply {
                        putString("tag", update.tag)
                        putString("url", update.apkUrl)
                        putLong("size", update.apkSize)
                    })
                }
            }
        }
    }

    fun onAppStart() {
        if (pendingPermission == null && prefs.readyUpdateFile == null) checkNow()
    }

    fun onResume() {
        resumed = true
        val now = System.currentTimeMillis()
        if (download == null && (now - prefs.lastUpdateCheck > CHECK_INTERVAL || prefs.lastUpdateCheck > now)) {
            onAppStart()
        }
        onWindowAvailable()
    }

    fun onPause() {
        resumed = false
    }

    fun onWindowAvailable() {
        if (!resumed || !activity.hasWindowFocus() || !activity.canShowUpdate ||
            activity.isFinishing || activity.isDestroyed || dialog?.isShowing == true || pendingPermission != null
        ) return

        val fileName = prefs.readyUpdateFile
        if (fileName != null) {
            dismissPrompt()
            prefs.readyUpdateFile = null
            runCatching { activity.startActivity(installer.installIntent(fileName)) }
                .onFailure { toast(it.localizedMessage ?: activity.getString(R.string.update_install_failed)) }
            return
        }

        val prompt = pendingPrompt ?: return
        pendingPrompt = null
        if (!dismissed || prompt.manual) showPrompt(prompt.update)
    }

    fun checkNow(reply: ((JSONObject) -> Unit)? = null) {
        if (reply != null) {
            replies.add(reply)
            if (dialog?.isShowing != true) manualPromptRequested = true
        }
        if (checking) return
        checking = true
        executor.execute {
            val result = checker.check(installed)
            activity.runOnUiThread {
                if (activity.isDestroyed || activity.isFinishing) return@runOnUiThread
                checking = false
                prefs.lastUpdateCheck = System.currentTimeMillis()
                val manual = manualPromptRequested
                manualPromptRequested = false
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
                if (update != null && (manual || !dismissed) && dialog?.isShowing != true) {
                    pendingPrompt = UpdatePrompt(update, manual)
                    onWindowAvailable()
                }
            }
        }
    }

    private fun showPrompt(update: AvailableUpdate) {
        val prompt = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_available, update.version))
            .setMessage(update.notes)
            .setPositiveButton(R.string.install) { _, _ -> requestInstall(update) }
            .setNegativeButton(R.string.later) { _, _ -> dismissPrompt() }
            .setOnCancelListener { dismissPrompt() }
            .show()
        prompt.findViewById<TextView>(android.R.id.message)?.textSize = 20f
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus()
        dialog = prompt
    }

    private fun dismissPrompt() {
        dismissed = true
        pendingPrompt = null
        manualPromptRequested = false
    }

    private fun requestInstall(update: AvailableUpdate) {
        dismissPrompt()
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
                installer.download(update) { percent ->
                    activity.runOnUiThread {
                        if (downloadId == id) {
                            progress.progress = percent
                            progressDialog.setTitle(activity.getString(R.string.update_downloading, percent))
                        }
                    }
                }
            }
            activity.runOnUiThread {
                if (downloadId != id || activity.isDestroyed || activity.isFinishing) {
                    result.getOrNull()?.delete()
                    return@runOnUiThread
                }
                download = null
                result.onSuccess { prefs.readyUpdateFile = it.name }
                progressDialog.dismiss()
                result.onFailure {
                    toast(it.localizedMessage ?: activity.getString(R.string.update_install_failed))
                }
                onWindowAvailable()
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
        const val SAVED_STATE = "streambert.androidUpdates"

        fun restoreUpdate(state: Bundle): AvailableUpdate? {
            val tag = state.getString("tag") ?: return null
            val version = Version.parse(tag) ?: return null
            val url = state.getString("url") ?: return null
            return AvailableUpdate(version, tag, url, state.getLong("size"), "")
        }
    }
}
