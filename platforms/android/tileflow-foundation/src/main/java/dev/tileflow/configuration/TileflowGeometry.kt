package dev.tileflow.configuration

/**
 * A WGS84 position. It is valid when both values are finite, the longitude is within ±180 and the
 * latitude within ±90; service clients check it when they send a request.
 */
public data class TileflowPosition(public val longitude: Double, public val latitude: Double)

/**
 * A WGS84 box. It is valid when its corners are valid positions, west is less than east and south
 * is less than north.
 */
public data class TileflowBoundingBox(
    public val west: Double,
    public val south: Double,
    public val east: Double,
    public val north: Double,
)
