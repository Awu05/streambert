package com.awu05.streambert.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import com.awu05.streambert.BuildConfig
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class UpdateInstaller(private val context: Context) {
    fun download(update: AvailableUpdate, onProgress: (Int) -> Unit): File {
        val apk = File.createTempFile("streambert-update-", ".apk", context.cacheDir)
        try {
            val connection = URL(update.apkUrl).openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 15_000
                connection.readTimeout = 15_000
                val code = connection.responseCode
                if (code !in 200..299) throw IOException("APK download returned $code")
                connection.inputStream.buffered().use { input ->
                    apk.outputStream().buffered().use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var bytes = 0L
                        var lastProgress = 0
                        while (true) {
                            if (Thread.currentThread().isInterrupted) throw InterruptedIOException()
                            val count = input.read(buffer)
                            if (count < 0) break
                            bytes += count
                            if (bytes > update.apkSize) throw IOException("The APK exceeds its published size")
                            output.write(buffer, 0, count)
                            val progress = (bytes.toDouble() * 100 / update.apkSize).toInt()
                            if (progress != lastProgress) onProgress(progress)
                            lastProgress = progress
                        }
                        if (bytes != update.apkSize) throw IOException("The APK download is incomplete")
                    }
                }
                return apk
            } finally {
                connection.disconnect()
            }
        } catch (error: Exception) {
            apk.delete()
            throw error
        }
    }

    fun install(apk: File) {
        @Suppress("DEPRECATION")
        val archive = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
        if (archive == null || archive.packageName != context.packageName ||
            PackageInfoCompat.getLongVersionCode(archive) <= BuildConfig.VERSION_CODE
        ) {
            throw IOException("This APK cannot update the installed Streambert app")
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        params.setSize(apk.length())
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("streambert.apk", 0, apk.length()).use { output ->
                    apk.inputStream().use { it.copyTo(output) }
                    session.fsync(output)
                }
                val result = PendingIntent.getBroadcast(
                    context, sessionId, Intent(context, InstallResultReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or
                        (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
                )
                session.commit(result.intentSender)
            }
        } catch (error: Exception) {
            runCatching { installer.abandonSession(sessionId) }
            throw error
        }
    }
}
