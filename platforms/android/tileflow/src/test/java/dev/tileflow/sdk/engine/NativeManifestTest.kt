package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import java.net.URI
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A renderer finds the style of the theme the application asked for in the map's manifest. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeManifestTest {
    private val origin = "https://api.tileflow.test"
    private val discovery = "$origin/maps/map_1/mobile/manifest.json"
    private val profile = "$origin/maps/map_1/mobile/webview-v1/manifest.json"
    private val selfHosted = "https://maps.example.test/manifest.json"
    private val map =
        """{"mapId":"map_1","defaultTheme":"day","systemThemes":{"light":"day","dark":"night"},
            "view":{"center":[-3.7,40.42],"zoom":15.5,"bearing":10,"pitch":20},
            "themes":{"day":{"styleUrl":"v1/day.json","colorScheme":"light"},
                      "night":{"styleUrl":"$origin/maps/map_1/mobile/webview-v1/v1/night.json",
                               "colorScheme":"dark"},
                      "dusk":{"styleUrl":"v1/dusk.json","colorScheme":"dark"}}}"""
    private val documents =
        mutableMapOf(
            discovery to
                """{"version":1,"mapId":"map_1","deploymentVersion":1,
                    "representations":{"webview-v1":{"manifestUrl":"$profile"}}}""",
            profile to """{"version":1,"maps":{"map":$map}}""",
            selfHosted to """{"version":1,"maps":{"city":$map}}""",
        )

    private fun load(url: URI): ByteArray =
        documents[url.toString()]?.toByteArray() ?: throw NativeResourceStatus(404)

    private fun hosted(theme: String?, colorScheme: String = "light") =
        NativeManifest.resolve(
            JSONObject()
                .put("map", "map")
                .put("manifestUrl", discovery)
                .put("discoveryMapId", "map_1"),
            theme,
            colorScheme,
            ::load,
        )

    @Test
    fun aHostedMapReadsDiscoveryThenItsProfileManifest() {
        val document = hosted(null)
        assertEquals("day", document.theme)
        assertEquals("$origin/maps/map_1/mobile/webview-v1/v1/day.json", document.styleUrl)
        assertEquals(TileflowCamera(-3.7, 40.42, 15.5, 10.0, 20.0), document.view)
        assertEquals("night", hosted("night").theme)
        assertEquals("$origin/maps/map_1/mobile/webview-v1/v1/night.json", hosted("night").styleUrl)
    }

    @Test
    fun theSystemThemeFollowsTheColorScheme() {
        assertEquals("day", hosted("system", "light").theme)
        assertEquals("night", hosted("system", "dark").theme)
        // Without declared system themes, the first theme of the scheme answers.
        documents[profile] =
            """{"version":1,"maps":{"map":${JSONObject(map).apply { remove("systemThemes") }}}}"""
        assertEquals("night", hosted("system", "dark").theme)
    }

    @Test
    fun aSelfHostedSourceIsItsManifest() {
        val document =
            NativeManifest.resolve(
                JSONObject().put("map", "city").put("manifestUrl", selfHosted),
                "dusk",
                "light",
                ::load,
            )
        assertEquals("https://maps.example.test/v1/dusk.json", document.styleUrl)
    }

    @Test
    fun missingDocumentsAndThemesFailAsResources() {
        fun failure(block: () -> Unit): TileflowMapException {
            try {
                block()
            } catch (error: TileflowMapException) {
                return error
            }
            fail("Expected a failure")
            throw AssertionError()
        }
        val unknownTheme = failure { hosted("winter") }
        assertEquals(TileflowErrorCode.RESOURCE_FAILED, unknownTheme.code)
        assertEquals(TileflowResourceKind.STYLE, unknownTheme.context.resource)
        val wrongMap = failure {
            NativeManifest.resolve(
                JSONObject()
                    .put("map", "map")
                    .put("manifestUrl", discovery)
                    .put("discoveryMapId", "map_2"),
                null,
                "light",
                ::load,
            )
        }
        assertEquals(TileflowResourceKind.MANIFEST, wrongMap.context.resource)
        documents.remove(profile)
        val missing = failure { hosted(null) }
        assertEquals(TileflowResourceKind.MANIFEST, missing.context.resource)
        assertEquals(404, missing.context.status)
        assertEquals(origin, missing.context.origin)
    }
}
