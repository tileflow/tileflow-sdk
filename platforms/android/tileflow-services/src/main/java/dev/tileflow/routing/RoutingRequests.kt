package dev.tileflow.routing

import dev.tileflow.configuration.TileflowPosition

/** How the traveller moves. */
public enum class TileflowRoutingMode(internal val wireName: String) {
    DRIVING("driving"),
    WALKING("walking"),
    CYCLING("cycling"),
    TRUCK("truck"),
}

/** Road kinds a request may ask to avoid. Avoidance is a strong preference, not an exclusion. */
public enum class TileflowRoutingAvoidance(internal val wireName: String) {
    TOLLS("tolls"),
    HIGHWAYS("highways"),
    FERRIES("ferries"),
}

/** The traffic a request uses. */
public enum class TileflowRoutingTraffic(internal val wireName: String) {
    NONE("none"),
}

/** The languages instructions can be written in. */
public enum class TileflowRoutingLanguage(internal val wireName: String) {
    AR_SA("ar-SA"),
    BG_BG("bg-BG"),
    CA_ES("ca-ES"),
    CS_CZ("cs-CZ"),
    DA_DK("da-DK"),
    DE_DE("de-DE"),
    EL_GR("el-GR"),
    EN_AU("en-AU"),
    EN_GB("en-GB"),
    EN_US("en-US"),
    ES_ES("es-ES"),
    ET_EE("et-EE"),
    FI_FI("fi-FI"),
    FR_FR("fr-FR"),
    HI_IN("hi-IN"),
    HU_HU("hu-HU"),
    IT_IT("it-IT"),
    JA_JP("ja-JP"),
    KO_KR("ko-KR"),
    MN_MN("mn-MN"),
    NB_NO("nb-NO"),
    NL_NL("nl-NL"),
    PL_PL("pl-PL"),
    PT_BR("pt-BR"),
    PT_PT("pt-PT"),
    RO_RO("ro-RO"),
    RU_RU("ru-RU"),
    SK_SK("sk-SK"),
    SL_SI("sl-SI"),
    SV_SE("sv-SE"),
    TR_TR("tr-TR"),
    UK_UA("uk-UA"),
    VI_VN("vi-VN"),
}

/**
 * The dimensions of a truck, which its route respects where OpenStreetMap records limits. Only
 * for [TileflowRoutingMode.TRUCK].
 */
public data class TileflowVehicle(
    /** 1 to 10 metres. */
    public val heightMeters: Double? = null,
    /** 1 to 5 metres. */
    public val widthMeters: Double? = null,
    /** 1 to 40 metres. */
    public val lengthMeters: Double? = null,
    /** 0.5 to 100 tonnes. */
    public val weightTonnes: Double? = null,
    /** 0.5 to 40 tonnes. */
    public val axleLoadTonnes: Double? = null,
    /** 2 to 20 axles. */
    public val axleCount: Int? = null,
    public val hazardousMaterials: Boolean? = null,
)

/**
 * The fastest route through 2 to 5 locations. The straight-line length of the locations is at
 * most 1,000 km driving or by truck, 300 km cycling and 100 km walking.
 *
 * @property alternatives 0 to 2 other routes, only between two locations.
 */
public data class TileflowRouteRequest(
    public val locations: List<TileflowPosition>,
    public val mode: TileflowRoutingMode,
    public val vehicle: TileflowVehicle? = null,
    public val avoid: List<TileflowRoutingAvoidance> = emptyList(),
    public val traffic: TileflowRoutingTraffic? = null,
    public val alternatives: Int = 0,
    public val language: TileflowRoutingLanguage? = null,
)

/**
 * The areas reachable from a location.
 *
 * @property minutes 1 to 4 times of 1 to 60 minutes, strictly rising.
 */
public data class TileflowIsochroneRequest(
    public val location: TileflowPosition,
    public val mode: TileflowRoutingMode,
    public val minutes: List<Int>,
    public val vehicle: TileflowVehicle? = null,
    public val avoid: List<TileflowRoutingAvoidance> = emptyList(),
    public val traffic: TileflowRoutingTraffic? = null,
)

/**
 * Travel times and distances from 1 to 25 sources to 1 to 25 targets. Each source is at most
 * 200 km from each target driving or by truck, and 10 km walking or cycling.
 */
public data class TileflowMatrixRequest(
    public val sources: List<TileflowPosition>,
    public val targets: List<TileflowPosition>,
    public val mode: TileflowRoutingMode,
    public val vehicle: TileflowVehicle? = null,
    public val avoid: List<TileflowRoutingAvoidance> = emptyList(),
    public val traffic: TileflowRoutingTraffic? = null,
)

/**
 * A GPS trace of 2 to 100 positions to match to the roads it followed. Consecutive positions are
 * at most 2 km apart and the whole trace at most 200 km long.
 *
 * @property timestamps Seconds since the Unix epoch, one per position, never decreasing.
 * @property accuracy The GPS accuracy, 1 to 100 metres.
 */
public data class TileflowMatchRequest(
    public val trace: List<TileflowPosition>,
    public val mode: TileflowRoutingMode,
    public val timestamps: List<Long>? = null,
    public val accuracy: Double? = null,
    public val vehicle: TileflowVehicle? = null,
)

/** The road nearest to a location that the mode can use. */
public data class TileflowNearestRequest(
    public val location: TileflowPosition,
    public val mode: TileflowRoutingMode,
)
