package com.awu05.streambert.update

import java.io.IOException
import com.awu05.streambert.update.UpdateChecker.ReleasePage
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
        val update = ReleasePicker.pick(releases, installed)!!
        assertEquals("2.16.0", update.tag)
        assertEquals("https://github.com/Streambert-Android-2.16.0.apk", update.apkUrl)
        assertEquals("1\n2\n3\n4\n5\n6", update.notes)
    }

    @Test fun skipsOlderReleasesAndUnrelatedApks() {
        val unrelated = release("3.0.0")
        unrelated.getJSONArray("assets").getJSONObject(0).put("name", "other.apk")
        assertNull(ReleasePicker.pick(JSONArray().put(release("2.15.0")).put(unrelated), installed))
    }

    @Test fun checkerDistinguishesFailuresFromAnEmptyReleaseList() {
        val rateLimit = UpdateChecker { throw IOException("GitHub returned 403") }.check(installed)
        assertEquals("GitHub returned 403", rateLimit.exceptionOrNull()?.message)
        assertTrue(UpdateChecker { ReleasePage("{}") }.check(installed).isFailure)
        assertNull(UpdateChecker { ReleasePage("[]") }.check(installed).getOrThrow())
        val releases = JSONArray().put(release("2.16.0")).toString()
        assertEquals("2.16.0", UpdateChecker { ReleasePage(releases) }.check(installed).getOrThrow()?.tag)
    }

    @Test fun findsTheHighestUpdateAcrossReleasePages() {
        val webOnly = JSONArray()
        repeat(100) { webOnly.put(release("3.0.$it", apk = false)) }
        val pages = listOf(
            ReleasePage(webOnly.toString(), hasNext = true),
            ReleasePage(JSONArray().put(release("2.16.0")).toString(), hasNext = true),
            ReleasePage(JSONArray().put(release("2.17.0")).toString()),
        )
        val visited = mutableListOf<Int>()
        val update = UpdateChecker { page ->
            visited.add(page)
            pages[page - 1]
        }.check(installed).getOrThrow()
        assertEquals(listOf(1, 2, 3), visited)
        assertEquals("2.17.0", update?.tag)
    }

    @Test fun reportsAnIncompleteSearchAsAnError() {
        val result = UpdateChecker { page ->
            if (page == 1) ReleasePage("[]", hasNext = true)
            else throw IOException("GitHub returned 503")
        }.check(installed)
        assertEquals("GitHub returned 503", result.exceptionOrNull()?.message)
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
