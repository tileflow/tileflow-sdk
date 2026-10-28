package dev.tileflow.servicecontent

/**
 * How a route is drawn, from its outer glow to its bright core. Colours are `#rrggbb`; opacities
 * run from 0, which leaves that layer out, to 1. [LIGHT] and [DARK] are the inks of a theme that
 * sets no route inks of its own.
 *
 * @property line The chosen route's line.
 * @property casing The edge on each side of the line, which sets it apart from the roads below.
 * @property core A thin line along the middle of the route.
 * @property glow A soft halo around the route.
 * @property alternative Other routes offered beside the chosen one.
 */
public data class TileflowRouteInks(
    public val line: String,
    public val casing: String,
    public val core: String,
    public val glow: String,
    public val alternative: String,
    public val glowOpacity: Double,
    public val coreOpacity: Double,
) {
    init {
        require(listOf(line, casing, core, glow, alternative).all(COLOR::matches)) {
            "Route inks are #rrggbb colours."
        }
        require(glowOpacity in 0.0..1.0 && coreOpacity in 0.0..1.0) {
            "Route ink opacities run from 0 to 1."
        }
    }

    public companion object {
        private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

        /** The default inks on a light map. */
        @JvmField
        public val LIGHT: TileflowRouteInks =
            TileflowRouteInks(
                line = "#2563eb",
                casing = "#1e3a8a",
                core = "#dbeafe",
                glow = "#2563eb",
                alternative = "#94a3b8",
                glowOpacity = 0.16,
                coreOpacity = 0.0,
            )

        /** The default inks on a dark map. */
        @JvmField
        public val DARK: TileflowRouteInks =
            TileflowRouteInks(
                line = "#60a5fa",
                casing = "#0b1220",
                core = "#eff6ff",
                glow = "#60a5fa",
                alternative = "#64748b",
                glowOpacity = 0.4,
                coreOpacity = 0.7,
            )
    }
}
