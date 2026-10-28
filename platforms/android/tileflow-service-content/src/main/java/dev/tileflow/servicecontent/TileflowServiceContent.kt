@file:JvmName("TileflowServiceContent")

package dev.tileflow.servicecontent

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.elevation.TileflowElevationProfile
import dev.tileflow.geoip.TileflowGeoIPLocation
import dev.tileflow.sdk.TileflowAnnotation
import dev.tileflow.sdk.TileflowBounds
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCoordinate

/** The map coordinate of a service position. */
public fun TileflowCoordinate(position: TileflowPosition): TileflowCoordinate =
    TileflowCoordinate(position.longitude, position.latitude)

/** The service position of a map coordinate. */
public fun TileflowPosition(coordinate: TileflowCoordinate): TileflowPosition =
    TileflowPosition(coordinate.longitude, coordinate.latitude)

/** The map bounds of a service bounding box, for example to fit a route. */
public fun TileflowBounds(boundingBox: TileflowBoundingBox): TileflowBounds =
    TileflowBounds(boundingBox.west, boundingBox.south, boundingBox.east, boundingBox.north)

/**
 * The position to send as Search proximity: the map centre at city scale or closer (zoom 9 and
 * above), or null when the map shows a wider area.
 */
public val TileflowCamera.searchProximity: TileflowPosition?
    get() {
        if (!(zoom >= 9.0) || !longitude.isFinite() || !latitude.isFinite()) return null
        // A map that pans across the antimeridian may report a longitude beyond ±180.
        val wrapped =
            if (longitude in -180.0..180.0) longitude
            else ((longitude + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
        return TileflowPosition(wrapped, latitude.coerceIn(-90.0, 90.0))
    }

/** An initial map view around a GeoIP location. */
public object TileflowGeoIPCamera {
    /**
     * A camera centred on the location: zoom 10 when it names a city, 7 when it names a region
     * and 4 otherwise. Null when the location has no position.
     */
    @JvmStatic
    public fun from(location: TileflowGeoIPLocation): TileflowCamera? {
        val position = location.position ?: return null
        val zoom =
            when {
                location.city != null -> 10.0
                location.region != null -> 7.0
                else -> 4.0
            }
        return TileflowCamera(position.longitude, position.latitude, zoom)
    }
}

/** A map marker that follows a distance along an elevation profile, for example under a chart. */
public object TileflowElevationProfileMarker {
    /**
     * A marker at [atDistance] along the profile, clamped to its length, or null when the profile
     * has no samples or the distance is not finite.
     */
    @JvmStatic
    @JvmOverloads
    public fun annotation(
        profile: TileflowElevationProfile,
        atDistance: Double,
        id: String = "elevation-profile-position",
        title: String = "Elevation profile position",
        color: String = TileflowRouteInks.LIGHT.line,
    ): TileflowAnnotation? {
        val point = profile.point(atDistance) ?: return null
        return TileflowAnnotation(id, TileflowCoordinate(point.position), title, color)
    }
}
