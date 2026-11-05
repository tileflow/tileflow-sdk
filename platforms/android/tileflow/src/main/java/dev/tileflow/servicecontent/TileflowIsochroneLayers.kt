package dev.tileflow.servicecontent

import dev.tileflow.routing.TileflowIsochroneResponse
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind
import dev.tileflow.sdk.TileflowRouteInk
import dev.tileflow.sdk.TileflowRouteInks

/**
 * One fill layer per isochrone, `<idPrefix>-<minutes>`, the longest time first so that shorter
 * times draw over it. Rings keep their full geometry, with coordinates rounded to six decimals.
 * The fills are drawn in the route line ink of the theme on screen unless inks fix their colour,
 * and lie on the ground under the map's labels and 3D buildings.
 */
public object TileflowIsochroneLayers {
    private val ID_PREFIX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$")

    /**
     * @param inks Fixed colours, or null for the route inks of the theme on screen.
     * @param opacity The opacity of each fill, from 0 to 1. Overlapping fills add up.
     * @throws IllegalArgumentException when an argument is invalid.
     */
    @JvmStatic
    @JvmOverloads
    public fun build(
        response: TileflowIsochroneResponse,
        inks: TileflowRouteInks? = null,
        opacity: Double = 0.18,
        idPrefix: String = "isochrone",
    ): List<TileflowGeoJSONLayer> = specs(response, inks, opacity, idPrefix).map { it.layer() }

    internal fun specs(
        response: TileflowIsochroneResponse,
        inks: TileflowRouteInks?,
        opacity: Double,
        idPrefix: String,
    ): List<LayerSpec> {
        require(opacity in 0.0..1.0) { "The opacity runs from 0 to 1." }
        require(ID_PREFIX.matches(idPrefix)) { "The layer id prefix is not a valid layer id." }
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
        return isochrones.map { isochrone ->
            LayerSpec(
                "$idPrefix-${isochrone.minutes}",
                GeoJson.area(isochrone.minutes, isochrone.polygons),
                TileflowGeoJSONLayerKind.FILL,
                (inks ?: TileflowRouteInks.LIGHT).line,
                6.0,
                opacity,
                ink = if (inks == null) TileflowRouteInk.LINE else null,
            )
        }
    }
}
