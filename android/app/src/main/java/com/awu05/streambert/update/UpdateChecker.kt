package com.awu05.streambert.update

import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONException

class UpdateChecker(private val fetch: (String) -> String = ::fetchReleases) {
    fun check(installed: Version): Result<AvailableUpdate?> = runCatching {
        val releases = try {
            JSONArray(fetch(RELEASES_URL))
        } catch (error: JSONException) {
            throw IOException("GitHub returned an invalid release list", error)
        }
        ReleasePicker.pick(releases, installed)
    }

    companion object {
        private const val RELEASES_URL =
            "https://api.github.com/repos/Awu05/streambert/releases?per_page=30"

        private fun fetchReleases(url: String): String {
            val connection = URL(url).openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 7_000
                connection.readTimeout = 7_000
                connection.setRequestProperty("Accept", "application/vnd.github+json")
                connection.setRequestProperty("User-Agent", "Streambert-Android")
                val status = connection.responseCode
                if (status !in 200..299) throw IOException("GitHub returned $status")
                return connection.inputStream.bufferedReader().use { it.readText() }
            } finally {
                connection.disconnect()
            }
        }
    }
}
