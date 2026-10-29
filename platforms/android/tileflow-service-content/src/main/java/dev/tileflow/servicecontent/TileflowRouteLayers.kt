package dev.tileflow.servicecontent

import dev.tileflow.routing.TileflowRouteResponse
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind
import dev.tileflow.sdk.TileflowLineProgress
import dev.tileflow.sdk.TileflowRouteInk
import dev.tileflow.sdk.TileflowRouteInks

/**
 * Map layers for a route answer, in draw order: `<idPrefix>-alternatives` (every other route, left
 * out for a single route), `-glow`, `-casing`, `-line` and `-core` (the selected route).
 *
 * By default the layers are drawn in the route inks of the theme on screen and follow theme
 * changes and blends; a theme without a glow or a core hides that layer by its opacity. Pass inks
 * to draw them in fixed colours instead. The layers lie on the ground, under the map's labels and
 * 3D buildings, and the line shows faintly where a building hides it. Each layer keeps the full
 * geometry, with coordinates rounded to six decimals (about 0.1 m); the glow, casing, line and core
 * share one GeoJSON, which the map receives once.
 */
public object TileflowRouteLayers {
    private val ID_PREFIX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$")
    private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

    /**
     * @param selected The index of the route drawn as the chosen one.
     * @param inks Fixed colours, or null for the route inks of the theme on screen.
     * @param progress Draws only a stretch of the chosen route, with a white head and light by
     *   default; [progressLayers] names the layers to animate.
     * @throws IllegalArgumentException when an argument is invalid.
     */
    @JvmStatic
    @JvmOverloads
    public fun build(
        response: TileflowRouteResponse,
        selected: Int = 0,
        inks: TileflowRouteInks? = null,
        progress: TileflowLineProgress? = null,
        idPrefix: String = "route",
    ): List<TileflowGeoJSONLayer> =
        specs(response, selected, inks, progress, idPrefix).map { it.layer() }

    /** The layers of [build] drawn with progress, to pass to `animateLineProgress`. */
    @JvmStatic
    @JvmOverloads
    public fun progressLayers(idPrefix: String = "route"): List<String> =
        listOf("glow", "casing", "line", "core").map { "$idPrefix-$it" }

    internal fun specs(
        response: TileflowRouteResponse,
        selected: Int,
        inks: TileflowRouteInks?,
        progress: TileflowLineProgress?,
        idPrefix: String,
    ): List<LayerSpec> {
        require(selected in response.routes.indices) { "Select one of the routes." }
        require(ID_PREFIX.matches(idPrefix)) { "The layer id prefix is not a valid layer id." }
        require(response.routes.all { it.geometry.size >= 2 }) { "Routes need two positions." }
        if (inks != null) {
            require(TileflowRouteInk.entries.all { COLOR.matches(inks[it]) }) {
                "Route inks are #rrggbb colours."
            }
            require(inks.glowOpacity in 0.0..1.0 && inks.coreOpacity in 0.0..1.0) {
                "Route ink opacities run from 0 to 1."
            }
        }
        val drawn =
            progress?.let { if (it.highlight == null) it.copy(highlight = "#ffffff") else it }
        // Each line feature's id is its route's index, so a tap on the map can tell routes apart.
        val line = GeoJson.lines(listOf(selected to response.routes[selected].geometry))
        val others = response.routes.withIndex().filter { it.index != selected }
        val alternatives =
            if (others.isEmpty()) null
            else GeoJson.lines(others.map { it.index to it.value.geometry })
        fun layer(
            suffix: String,
            geoJson: String,
            ink: TileflowRouteInk,
            size: Double,
            occludedOpacity: Double = 0.0,
            progress: TileflowLineProgress? = null,
        ) =
            LayerSpec(
                "$idPrefix-$suffix",
                geoJson,
                TileflowGeoJSONLayerKind.LINE,
                (inks ?: TileflowRouteInks.LIGHT)[ink],
                size,
                when {
                    inks == null -> 1.0
                    ink == TileflowRouteInk.GLOW -> inks.glowOpacity
                    ink == TileflowRouteInk.CORE -> inks.coreOpacity
                    else -> 1.0
                },
                ink = if (inks == null) ink else null,
                occludedOpacity = occludedOpacity,
                progress = progress,
            )
        return listOfNotNull(
            alternatives?.let { layer("alternatives", it, TileflowRouteInk.ALTERNATIVE, 5.0) },
            layer("glow", line, TileflowRouteInk.GLOW, 16.0, progress = drawn),
            layer("casing", line, TileflowRouteInk.CASING, 9.0, progress = drawn),
            layer(
                "line",
                line,
                TileflowRouteInk.LINE,
                6.0,
                occludedOpacity = 0.35,
                progress = drawn,
            ),
            layer("core", line, TileflowRouteInk.CORE, 2.0, progress = drawn),
        )
    }
}
