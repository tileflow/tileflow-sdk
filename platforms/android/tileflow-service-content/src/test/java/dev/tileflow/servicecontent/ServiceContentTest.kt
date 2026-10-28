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

    private fun isochroneSpecs(prefix: String, maximumBytes: Int) =
        TileflowIsochroneLayers.specs(
            isochrones,
            TileflowRouteInks.LIGHT,
            0.18,
            prefix,
            maximumBytes,
        )

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
    fun routeLayersFollowTheDrawOrderAndFitTheBudget() {
        val raw = GeoJson.lines(listOf(0 to routes.routes[0].geometry)).length * 3 +
            GeoJson.lines(listOf(1 to routes.routes[1].geometry)).length
        assertTrue("The contract routes exceed the default budget.", raw > 40_000)

        val specs = TileflowRouteLayers.specs(routes, 0, TileflowRouteInks.LIGHT, "route", 40_000)
        assertEquals(
            listOf("route-alternatives", "route-glow", "route-casing", "route-line"),
            specs.map { it.id },
        )
        assertEquals(listOf(5.0, 16.0, 9.0, 6.0), specs.map { it.size })
        assertEquals(listOf(1.0, 0.16, 1.0, 1.0), specs.map { it.opacity })
        assertEquals(listOf("#94a3b8", "#2563eb", "#1e3a8a", "#2563eb"), specs.map { it.color })
        assertTrue(specs.all { it.kind == TileflowGeoJSONLayerKind.LINE })
        assertTrue(specs.sumOf { it.geoJson.length } <= 40_000)
        assertTrue(specs.all { it.geoJson.length <= 49_152 })

        val line = lines(specs.last().geoJson).single()
        val original = routes.routes[0].geometry
        assertTrue(line.size in 2 until original.size)
        assertEquals(rounded(original.first()), line.first())
        assertEquals(rounded(original.last()), line.last())
        assertEquals(1, lines(specs.first().geoJson).size)
        assertFalse(Regex("\\.[0-9]{7}").containsMatchIn(specs.joinToString { it.geoJson }))

        val layers = TileflowRouteLayers.build(routes)
        assertEquals(specs.map { it.id }, layers.map { it.id })
    }

    @Test
    fun darkInksDrawTheCoreAndAnySelectedRouteCanBeChosen() {
        val specs = TileflowRouteLayers.specs(routes, 1, TileflowRouteInks.DARK, "trip", 40_000)
        assertEquals(
            listOf("trip-alternatives", "trip-glow", "trip-casing", "trip-line", "trip-core"),
            specs.map { it.id },
        )
        fun firstId(geoJson: String) =
            JSONObject(geoJson).getJSONArray("features").getJSONObject(0).getInt("id")
        assertEquals(0, firstId(specs[0].geoJson))
        assertEquals(1, firstId(specs[4].geoJson))
        val single = routes.copy(routes = routes.routes.take(1))
        assertEquals(
            listOf("route-glow", "route-casing", "route-line"),
            TileflowRouteLayers.build(single).map { it.id },
        )
    }

    @Test
    fun smallerBudgetsSimplifyFurtherAndImpossibleOnesFail() {
        val specs = TileflowRouteLayers.specs(routes, 0, TileflowRouteInks.LIGHT, "route", 4_000)
        assertTrue(specs.sumOf { it.geoJson.length } <= 4_000)
        assertTrue(lines(specs.last().geoJson).single().size >= 2)
        failure<IllegalArgumentException> { TileflowRouteLayers.build(routes, maximumBytes = 100) }
        failure<IllegalArgumentException> { TileflowRouteLayers.build(routes, selected = 2) }
        failure<IllegalArgumentException> { TileflowRouteLayers.build(routes, idPrefix = "-route") }
        failure<IllegalArgumentException> {
            TileflowRouteLayers.build(routes, idPrefix = "r".repeat(52))
        }
        failure<IllegalArgumentException> {
            TileflowRouteInks.LIGHT.copy(line = "blue")
        }
        failure<IllegalArgumentException> { TileflowRouteInks.LIGHT.copy(glowOpacity = 1.5) }
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
    fun simplificationKeepsEndsAndRingsKeepFourPositions() {
        val straight = List(11) { TileflowPosition(it / 10.0, 0.0) }
        assertEquals(straight, Simplification.line(straight, 0.0))
        assertEquals(listOf(straight.first(), straight.last()), Simplification.line(straight, 1e-6))
        val bent = straight + TileflowPosition(1.0, 1.0)
        assertEquals(
            listOf(straight.first(), straight.last(), bent.last()),
            Simplification.line(bent, 1e-3),
        )
        val ring =
            List(40) {
                val angle = it * Math.PI * 2 / 40
                TileflowPosition(Math.cos(angle) * 1e-4, Math.sin(angle) * 1e-4)
            } + TileflowPosition(1e-4, 0.0)
        val collapsed = Simplification.ring(ring, 1.0)
        assertEquals(4, collapsed.size)
        assertEquals(collapsed.first(), collapsed.last())
        assertEquals(3, collapsed.toSet().size)
    }

    @Test
    fun isochroneLayersDrawTheLongestTimeFirst() {
        val specs = isochroneSpecs("isochrone", 40_000)
        assertEquals(listOf("isochrone-10", "isochrone-5"), specs.map { it.id })
        assertTrue(specs.all { it.kind == TileflowGeoJSONLayerKind.FILL })
        assertTrue(specs.all { it.color == TileflowRouteInks.LIGHT.line && it.opacity == 0.18 })
        val feature = JSONObject(specs[1].geoJson).getJSONArray("features").getJSONObject(0)
        assertEquals(5, feature.getJSONObject("properties").getInt("minutes"))
        assertEquals("Polygon", feature.getJSONObject("geometry").getString("type"))
        assertEquals(specs.map { it.id }, TileflowIsochroneLayers.build(isochrones).map { it.id })
    }

    @Test
    fun isochroneRingsSimplifyToTheBudgetWithoutCollapsing() {
        val budget = isochroneSpecs("isochrone", 40_000).sumOf { it.geoJson.length } - 200
        val specs = isochroneSpecs("area", budget)
        assertTrue(specs.sumOf { it.geoJson.length } <= budget)
        for (spec in specs) {
            val rings =
                JSONObject(spec.geoJson).getJSONArray("features").getJSONObject(0)
                    .getJSONObject("geometry").getJSONArray("coordinates")
            val ring = positions(rings.getJSONArray(0))
            assertTrue(ring.size >= 4)
            assertEquals(ring.first(), ring.last())
        }
        failure<IllegalArgumentException> {
            TileflowIsochroneLayers.build(isochrones, maximumBytes = 50)
        }
        failure<IllegalArgumentException> {
            TileflowIsochroneLayers.build(isochrones, opacity = 2.0)
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
