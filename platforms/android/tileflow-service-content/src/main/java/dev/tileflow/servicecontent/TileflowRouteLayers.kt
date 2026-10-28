package dev.tileflow.servicecontent

import dev.tileflow.routing.TileflowRouteResponse
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind

/**
 * Map layers for a route answer, in draw order: `<idPrefix>-alternatives` (every other route),
 * `-glow`, `-casing`, `-line` and `-core` (the selected route). A layer whose ink has no opacity,
 * and the alternatives of a single route, are left out. Lines are simplified until all the layers
 * together fit [maximumBytes] of GeoJSON, leaving room in the map's content for other layers and
 * annotations.
 */
public object TileflowRouteLayers {
    private val ID_PREFIX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$")

    /**
     * @param selected The index of the route drawn as the chosen one.
     * @throws IllegalArgumentException when an argument is invalid or the routes cannot fit
     *   [maximumBytes].
     */
    @JvmStatic
    @JvmOverloads
    public fun build(
        response: TileflowRouteResponse,
        selected: Int = 0,
        inks: TileflowRouteInks = TileflowRouteInks.LIGHT,
        idPrefix: String = "route",
        maximumBytes: Int = 40_000,
    ): List<TileflowGeoJSONLayer> =
        specs(response, selected, inks, idPrefix, maximumBytes).map { it.layer() }

    internal fun specs(
        response: TileflowRouteResponse,
        selected: Int,
        inks: TileflowRouteInks,
        idPrefix: String,
        maximumBytes: Int,
    ): List<LayerSpec> {
        require(selected in response.routes.indices) { "Select one of the routes." }
        require(ID_PREFIX.matches(idPrefix)) { "The layer id prefix is not a valid layer id." }
        require(maximumBytes > 0) { "The byte budget must be positive." }
        require(response.routes.all { it.geometry.size >= 2 }) { "Routes need two positions." }
        val route = response.routes[selected]
        val others = response.routes.withIndex().filter { it.index != selected }
        val routeLayers =
            2 + (if (inks.glowOpacity > 0) 1 else 0) + (if (inks.coreOpacity > 0) 1 else 0)
        for (tolerance in Simplification.tolerances) {
            val line =
                GeoJson.lines(listOf(selected to Simplification.line(route.geometry, tolerance)))
            val alternatives =
                if (others.isEmpty()) null
                else
                    GeoJson.lines(
                        others.map { it.index to Simplification.line(it.value.geometry, tolerance) }
                    )
            val alternativeBytes = alternatives?.length ?: 0
            if (
                line.length > GeoJson.MAXIMUM_LAYER_BYTES ||
                    alternativeBytes > GeoJson.MAXIMUM_LAYER_BYTES ||
                    line.length * routeLayers + alternativeBytes > maximumBytes
            )
                continue
            fun layer(
                suffix: String,
                geoJson: String,
                color: String,
                size: Double,
                opacity: Double,
            ) =
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
        throw IllegalArgumentException("The routes cannot fit $maximumBytes bytes.")
    }
}
