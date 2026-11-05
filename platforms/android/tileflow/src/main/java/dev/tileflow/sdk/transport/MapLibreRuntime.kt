package dev.tileflow.sdk.transport

import android.content.Context
import dev.tileflow.sdk.BuildConfig
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import org.maplibre.android.MapLibre

/** Checks the AAR actually resolved by the application before the SDK starts MapLibre. */
internal object MapLibreRuntime {
    private val checked: Unit by lazy { verifyVersion(org.maplibre.android.BuildConfig::class.java) }

    fun initialize(context: Context) {
        try {
            checked
            MapLibre.getInstance(context)
        } catch (_: LinkageError) {
            throw unsupported("MapLibre could not load its native library on this device.")
        }
    }

    fun verifyVersion(build: Class<*>) {
        // A direct reference inlines the version Tileflow compiled against.
        val actual = try {
            build.getField("MAPLIBRE_VERSION_STRING").get(null) as? String
        } catch (_: ReflectiveOperationException) {
            null
        }
        val expected = "MapLibre Android/${BuildConfig.MAPLIBRE_VERSION}"
        if (actual != expected)
            throw unsupported("Expected $expected. Loaded ${actual?.take(80) ?: "an unidentified version"}.")
    }

    fun unsupported(message: String) =
        TileflowMapException(TileflowErrorCode.UNSUPPORTED_DEVICE, TileflowErrorContext(message = message))
}
