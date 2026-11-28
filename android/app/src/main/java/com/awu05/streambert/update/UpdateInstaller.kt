package com.awu05.streambert.update

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.PackageInfoCompat
import androidx.core.content.FileProvider
import com.awu05.streambert.BuildConfig
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class UpdateInstaller(private val context: Context) {
    private val directory = File(context.cacheDir, "updates")

    fun download(update: AvailableUpdate, onProgress: (Int) -> Unit): File {
        directory.mkdirs()
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        directory.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
        val apk = File.createTempFile("streambert-", ".apk", directory)
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

    fun installIntent(fileName: String): Intent {
        val apk = File(directory, fileName)
        if (apk.name != fileName || !apk.isFile) throw IOException("The downloaded APK is no longer available")
        @Suppress("DEPRECATION")
        val archive = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
        if (archive == null || archive.packageName != context.packageName ||
            PackageInfoCompat.getLongVersionCode(archive) <= BuildConfig.VERSION_CODE
        ) {
            throw IOException("This APK cannot update the installed Streambert app")
        }

        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

class UpdateFileProvider : FileProvider()
