package com.awu05.streambert.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.widget.Toast
import androidx.core.content.IntentCompat
import com.awu05.streambert.R

class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmation = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                val launched = confirmation != null && runCatching {
                    context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.isSuccess
                if (!launched) showError(context, null)
            }
            PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE_ABORTED -> Unit
            else -> showError(context, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    private fun showError(context: Context, message: String?) {
        Toast.makeText(context, message ?: context.getString(R.string.update_install_failed), Toast.LENGTH_LONG).show()
    }
}
