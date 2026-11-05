package dev.tileflow.sdk.transport

import dev.tileflow.sdk.BuildConfig
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MapLibreRuntimeTest {
    object OtherVersion {
        const val MAPLIBRE_VERSION_STRING = "MapLibre Android/0.0.1"
    }

    @Test
    fun theInstalledMapLibreMatchesTheSdkPin() {
        MapLibreRuntime.verifyVersion(org.maplibre.android.BuildConfig::class.java)
    }

    @Test
    fun aDifferentOrUnidentifiedRendererCannotStart() {
        for (build in listOf(OtherVersion::class.java, String::class.java)) {
            val error = assertThrows(TileflowMapException::class.java) {
                MapLibreRuntime.verifyVersion(build)
            }
            assertEquals(TileflowErrorCode.UNSUPPORTED_DEVICE, error.code)
            assertTrue(error.context.message.orEmpty().contains(BuildConfig.MAPLIBRE_VERSION))
        }
    }
}
