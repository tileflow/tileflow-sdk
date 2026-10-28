package dev.tileflow.servicecontent

import dev.tileflow.routing.TileflowRouteResponse
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind

/**
 * Map layers for a route answer, in draw order: `<idPrefix>-alternatives` (every other route),
 * `-glow`, `-casing`, `-line` and `-core` (the selected route). A layer whose ink has no opacity,
 * and the alternatives of a single route, are left out. Each layer keeps the full geometry, with
 * coordinates rounded to six decimals (about 0.1 m); the glow, casing, line and core share one
 * GeoJSON, which the map receives once.
 */
public object TileflowRouteLayers {
    private val ID_PREFIX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$")

    /**
     * @param selected The index of the route drawn as the chosen one.
     * @throws IllegalArgumentException when an argument is invalid.
     */
    @JvmStatic
    @JvmOverloads
    public fun build(
        response: TileflowRouteResponse,
        selected: Int = 0,
        inks: TileflowRouteInks = TileflowRouteInks.LIGHT,
        idPrefix: String = "route",
    ): List<TileflowGeoJSONLayer> = specs(response, selected, inks, idPrefix).map { it.layer() }

    internal fun specs(
        response: TileflowRouteResponse,
        selected: Int,
        inks: TileflowRouteInks,
        idPrefix: String,
    ): List<LayerSpec> {
        require(selected in response.routes.indices) { "Select one of the routes." }
        require(ID_PREFIX.matches(idPrefix)) { "The layer id prefix is not a valid layer id." }
        require(response.routes.all { it.geometry.size >= 2 }) { "Routes need two positions." }
        // Each line feature's id is its route's index, so a tap on the map can tell routes apart.
        val line = GeoJson.lines(listOf(selected to response.routes[selected].geometry))
        val others = response.routes.withIndex().filter { it.index != selected }
        val alternatives =
            if (others.isEmpty()) null
            else GeoJson.lines(others.map { it.index to it.value.geometry })
        fun layer(suffix: String, geoJson: String, color: String, size: Double, opacity: Double) =
            LayerSpec(
                "$idPrefix-$suffix",
                geoJson,
                TileflowGeoJSONLayerKind.LINE,
                color,
                size,
                opacity,
            )
        return listOfNotNull(
            alternatives?.let { layer("alternatives", it, inks.alternative, 5.0, 1.0) },
            if (inks.glowOpacity > 0) layer("glow", line, inks.glow, 16.0, inks.glowOpacity)
            else null,
            layer("casing", line, inks.casing, 9.0, 1.0),
            layer("line", line, inks.line, 6.0, 1.0),
            if (inks.coreOpacity > 0) layer("core", line, inks.core, 2.0, inks.coreOpacity)
            else null,
        )
    }
}
