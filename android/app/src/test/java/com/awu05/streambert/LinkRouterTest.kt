package com.awu05.streambert

import org.junit.Assert.assertEquals
import org.junit.Test

class LinkRouterTest {
    private val origin = "http://192.168.1.5:8080"

    @Test fun routesSameOriginAndLocalMediaToWebView() {
        assertEquals(LinkTarget.InApp, LinkRouter.route("$origin/api/x", origin))
        assertEquals(LinkTarget.InApp, LinkRouter.route("blob:$origin/123", origin))
    }

    @Test fun routesIntentLinksToAndroid() {
        val link = "intent://cdn.x/a.m3u8#Intent;scheme=https;action=android.intent.action.VIEW;end"
        assertEquals(LinkTarget.AndroidIntent(link), LinkRouter.route(link, origin))
    }

    @Test fun routesOtherOriginsAndSchemesExternally() {
        for (link in listOf("https://github.com/", "vlc://x", "http://192.168.1.5:8081/")) {
            assertEquals(LinkTarget.External(link), LinkRouter.route(link, origin))
        }
    }
}
