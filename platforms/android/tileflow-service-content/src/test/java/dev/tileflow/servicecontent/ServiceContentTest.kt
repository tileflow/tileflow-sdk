package dev.tileflow.servicecontent

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.elevation.TileflowElevationDataset
import dev.tileflow.elevation.TileflowElevationProfile
import dev.tileflow.elevation.TileflowElevationProfileSummary
import dev.tileflow.elevation.TileflowElevationSample
import dev.tileflow.elevation.TileflowElevationUnit
import dev.tileflow.geoip.TileflowGeoIPLocation
import dev.tileflow.routing.TileflowIsochrone
import dev.tileflow.routing.TileflowIsochroneResponse
import dev.tileflow.routing.TileflowRoute
import dev.tileflow.routing.TileflowRouteResponse
import dev.tileflow.routing.TileflowRoutingNetwork
import dev.tileflow.routing.TileflowRoutingTrafficKind
import dev.tileflow.sdk.TileflowBounds
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowGeoJSONLayerKind
import dev.tileflow.sdk.TileflowLayerPlacement
import dev.tileflow.sdk.TileflowLineProgress
import dev.tileflow.sdk.TileflowRouteInk
import dev.tileflow.sdk.TileflowRouteInks
import dev.tileflow.testing.Contract
import dev.tileflow.testing.failure
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServiceContentTest {
    private fun positions(coordinates: JSONArray): List<TileflowPosition> =
        List(coordinates.length()) {
            coordinates.getJSONArray(it).let { position ->
                TileflowPosition(position.getDouble(0), position.getDouble(1))
            }
        }

    /** The contract's route answer: two routes of 531 and 709 positions. */
    private val routes: TileflowRouteResponse by lazy {
        val answer = Contract.operation("routing.route").getJSONObject("response")
        val routes = answer.getJSONArray("routes")
        TileflowRouteResponse(
            List(routes.length()) {
                val route = routes.getJSONObject(it)
                TileflowRoute(
                    route.getDouble("distance"),
                    route.getDouble("duration"),
                    route.getBoolean("hasTolls"),
                    route.getBoolean("hasHighways"),
                    route.getBoolean("hasFerries"),
                    positions(route.getJSONObject("geometry").getJSONArray("coordinates")),
                    emptyList(),
                )
            },
            TileflowRoutingNetwork(answer.getJSONObject("network").getString("releaseId")),
            answer.getString("attribution"),
            TileflowRoutingTrafficKind.NONE,
            5,
        )
    }

    private val isochrones: TileflowIsochroneResponse by lazy {
        val answer = Contract.operation("routing.isochrone").getJSONObject("response")
        val features = answer.getJSONObject("isochrones").getJSONArray("features")
        TileflowIsochroneResponse(
            List(features.length()) {
                val feature = features.getJSONObject(it)
                val rings = feature.getJSONObject("geometry").getJSONArray("coordinates")
                TileflowIsochrone(
                    feature.getJSONObject("properties").getInt("minutes"),
                    listOf(List(rings.length()) { ring -> positions(rings.getJSONArray(ring)) }),
                )
            },
            TileflowRoutingNetwork("routing-v1"),
            "© OpenStreetMap contributors",
            TileflowRoutingTrafficKind.NONE,
            5,
        )
    }

    private fun isochroneSpecs(prefix: String) =
        TileflowIsochroneLayers.specs(isochrones, null, 0.18, prefix)

    private fun lines(geoJson: String): List<List<TileflowPosition>> {
        val features = JSONObject(geoJson).getJSONArray("features")
        return List(features.length()) {
            val geometry = features.getJSONObject(it).getJSONObject("geometry")
            positions(geometry.getJSONArray("coordinates"))
        }
    }

    private fun rounded(position: TileflowPosition) =
        TileflowPosition(
            GeoJson.number(position.longitude).toDouble(),
            GeoJson.number(position.latitude).toDouble(),
        )

    @Test
    fun routeLayersFollowTheDrawOrderAndKeepTheFullGeometry() {
        // By default the map draws the layers in the route inks of the theme on screen.
        val specs = TileflowRouteLayers.specs(routes, 0, null, null, "route")
        assertEquals(
            listOf("route-alternatives", "route-glow", "route-casing", "route-line", "route-core"),
            specs.map { it.id },
        )
        assertEquals(listOf(5.0, 16.0, 9.0, 6.0, 2.0), specs.map { it.size })
        assertEquals(
            listOf(
                TileflowRouteInk.ALTERNATIVE,
                TileflowRouteInk.GLOW,
                TileflowRouteInk.CASING,
                TileflowRouteInk.LINE,
                TileflowRouteInk.CORE,
            ),
            specs.map { it.ink },
        )
        assertTrue(specs.all { it.placement == TileflowLayerPlacement.GROUND })
        assertEquals(listOf(0.0, 0.0, 0.0, 0.35, 0.0), specs.map { it.occludedOpacity })
        assertTrue(specs.all { it.kind == TileflowGeoJSONLayerKind.LINE })
        // Every position reaches the map, rounded to six decimals.
        val original = routes.routes[0].geometry
        assertEquals(original.map(::rounded), lines(specs.last().geoJson).single())
        assertEquals(routes.routes[1].geometry.size, lines(specs.first().geoJson).single().size)
        assertFalse(Regex("\\.[0-9]{7}").containsMatchIn(specs.joinToString { it.geoJson }))
        // The selected route's layers share one payload, which the map receives once.
        assertEquals(1, specs.drop(1).map { it.geoJson }.toSet().size)

        val layers = TileflowRouteLayers.build(routes)
        assertEquals(specs.map { it.id }, layers.map { it.id })
    }

    @Test
    fun fixedInksDrawFixedColoursAndProgressReachesTheChosenRoute() {
        val specs =
            TileflowRouteLayers.specs(
                routes,
                1,
                TileflowRouteInks.LIGHT,
                TileflowLineProgress(end = 0.0),
                "trip",
            )
        assertEquals(
            listOf("trip-alternatives", "trip-glow", "trip-casing", "trip-line", "trip-core"),
            specs.map { it.id },
        )
        assertEquals(
            listOf("#94a3b8", "#2563eb", "#1e3a8a", "#2563eb", "#dbeafe"),
            specs.map { it.color },
        )
        // A theme's zero opacity keeps the layer, invisible, so its progress can still move.
        assertEquals(listOf(1.0, 0.16, 1.0, 1.0, 0.0), specs.map { it.opacity })
        assertTrue(specs.all { it.ink == null })
        assertEquals(listOf(null, "#ffffff", "#ffffff", "#ffffff", "#ffffff"), specs.map {
            it.progress?.highlight
        })
        assertEquals(TileflowRouteLayers.progressLayers("trip"), specs.drop(1).map { it.id })
        fun firstId(geoJson: String) =
            JSONObject(geoJson).getJSONArray("features").getJSONObject(0).getInt("id")
        assertEquals(0, firstId(specs[0].geoJson))
        assertEquals(1, firstId(specs[4].geoJson))
        val single = routes.copy(routes = routes.routes.take(1))
        assertEquals(
            listOf("route-glow", "route-casing", "route-line", "route-core"),
            TileflowRouteLayers.build(single).map { it.id },
        )
    }

    @Test
    fun invalidArgumentsFail() {
        failure<IllegalArgumentException> { TileflowRouteLayers.build(routes, selected = 2) }
        failure<IllegalArgumentException> { TileflowRouteLayers.build(routes, idPrefix = "-route") }
        failure<IllegalArgumentException> {
            TileflowRouteLayers.build(routes, idPrefix = "r".repeat(52))
        }
        failure<IllegalArgumentException> {
            TileflowRouteLayers.build(routes, inks = TileflowRouteInks.LIGHT.copy(line = "blue"))
        }
        failure<IllegalArgumentException> {
            TileflowRouteLayers.build(
                routes,
                inks = TileflowRouteInks.LIGHT.copy(glowOpacity = 1.5),
            )
        }
        failure<IllegalArgumentException> {
            TileflowIsochroneLayers.build(isochrones, opacity = 2.0)
        }
    }

    @Test
    fun coordinatesHaveAtMostSixDecimals() {
        assertEquals("1", GeoJson.number(1.0))
        assertEquals("25.7655", GeoJson.number(25.7655))
        assertEquals("-80.219507", GeoJson.number(-80.2195071))
        assertEquals("0", GeoJson.number(-0.0000004))
        assertEquals("180", GeoJson.number(179.9999996))
        assertEquals("0.000001", GeoJson.number(0.000001))
    }

    @Test
    fun isochroneLayersDrawTheLongestTimeFirst() {
        val specs = isochroneSpecs("isochrone")
        assertEquals(listOf("isochrone-10", "isochrone-5"), specs.map { it.id })
        assertTrue(specs.all { it.kind == TileflowGeoJSONLayerKind.FILL })
        assertTrue(specs.all { it.ink == TileflowRouteInk.LINE && it.opacity == 0.18 })
        assertTrue(
            TileflowIsochroneLayers.specs(isochrones, TileflowRouteInks.DARK, 0.18, "i").all {
                it.color == TileflowRouteInks.DARK.line && it.ink == null
            }
        )
        val feature = JSONObject(specs[1].geoJson).getJSONArray("features").getJSONObject(0)
        assertEquals(5, feature.getJSONObject("properties").getInt("minutes"))
        assertEquals("Polygon", feature.getJSONObject("geometry").getString("type"))
        assertEquals(specs.map { it.id }, TileflowIsochroneLayers.build(isochrones).map { it.id })
    }

    @Test
    fun isochroneRingsKeepTheirFullGeometry() {
        for ((spec, isochrone) in
            isochroneSpecs("area").zip(isochrones.isochrones.sortedByDescending { it.minutes })) {
            val rings =
                JSONObject(spec.geoJson).getJSONArray("features").getJSONObject(0)
                    .getJSONObject("geometry").getJSONArray("coordinates")
            val ring = positions(rings.getJSONArray(0))
            assertEquals(isochrone.polygons[0][0].map(::rounded), ring)
            assertEquals(ring.first(), ring.last())
        }
    }

    @Test
    fun theProfileMarkerFollowsADistance() {
        val profile =
            TileflowElevationProfile(
                TileflowElevationUnit.METERS,
                TileflowElevationDataset("terrain", 14),
                "© Mapterhorn contributors",
                1,
                100.0,
                listOf(
                    TileflowElevationSample(TileflowPosition(-3.7038, 40.4168), 650.0, 0.0),
                    TileflowElevationSample(TileflowPosition(-3.7026, 40.4168), 654.0, 100.0),
                ),
                listOf(0..1),
                TileflowElevationProfileSummary(
                    distance = 100.0,
                    ascent = 4.0,
                    descent = 0.0,
                    minElevation = 650.0,
                    maxElevation = 654.0,
                    startElevation = 650.0,
                    endElevation = 654.0,
                    maxGrade = 4.0,
                    minGrade = null,
                ),
            )
        val marker = TileflowElevationProfileMarker.annotation(profile, atDistance = 25.0)!!
        assertEquals("elevation-profile-position", marker.id)
        assertEquals(TileflowRouteInks.LIGHT.line, marker.color)
        assertEquals(-3.7035, marker.coordinate.longitude, 1e-9)
        assertEquals(40.4168, marker.coordinate.latitude, 1e-9)
        assertNull(TileflowElevationProfileMarker.annotation(profile, atDistance = Double.NaN))
    }

    @Test
    fun camerasAndConversions() {
        val position = TileflowPosition(-3.7038, 40.4168)
        assertEquals(TileflowCoordinate(-3.7038, 40.4168), TileflowCoordinate(position))
        assertEquals(position, TileflowPosition(TileflowCoordinate(position)))
        assertEquals(
            TileflowBounds(-3.8, 40.3, -3.6, 40.5),
            TileflowBounds(TileflowBoundingBox(-3.8, 40.3, -3.6, 40.5)),
        )
        assertEquals(position, TileflowCamera(-3.7038, 40.4168, 9.0).searchProximity)
        assertNull(TileflowCamera(-3.7038, 40.4168, 8.99).searchProximity)
        assertEquals(-170.0, TileflowCamera(190.0, 0.0, 12.0).searchProximity!!.longitude, 1e-9)

        val madrid = TileflowGeoIPLocation(city = "Madrid", region = "Madrid", position = position)
        assertEquals(TileflowCamera(-3.7038, 40.4168, 10.0), TileflowGeoIPCamera.from(madrid))
        assertEquals(7.0, TileflowGeoIPCamera.from(madrid.copy(city = null))!!.zoom, 0.0)
        val spain = TileflowGeoIPLocation(countryCode = "ES", position = position)
        assertEquals(4.0, TileflowGeoIPCamera.from(spain)!!.zoom, 0.0)
        assertNull(TileflowGeoIPCamera.from(madrid.copy(position = null)))
    }
}
