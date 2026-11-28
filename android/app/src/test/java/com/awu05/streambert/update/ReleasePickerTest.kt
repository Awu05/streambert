package com.awu05.streambert.update

import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleasePickerTest {
    private val installed = Version(2, 15, 0)

    @Test fun parsesAndOrdersVersions() {
        assertEquals(Version(1, 3, 0), Version.parse("v1.3"))
        assertNull(Version.parse("nightly"))
        assertTrue(Version(2, 16, 0) > Version(2, 15, 9))
    }

    @Test fun choosesTheHighestStableVersionWithAnApk() {
        val releases = JSONArray()
            .put(release("2.17.0", apk = false))
            .put(release("2.16.0"))
            .put(release("3.0.0").put("draft", true))
            .put(release("4.0.0").put("prerelease", true))
            .put(release("2.15.1"))
        val update = ReleasePicker.pick(releases.toString(), installed)!!
        assertEquals("2.16.0", update.tag)
        assertEquals("https://github.com/Streambert-Android-2.16.0.apk", update.apkUrl)
        assertEquals("1\n2\n3\n4\n5\n6", update.notes)
    }

    @Test fun skipsMalformedListsAndOlderReleases() {
        assertNull(ReleasePicker.pick("{oops", installed))
        assertNull(ReleasePicker.pick("{}", installed))
        assertNull(ReleasePicker.pick(JSONArray().put(release("2.15.0")).toString(), installed))
    }

    @Test fun checkerDistinguishesFailuresFromAnEmptyReleaseList() {
        val rateLimit = UpdateChecker { throw IOException("GitHub returned 403") }.check(installed)
        assertEquals("GitHub returned 403", rateLimit.exceptionOrNull()?.message)
        assertTrue(UpdateChecker { "{}" }.check(installed).isFailure)
        assertNull(UpdateChecker { "[]" }.check(installed).getOrThrow())
        val releases = JSONArray().put(release("2.16.0")).toString()
        assertEquals("2.16.0", UpdateChecker { releases }.check(installed).getOrThrow()?.tag)
    }

    private fun release(tag: String, apk: Boolean = true): JSONObject {
        val assets = JSONArray()
        if (apk) assets.put(
            JSONObject()
                .put("name", "Streambert-Android-$tag.apk")
                .put("browser_download_url", "https://github.com/Streambert-Android-$tag.apk")
                .put("size", 10),
        )
        return JSONObject().put("tag_name", tag).put("assets", assets)
            .put("body", "1\n\n2\n3\n4\n5\n6\n7")
    }
}
