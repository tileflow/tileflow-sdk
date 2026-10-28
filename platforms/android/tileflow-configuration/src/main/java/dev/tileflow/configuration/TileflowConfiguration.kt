package dev.tileflow.configuration

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.net.URI
import java.util.Locale

/** The Tileflow services an application can call. */
public enum class TileflowService {
    SEARCH,
    ROUTING,
    ELEVATION,
    GEOIP,
}

/** A missing or invalid Tileflow configuration value. Messages never include credentials. */
public class TileflowConfigurationException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

/**
 * A publishable Tileflow credential: `tf_public_` followed by 48 lowercase hexadecimal characters.
 * Applications ship only publishable credentials, so any other value is rejected. Its value never
 * appears in [toString], errors or URLs.
 *
 * @throws TileflowConfigurationException when [value] is not a publishable credential.
 */
public class TileflowCredential(value: String) {
    internal val value: String

    init {
        if (!PUBLISHABLE.matches(value))
            throw TileflowConfigurationException(
                "A Tileflow credential must be a publishable credential: tf_public_ followed by " +
                    "48 lowercase hexadecimal characters."
            )
        this.value = value
    }

    override fun equals(other: Any?): Boolean = other is TileflowCredential && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "TileflowCredential(tf_public_…)"

    private companion object {
        val PUBLISHABLE = Regex("^tf_public_[0-9a-f]{48}$")
    }
}

/**
 * Where Tileflow services are and which credentials an application uses for them.
 *
 * Search, Routing and Elevation use their own credential when one is set and [servicesCredential]
 * otherwise. The [mapCredential] is for the hosted map only: it never authorizes a service, and a
 * service credential never authorizes the map. GeoIP is anonymous and uses no credential.
 *
 * @param apiOrigin An `https` origin without path, query or fragment; `http` is accepted only for
 *   `localhost`, `127.0.0.1` and `[::1]`.
 * @param app The app identity sent with publishable credentials. When null, clients detect the
 *   running application's package name and signing certificate.
 * @throws TileflowConfigurationException when [apiOrigin] is not a valid origin.
 */
