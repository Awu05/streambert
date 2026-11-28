package com.awu05.streambert.update

import org.json.JSONArray
import org.json.JSONException

data class AvailableUpdate(
    val version: Version,
    val tag: String,
    val apkUrl: String,
    val apkSize: Long,
    val notes: String,
)

object ReleasePicker {
    fun pick(releasesJson: String, installed: Version): AvailableUpdate? =
        try {
            pick(JSONArray(releasesJson), installed)
        } catch (_: JSONException) {
            null
        }

    internal fun pick(releases: JSONArray, installed: Version): AvailableUpdate? {
        var newest: AvailableUpdate? = null
        for (index in 0 until releases.length()) {
            val release = releases.optJSONObject(index) ?: continue
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue
            val tag = release.optString("tag_name")
            val version = Version.parse(tag) ?: continue
            if (version <= (newest?.version ?: installed)) continue
            val assets = release.optJSONArray("assets") ?: continue
            for (assetIndex in 0 until assets.length()) {
                val asset = assets.optJSONObject(assetIndex) ?: continue
                if (!asset.optString("name").endsWith(".apk", ignoreCase = true)) continue
                val url = asset.optString("browser_download_url")
                val size = asset.optLong("size")
                if (!url.startsWith("https://", ignoreCase = true) || size <= 0) continue
                val notes = release.optString("body").lineSequence().filter { it.isNotBlank() }
                    .take(6).joinToString("\n")
                newest = AvailableUpdate(version, tag, url, size, notes)
                break
            }
        }
        return newest
    }
}
