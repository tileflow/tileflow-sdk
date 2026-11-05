package dev.tileflow.geoip

import dev.tileflow.configuration.TileflowPosition

/** A continent code. Codes added later decode as their own values. */
@JvmInline
public value class TileflowGeoIPContinent(public val value: String) {
    override fun toString(): String = value

    public companion object {
        public val AFRICA: TileflowGeoIPContinent = TileflowGeoIPContinent("AF")
        public val ANTARCTICA: TileflowGeoIPContinent = TileflowGeoIPContinent("AN")
        public val ASIA: TileflowGeoIPContinent = TileflowGeoIPContinent("AS")
        public val EUROPE: TileflowGeoIPContinent = TileflowGeoIPContinent("EU")
        public val NORTH_AMERICA: TileflowGeoIPContinent = TileflowGeoIPContinent("NA")
        public val OCEANIA: TileflowGeoIPContinent = TileflowGeoIPContinent("OC")
        public val SOUTH_AMERICA: TileflowGeoIPContinent = TileflowGeoIPContinent("SA")

    }
}

/**
 * The approximate geography of a network connection. Every field is optional; at least one is
 * present.
 *
 * @property countryCode ISO 3166-1 alpha-2.
 * @property isEuCountry Whether the country is a member of the European Union.
 * @property position An approximate position, never a precise one.
 * @property timezone An IANA time zone.
 */
public data class TileflowGeoIPLocation(
    public val city: String? = null,
    public val continentCode: TileflowGeoIPContinent? = null,
    public val countryCode: String? = null,
    public val isEuCountry: Boolean? = null,
    public val position: TileflowPosition? = null,
    public val postalCode: String? = null,
    public val region: String? = null,
    public val regionCode: String? = null,
    public val timezone: String? = null,
)

/**
 * A GeoIP answer.
 *
 * @property location The approximate location, or null when none is available.
 * @property units The API units the operation consumed: 0 for anonymous access.
 */
public data class TileflowGeoIPResponse(
    public val location: TileflowGeoIPLocation?,
    public val units: Int,
)