public class TileflowConfiguration
@JvmOverloads
constructor(
    apiOrigin: URI = DEFAULT_API_ORIGIN,
    public val servicesCredential: TileflowCredential? = null,
    public val searchCredential: TileflowCredential? = null,
    public val routingCredential: TileflowCredential? = null,
    public val elevationCredential: TileflowCredential? = null,
    public val mapCredential: TileflowCredential? = null,
    public val app: TileflowAppIdentity? = null,
) {
    /** The normalized origin: lowercase scheme and host, no default port and no trailing slash. */
    public val apiOrigin: URI = normalizeOrigin(apiOrigin)

    /** The credential a service uses, or null when it has none. GeoIP never uses one. */
    public fun credential(service: TileflowService): TileflowCredential? =
        when (service) {
            TileflowService.SEARCH -> searchCredential ?: servicesCredential
            TileflowService.ROUTING -> routingCredential ?: servicesCredential
            TileflowService.ELEVATION -> elevationCredential ?: servicesCredential
            TileflowService.GEOIP -> null
        }

    override fun equals(other: Any?): Boolean =
        other is TileflowConfiguration &&
            other.apiOrigin == apiOrigin &&
            other.servicesCredential == servicesCredential &&
            other.searchCredential == searchCredential &&
            other.routingCredential == routingCredential &&
            other.elevationCredential == elevationCredential &&
            other.mapCredential == mapCredential &&
            other.app == app

    override fun hashCode(): Int =
        listOf(
                apiOrigin,
                servicesCredential,
                searchCredential,
                routingCredential,
                elevationCredential,
                mapCredential,
                app,
            )
            .hashCode()

    override fun toString(): String =
        "TileflowConfiguration(apiOrigin=$apiOrigin, servicesCredential=$servicesCredential, " +
            "searchCredential=$searchCredential, routingCredential=$routingCredential, " +
            "elevationCredential=$elevationCredential, mapCredential=$mapCredential, app=$app)"

    public companion object {
        /** `https://api.tileflow.dev`. */
        @JvmField public val DEFAULT_API_ORIGIN: URI = URI("https://api.tileflow.dev")

        internal const val API_ORIGIN_KEY = "dev.tileflow.API_ORIGIN"
        internal const val SERVICES_CREDENTIAL_KEY = "dev.tileflow.SERVICES_CREDENTIAL"
        internal const val SEARCH_CREDENTIAL_KEY = "dev.tileflow.SEARCH_CREDENTIAL"
        internal const val ROUTING_CREDENTIAL_KEY = "dev.tileflow.ROUTING_CREDENTIAL"
        internal const val ELEVATION_CREDENTIAL_KEY = "dev.tileflow.ELEVATION_CREDENTIAL"
        internal const val MAP_CREDENTIAL_KEY = "dev.tileflow.MAP_CREDENTIAL"

        /**
         * The configuration in the application's manifest: `<meta-data>` entries of its
         * `<application>` named `dev.tileflow.API_ORIGIN`, `dev.tileflow.SERVICES_CREDENTIAL`,
         * `dev.tileflow.SEARCH_CREDENTIAL`, `dev.tileflow.ROUTING_CREDENTIAL`,
         * `dev.tileflow.ELEVATION_CREDENTIAL` and `dev.tileflow.MAP_CREDENTIAL`. Missing or empty
         * entries are unset.
         *
         * @throws TileflowConfigurationException when an entry is present but invalid.
         */
        @JvmStatic
        public fun fromManifest(context: Context): TileflowConfiguration {
            val metaData =
                try {
                    val packageManager = context.packageManager
                    val info =
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                            packageManager.getApplicationInfo(
                                context.packageName,
                                PackageManager.ApplicationInfoFlags.of(
                                    PackageManager.GET_META_DATA.toLong()
                                ),
                            )
                        else
                            @Suppress("DEPRECATION")
                            packageManager.getApplicationInfo(
                                context.packageName,
                                PackageManager.GET_META_DATA,
                            )
                    info.metaData
                } catch (error: PackageManager.NameNotFoundException) {
                    throw TileflowConfigurationException(
                        "The application's manifest could not be read.",
                        error,
                    )
                }
            return fromValues { key ->
                if (metaData == null || !metaData.containsKey(key)) null
                else
                    metaData.getString(key)
                        ?: throw TileflowConfigurationException(
                            "The $key manifest value must be a string."
                        )
            }
        }

        /** The configuration of named values; empty values are unset. */
        internal fun fromValues(value: (String) -> String?): TileflowConfiguration {
            fun text(key: String): String? = value(key)?.takeIf { it.isNotBlank() }
            fun credential(key: String): TileflowCredential? =
                text(key)?.let {
                    try {
                        TileflowCredential(it)
                    } catch (error: TileflowConfigurationException) {
                        throw TileflowConfigurationException(
                            "The $key value is not a publishable Tileflow credential.",
                            error,
                        )
                    }
                }
            val origin =
                text(API_ORIGIN_KEY)?.let {
                    try {
                        normalizeOrigin(URI(it))
                    } catch (error: Exception) {
                        throw TileflowConfigurationException(
                            "The $API_ORIGIN_KEY value is not a valid Tileflow API origin.",
                            error,
                        )
                    }
                }
            return TileflowConfiguration(
                apiOrigin = origin ?: DEFAULT_API_ORIGIN,
                servicesCredential = credential(SERVICES_CREDENTIAL_KEY),
                searchCredential = credential(SEARCH_CREDENTIAL_KEY),
                routingCredential = credential(ROUTING_CREDENTIAL_KEY),
                elevationCredential = credential(ELEVATION_CREDENTIAL_KEY),
                mapCredential = credential(MAP_CREDENTIAL_KEY),
            )
        }

        private val LOOPBACK = setOf("localhost", "127.0.0.1", "[::1]")

        internal fun normalizeOrigin(origin: URI): URI {
            val scheme = origin.scheme?.lowercase(Locale.ROOT)
            val host = origin.host?.lowercase(Locale.ROOT)
            if (
                origin.isOpaque ||
                    host.isNullOrEmpty() ||
                    origin.rawUserInfo != null ||
                    origin.rawQuery != null ||
                    origin.rawFragment != null ||
                    !(origin.rawPath.isNullOrEmpty() || origin.rawPath == "/") ||
                    !(scheme == "https" || (scheme == "http" && host in LOOPBACK)) ||
                    origin.port !in -1..65_535 ||
                    origin.port == 0
            )
                throw TileflowConfigurationException(
                    "The Tileflow API origin must be an https origin without path, query or " +
                        "fragment; http is accepted only for localhost, 127.0.0.1 and [::1]."
                )
            val defaultPort = if (scheme == "https") 443 else 80
            val port =
                if (origin.port == -1 || origin.port == defaultPort) "" else ":${origin.port}"
            return URI("$scheme://$host$port")
        }
    }
}
