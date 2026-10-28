package dev.tileflow.geoip

import android.content.Context
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.configuration.internal.TileflowJsonObject
import dev.tileflow.configuration.internal.TileflowServiceContext
import dev.tileflow.configuration.internal.TileflowServiceErrors
import dev.tileflow.configuration.internal.TileflowServiceTransport
import dev.tileflow.configuration.internal.TileflowText
import dev.tileflow.configuration.internal.invalidResponse
import dev.tileflow.configuration.internal.requireResponse
import okhttp3.OkHttpClient
import org.json.JSONObject

/** The codes of GeoIP error answers, with the HTTP status the API gives each one. */
public enum class TileflowGeoIPErrorCode(public val wireName: String, public val status: Int) {
    ABORTED("GEOIP_ABORTED", 499),
    ANONYMOUS_LIMITED("GEOIP_ANONYMOUS_LIMITED", 429),
    DISABLED("GEOIP_DISABLED", 503),
    INVALID_REQUEST("GEOIP_INVALID_REQUEST", 400),
    MAP_NOT_FOUND("GEOIP_MAP_NOT_FOUND", 404),
    ORIGIN_FORBIDDEN("GEOIP_ORIGIN_FORBIDDEN", 403),
    QUOTA_EXCEEDED("GEOIP_QUOTA_EXCEEDED", 429),
    REQUEST_TOO_LARGE("GEOIP_REQUEST_TOO_LARGE", 413),
    UNAVAILABLE("GEOIP_UNAVAILABLE", 503),
    USAGE_UNCONFIRMED("GEOIP_USAGE_UNCONFIRMED", 503),
}

/** A failed GeoIP operation. */
public class TileflowGeoIPException(
    kind: TileflowServiceErrorKind,
    public val code: TileflowGeoIPErrorCode?,
    status: Int?,
    requestId: String?,
    retryAfterSeconds: Long?,
    message: String,
    cause: Throwable? = null,
) : TileflowServiceException(kind, status, requestId, retryAfterSeconds, message, cause)

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

        internal val KNOWN =
            setOf(AFRICA, ANTARCTICA, ASIA, EUROPE, NORTH_AMERICA, OCEANIA, SOUTH_AMERICA).map {
                it.value
            }
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

/**
 * Tileflow GeoIP: the approximate location of the device's network connection, for example to
 * open a map near the person before asking for their precise location. Access is anonymous, with
 * shared limits and no availability guarantee: it sends no credential and no app identity.
 */
public class TileflowGeoIP
internal constructor(
    configuration: () -> TileflowConfiguration,
    app: () -> TileflowAppIdentity?,
    client: OkHttpClient,
) {
    /** A client that uses the API origin of [dev.tileflow.configuration.Tileflow.configuration]. */
    public constructor(
        context: Context
    ) : this(
        TileflowServiceContext.configuration(context),
        TileflowServiceContext.app(context),
        TileflowServiceContext.defaultClient,
    )

    /** A client that uses the API origin of [configuration]. */
    public constructor(
        context: Context,
        configuration: TileflowConfiguration,
    ) : this(
        { configuration },
        TileflowServiceContext.app(context),
        TileflowServiceContext.defaultClient,
    )

    private val transport = TileflowServiceTransport(geoIpErrors, configuration, app, client)

    /**
     * The approximate location of the device's network connection.
     *
     * @throws TileflowGeoIPException on failure; cancellation rethrows.
     */
    public suspend fun locate(): TileflowGeoIPResponse =
        transport.send("/v1/geoip", REQUEST_BYTES, RESPONSE_BYTES, { JSONObject() }, ::decode)

    private companion object {
        const val REQUEST_BYTES = 1024
        const val RESPONSE_BYTES = 8 * 1024
        val COUNTRY_CODE = Regex("^[A-Z]{2}$")

        fun decode(root: TileflowJsonObject): TileflowGeoIPResponse {
            root.requireSchemaVersion()
            // Anonymous access consumes no units, whether or not a location is available.
            requireResponse(root.obj("usage").long("units") == 0L)
            val location =
                when (root.string("status")) {
                    "available" -> location(root.obj("location"))
                    "unavailable" -> {
                        requireResponse(root.isNull("location"))
                        null
                    }
                    else -> invalidResponse()
                }
            return TileflowGeoIPResponse(location, 0)
        }

        fun location(value: TileflowJsonObject): TileflowGeoIPLocation {
            fun text(key: String): String? =
                value.optString(key)?.let {
                    requireResponse(it.length <= 256 && !TileflowText.hasControlCharacter(it))
                    TileflowText.trim(it).ifEmpty { invalidResponse() }
                }
            val location =
                TileflowGeoIPLocation(
                    city = text("city"),
                    continentCode =
                        text("continentCode")?.let {
                            requireResponse(it in TileflowGeoIPContinent.KNOWN)
                            TileflowGeoIPContinent(it)
                        },
                    countryCode =
                        text("countryCode")?.also {
                            requireResponse(COUNTRY_CODE.matches(it) && it != "XX")
                        },
                    isEuCountry = value.optBoolean("isEUCountry"),
                    position = if (value.has("position")) value.position("position") else null,
                    postalCode = text("postalCode"),
                    region = text("region"),
                    regionCode = text("regionCode"),
                    timezone = text("timezone"),
                )
            requireResponse(location != TileflowGeoIPLocation())
            return location
        }
    }
}

internal val geoIpErrors: TileflowServiceErrors<TileflowGeoIPErrorCode> =
    TileflowServiceErrors(
        service = TileflowService.GEOIP,
        name = "GeoIP",
        codes = TileflowGeoIPErrorCode.entries,
        wireName = { it.wireName },
        statusOf = { it.status },
        exception = {
            TileflowGeoIPException(
                it.kind,
                it.code,
                it.status,
                it.requestId,
                it.retryAfterSeconds,
                it.message,
                it.cause,
            )
        },
        codelessStatuses = setOf(403, 429),
        requestIdPattern = Regex("^[A-Za-z0-9._:-]{1,128}$"),
    )
