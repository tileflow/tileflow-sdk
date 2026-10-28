package dev.tileflow.servicecontent

import dev.tileflow.routing.TileflowIsochroneResponse
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind

/**
 * One fill layer per isochrone, `<idPrefix>-<minutes>`, the longest time first so that shorter
 * times draw over it. Rings are simplified, never below four positions, until all the layers
 * together fit [maximumBytes] of GeoJSON.
 */
public object TileflowIsochroneLayers {
    private val ID_PREFIX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$")

    /**
     * @param opacity The opacity of each fill, from 0 to 1. Overlapping fills add up.
     * @throws IllegalArgumentException when an argument is invalid or the areas cannot fit
     *   [maximumBytes].
     */
    @JvmStatic
    @JvmOverloads
    public fun build(
        response: TileflowIsochroneResponse,
        inks: TileflowRouteInks = TileflowRouteInks.LIGHT,
        opacity: Double = 0.18,
        idPrefix: String = "isochrone",
        maximumBytes: Int = 40_000,
    ): List<TileflowGeoJSONLayer> =
        specs(response, inks, opacity, idPrefix, maximumBytes).map { it.layer() }

    internal fun specs(
        response: TileflowIsochroneResponse,
        inks: TileflowRouteInks,
        opacity: Double,
        idPrefix: String,
        maximumBytes: Int,
    ): List<LayerSpec> {
        require(opacity in 0.0..1.0) { "The opacity runs from 0 to 1." }
        require(ID_PREFIX.matches(idPrefix)) { "The layer id prefix is not a valid layer id." }
        require(maximumBytes > 0) { "The byte budget must be positive." }
        val isochrones = response.isochrones.sortedByDescending { it.minutes }
        require(isochrones.map { it.minutes }.toSet().size == isochrones.size) {
            "Each isochrone needs its own time."
        }
        require(
            isochrones.all { isochrone ->
                isochrone.polygons.isNotEmpty() &&
                    isochrone.polygons.all { rings ->
                        rings.isNotEmpty() && rings.all { it.size >= 4 }
                    }
            }
        ) {
            "Isochrones need polygons with closed rings."
        }
        for (tolerance in Simplification.tolerances) {
            val areas =
                isochrones.map { isochrone ->
                    isochrone.minutes to
                        GeoJson.area(
                            isochrone.minutes,
                            isochrone.polygons.map { rings ->
                                rings.map { Simplification.ring(it, tolerance) }
                            },
                        )
                }
            if (
                areas.any { it.second.length > GeoJson.MAXIMUM_LAYER_BYTES } ||
                    areas.sumOf { it.second.length } > maximumBytes
            )
                continue
            return areas.map { (minutes, geoJson) ->
                LayerSpec(
                    "$idPrefix-$minutes",
                    geoJson,
                    TileflowGeoJSONLayerKind.FILL,
                    inks.line,
                    6.0,
                    opacity,
                )
            }
        }
        throw IllegalArgumentException("The isochrones cannot fit $maximumBytes bytes.")
    }
}
