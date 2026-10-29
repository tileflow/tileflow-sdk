package dev.tileflow.sdk

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Resources
import android.webkit.WebView
import dev.tileflow.configuration.Tileflow
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.configuration.TileflowCredential
import java.net.URI
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * How a Hosted map finds its credential and API origin: its own configuration, else the one set
 * with `Tileflow.configure`, else the string resources. Only the map credential authorizes a map.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class MapConfigurationTest {
    private val mapId = "map_0123456789abcdef"
    private val credential = "tf_public_" + "a".repeat(48)
    private val otherCredential = "tf_public_" + "c".repeat(48)
    private val servicesCredential = "tf_public_" + "b".repeat(48)

    @Test
    fun theMapsOwnConfigurationComesFirst() {
        val own =
            TileflowMapSource.hosted(
                    mapId,
                    configuration = configuration("https://own.example.test", credential),
                )
                .loadable { error("The process configuration is not read.") }
        assertEquals(listOf("https://own.example.test", credential), endpoint(own))
        assertEquals(
            URI("https://own.example.test/maps/$mapId/mobile/manifest.json"),
            own.manifestUrl,
        )
        assertEquals(
            setOf(
                own.manifestUrl,
                URI("https://own.example.test/maps/$mapId/mobile/webview-v1/manifest.json"),
            ),
            own.publicMetadataUrls,
        )

        val fromProcess =
            TileflowMapSource.hosted(mapId).loadable {
                configuration("https://process.example.test", otherCredential)
            }
        assertEquals(listOf("https://process.example.test", otherCredential), endpoint(fromProcess))
    }

    @Test
    fun theConfiguredProcessConfigurationReplacesTheResources() {
        // This leaves the process configured; no other map test reads the process configuration.
        val context = contextWith(mapOf("tileflow_map_credential" to otherCredential))
        Tileflow.configure(configuration("https://configured.example.test", credential))
        assertEquals(
            listOf("https://configured.example.test", credential),
            endpoint(TileflowMapSource.hosted(mapId).loadable { Tileflow.configuration(context) }),
        )
        val own =
            TileflowMapSource.hosted(
                mapId,
                configuration = configuration("https://own.example.test", otherCredential),
            )
        assertEquals(
            listOf("https://own.example.test", otherCredential),
            endpoint(own.loadable { Tileflow.configuration(context) }),
        )
    }

    @Test
    fun theStringResourcesConfigureTheMap() {
        val context =
            contextWith(
                mapOf(
                    "tileflow_api_origin" to "https://resources.example.test/",
                    "tileflow_map_credential" to credential,
                    "tileflow_services_credential" to servicesCredential,
                )
            )
        assertEquals(
            listOf("https://resources.example.test", credential),
            endpoint(
                TileflowMapSource.hosted(mapId).loadable {
                    TileflowConfiguration.fromResources(context)
                }
            ),
        )

        val servicesOnly = contextWith(mapOf("tileflow_services_credential" to servicesCredential))
        assertCode(TileflowErrorCode.MISSING_CREDENTIAL) {
            TileflowMapSource.hosted(mapId).loadable {
                TileflowConfiguration.fromResources(servicesOnly)
            }
        }
    }

    @Test
    fun missingAndInvalidConfigurationsAreTypedErrors() {
        val source = TileflowMapSource.hosted(mapId)
        val cases =
            listOf<Pair<() -> TileflowConfiguration, TileflowErrorCode>>(
                { TileflowConfiguration() } to TileflowErrorCode.MISSING_CREDENTIAL,
                {
                    TileflowConfiguration(
                        servicesCredential = TileflowCredential(servicesCredential),
                        searchCredential = TileflowCredential(servicesCredential),
                    )
                } to TileflowErrorCode.MISSING_CREDENTIAL,
                {
                    throw TileflowConfigurationException("The tileflow_map_credential is invalid.")
                } to TileflowErrorCode.INVALID_CONFIGURATION,
            )
        for ((read, code) in cases) assertCode(code) { source.loadable(read) }
        for (invalid in
            listOf(
                TileflowMapSource.hosted("map_short"),
                TileflowMapSource.hosted(mapId, surfaceId = "Not valid"),
                TileflowMapSource.hosted(mapId, surfaceId = "tf_public_surface"),
                TileflowMapSource.hosted(
                    mapId,
                    publicResourceOrigins = setOf(URI("http://public.example")),
                ),
            )) {
            assertThrows(IllegalArgumentException::class.java) { invalid.validate() }
        }
    }

    @Test
    fun aLoopbackHttpApiOriginServesALocalDevelopmentMap() {
        for (origin in listOf("http://127.0.0.1:8787", "http://localhost:8787")) {
            val loadable =
                TileflowMapSource.hosted(mapId, configuration = configuration(origin, credential))
                    .loadable { error("The process configuration is not read.") }
            val endpoint = requireNotNull(loadable.hosted)
            assertEquals(URI(origin), endpoint.apiOrigin)
            assertTrue(endpoint.isLoopbackHttp)
            assertEquals(URI("$origin/maps/$mapId/mobile/manifest.json"), loadable.manifestUrl)
            loadable.publicMetadataUrls.forEach(loadable.policy::validate)
        }
        val remote =
            TileflowMapSource.hosted(
                    mapId,
                    configuration = configuration("https://api.tileflow.test", credential),
                )
                .loadable { error("The process configuration is not read.") }
        assertFalse(requireNotNull(remote.hosted).isLoopbackHttp)
        assertThrows(IllegalArgumentException::class.java) {
            remote.policy.validate(URI("http://127.0.0.1:8787/maps/$mapId/mobile/manifest.json"))
        }
        // The configuration accepts no other HTTP origin, for a map or a service.
        for (origin in listOf("http://api.example.test", "http://10.0.2.2:8787")) {
            assertThrows(TileflowConfigurationException::class.java) {
                configuration(origin, credential)
            }
        }
    }

    @Test
    fun aLayoutSelectsAHostedMapWithItsAttributes() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val attributes =
            Robolectric.buildAttributeSet()
                .addAttribute(R.attr.tileflowMapId, mapId)
                .addAttribute(R.attr.tileflowSurfaceId, "store-locator")
                .addAttribute(R.attr.tileflowTheme, "dark")
                .build()
        val view = TileflowMapView(activity, attributes)
        try {
            assertEquals(TileflowMapSource.hosted(mapId, "store-locator"), view.source)
            assertEquals("dark", view.theme)
        } finally {
            view.destroy()
        }
        val defaults =
            TileflowMapView(
                activity,
                Robolectric.buildAttributeSet().addAttribute(R.attr.tileflowMapId, mapId).build(),
            )
        assertEquals(TileflowMapSource.hosted(mapId), defaults.source)
        assertNull(defaults.theme)
        defaults.destroy()
        val plain = TileflowMapView(activity, Robolectric.buildAttributeSet().build())
        assertNull(plain.source)
        plain.destroy()
        for (invalid in
            listOf(
                Robolectric.buildAttributeSet().addAttribute(R.attr.tileflowMapId, "map_short"),
                Robolectric.buildAttributeSet()
                    .addAttribute(R.attr.tileflowSurfaceId, "store-locator"),
                Robolectric.buildAttributeSet()
                    .addAttribute(R.attr.tileflowMapId, mapId)
                    .addAttribute(R.attr.tileflowTheme, ""),
            )) {
            assertThrows(IllegalArgumentException::class.java) {
                TileflowMapView(activity, invalid.build())
            }
        }
    }

    @Test
    fun aViewWithoutAMapCredentialReportsItAndStartsNoRenderer() {
        val services =
            TileflowConfiguration(
                apiOrigin = URI("https://api.tileflow.test"),
                servicesCredential = TileflowCredential(servicesCredential),
            )
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val failures = mutableListOf<TileflowErrorCode>()
        val view = TileflowMapView(activity)
        view.onEvent = { if (it is TileflowMapEvent.Failed) failures += it.code }
        view.setSource(TileflowMapSource.hosted(mapId, configuration = services))
        activity.setContentView(view)
        try {
            assertEquals(listOf(TileflowErrorCode.MISSING_CREDENTIAL), failures)
            assertTrue((0 until view.childCount).none { view.getChildAt(it) is WebView })
            view.reload()
            assertEquals(List(2) { TileflowErrorCode.MISSING_CREDENTIAL }, failures)
        } finally {
            view.destroy()
        }
    }

    private fun configuration(origin: String, mapCredential: String) =
        TileflowConfiguration(
            apiOrigin = URI(origin),
            servicesCredential = TileflowCredential(servicesCredential),
            mapCredential = TileflowCredential(mapCredential),
        )

    /** The session-start origin and the credential it presents. */
    private fun endpoint(source: LoadableMapSource): List<String> {
        val endpoint = requireNotNull(source.hosted)
        val request = endpoint.sessionRequest(mapId, "session", "mobile-map")
        assertNull(request.header("Authorization"))
        val value = requireNotNull(request.header("X-Tileflow-Mobile-Client"))
        assertFalse(endpoint.toString().contains(value.drop(10)))
        return listOf("${request.url.scheme}://${request.url.host}", value)
    }

    private fun assertCode(code: TileflowErrorCode, block: () -> Unit) {
        val error = assertThrows(TileflowMapException::class.java) { block() }
        assertEquals(code, error.code)
    }

    /** An application context whose string resources are [values]. */
    @Suppress("DEPRECATION")
    private fun contextWith(values: Map<String, String>): Context {
        val base = RuntimeEnvironment.getApplication()
        val ids = values.keys.withIndex().associate { (index, key) -> key to 0x7f990000 + index }
        val resources =
            object :
                Resources(
                    base.assets,
                    base.resources.displayMetrics,
                    base.resources.configuration,
                ) {
                override fun getIdentifier(name: String, type: String?, pkg: String?): Int =
                    if (type == "string") ids[name] ?: 0 else 0

                override fun getString(id: Int): String =
                    values.entries.firstOrNull { ids[it.key] == id }?.value
                        ?: throw NotFoundException()
            }
        return object : ContextWrapper(base) {
            override fun getResources(): Resources = resources

            override fun getApplicationContext(): Context = this
        }
    }
}
