package dev.tileflow.sdk

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class WebViewRequirementTest {
    @Test
    public fun rejectsOnlyRecognisedVersionsBelowTheMinimum() {
        assertFalse(WebViewRequirement.isSupported("113.0.5672.136"))
        assertFalse(WebViewRequirement.isSupported("123.0.6312.118"))
        assertTrue(WebViewRequirement.isSupported("124.0.6367.219"))
        assertTrue(WebViewRequirement.isSupported("146.0.7680.164"))
        assertTrue(WebViewRequirement.isSupported(null))
        assertTrue(WebViewRequirement.isSupported("unknown"))
    }
}
