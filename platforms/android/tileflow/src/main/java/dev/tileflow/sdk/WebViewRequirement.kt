package dev.tileflow.sdk

/**
 * Android System WebView updates independently of the OS. Older providers can load the embedded
 * renderer and answer feature queries while presenting a blank canvas, so mounting rejects them
 * with [TileflowErrorCode.INCOMPATIBLE_RUNTIME] instead.
 */
internal object WebViewRequirement {
    /** The oldest major version that continuous integration qualifies on an emulator. */
    const val MINIMUM_MAJOR_VERSION: Int = 124

    /** Only a recognisable Chromium version below the minimum is rejected. */
    fun isSupported(versionName: String?): Boolean {
        val major = versionName?.substringBefore('.')?.toIntOrNull() ?: return true
        return major >= MINIMUM_MAJOR_VERSION
    }
}
