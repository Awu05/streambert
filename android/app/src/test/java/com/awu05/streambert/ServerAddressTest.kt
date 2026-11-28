package com.awu05.streambert

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {
    @Test fun normalizesServerAddresses() {
        assertEquals("http://192.168.1.5:8080", ServerAddress.normalize(" 192.168.1.5:8080/login ").getOrThrow())
        assertEquals("https://stream.example.com", ServerAddress.normalize("HTTPS://Stream.Example.com:443/").getOrThrow())
        assertEquals("http://[::1]:8080", ServerAddress.normalize("[::1]:8080").getOrThrow())
    }

    @Test fun rejectsInvalidServerAddresses() {
        for (input in listOf("  ", "ftp://x", "http://", "https://user@x.com", "http://x.com:65536")) {
            assertTrue(input, ServerAddress.normalize(input).isFailure)
        }
    }

    @Test fun originComparisonIncludesSchemeHostAndPort() {
        assertTrue(ServerAddress.sameOrigin("https://a.com:443/x?y", "https://a.com"))
        assertFalse(ServerAddress.sameOrigin("https://a.com:444/x", "https://a.com"))
        assertFalse(ServerAddress.sameOrigin("http://a.com/x", "https://a.com"))
        assertFalse(ServerAddress.sameOrigin("https://a.com.evil.net/", "https://a.com"))
    }
}
