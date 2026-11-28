package com.awu05.streambert.update

import java.io.IOException
import java.io.InterruptedIOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONException

class UpdateChecker(private val fetch: (Int) -> ReleasePage = ::fetchReleases) {
    data class ReleasePage(val body: String, val hasNext: Boolean = false)

    fun check(installed: Version): Result<AvailableUpdate?> = runCatching {
        var newest: AvailableUpdate? = null
        var pageNumber = 1
        do {
            if (Thread.currentThread().isInterrupted) throw InterruptedIOException()
            val page = fetch(pageNumber++)
            val releases = try {
                JSONArray(page.body)
            } catch (error: JSONException) {
                throw IOException("GitHub returned an invalid release list", error)
            }
            ReleasePicker.pick(releases, newest?.version ?: installed)?.let { newest = it }
        } while (page.hasNext)
        newest
    }

    companion object {
        private const val RELEASES_URL = "https://api.github.com/repos/Awu05/streambert/releases"
        private val nextLink = Regex(""";\s*rel="next"""")

        private fun fetchReleases(page: Int): ReleasePage {
            val connection = URL("$RELEASES_URL?per_page=100&page=$page").openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 7_000
                connection.readTimeout = 7_000
                connection.setRequestProperty("Accept", "application/vnd.github+json")
                connection.setRequestProperty("User-Agent", "Streambert-Android")
                val status = connection.responseCode
                if (status !in 200..299) throw IOException("GitHub returned $status")
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val hasNext = nextLink.containsMatchIn(connection.getHeaderField("Link").orEmpty())
                return ReleasePage(body, hasNext)
            } finally {
                connection.disconnect()
            }
        }
    }
}
