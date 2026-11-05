package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** A request the client rejects before sending it. */
@TileflowInternalApi
public class TileflowInvalidRequestException(message: String) : Exception(message)

/** An answer outside the service contract. */
@TileflowInternalApi
public class TileflowInvalidResponseException(
    message: String = "The answer is outside the service contract."
) : Exception(message)

@TileflowInternalApi
public fun requireRequest(condition: Boolean, message: () -> String) {
    if (!condition) throw TileflowInvalidRequestException(message())
}

@TileflowInternalApi
public fun requireResponse(condition: Boolean) {
    if (!condition) throw TileflowInvalidResponseException()
}

@TileflowInternalApi
public fun invalidResponse(): Nothing = throw TileflowInvalidResponseException()

/** Text rules shared by the service contracts. Lengths count UTF-16 code units. */
@TileflowInternalApi
public object TileflowText {
    /** Removes the leading and trailing white space and line terminators of ECMAScript. */
    public fun trim(value: String): String {
        var start = 0
        var end = value.length
        while (start < end && isWhiteSpace(value[start])) start += 1
        while (end > start && isWhiteSpace(value[end - 1])) end -= 1
        return value.substring(start, end)
    }

    public fun isWhiteSpace(character: Char): Boolean =
        when (character) {
            '\t',
            '\n',
            '\u000B',
            '\u000C',
            '\r',
            ' ',
            '\u00A0',
            '\u1680',
            '\u2028',
            '\u2029',
            '\u202F',
            '\u205F',
            '\u3000',
            '\uFEFF' -> true
            else -> character in '\u2000'..'\u200A'
        }

    /** Whether the text has a C0 or C1 control character. */
    public fun hasControlCharacter(value: String): Boolean =
        value.any { it <= '\u001F' || it in '\u007F'..'\u009F' }

    /** Whether the text has a surrogate that is not part of a pair. */
    public fun hasLoneSurrogate(value: String): Boolean {
        var index = 0
        while (index < value.length) {
            val character = value[index]
            if (character.isHighSurrogate()) {
                if (index + 1 >= value.length || !value[index + 1].isLowSurrogate()) return true
                index += 2
            } else if (character.isLowSurrogate()) return true
            else index += 1
        }
        return false
    }

    /** The trimmed text when it has 1 to [maximum] characters and no control character. */
    public fun bounded(value: String, maximum: Int): String? {
        val trimmed = trim(value)
        return trimmed.takeIf {
            it.length in 1..maximum && !hasControlCharacter(it)
        }
    }

    /** The text, untrimmed, when it has 1 to [maximum] characters and no control character. */
    public fun literal(value: String, maximum: Int): String? =
        value.takeIf {
            it.length in 1..maximum && !hasControlCharacter(it) && !hasLoneSurrogate(it)
        }

    /** Whether the text has 1 to [maximum] printable ASCII characters other than space. */
    public fun isPrintableAscii(value: String, maximum: Int): Boolean =
        value.length in 1..maximum && value.all { it in '!'..'~' }
}

/** Position rules shared by the service contracts. */
@TileflowInternalApi
public object TileflowGeo {
    private const val EARTH_RADIUS_METERS = 6_371_008.8
    private const val RADIANS = Math.PI / 180

    public fun isValid(position: TileflowPosition): Boolean =
        position.longitude.isFinite() &&
            position.latitude.isFinite() &&
            position.longitude in -180.0..180.0 &&
            position.latitude in -90.0..90.0

    public fun isValid(box: TileflowBoundingBox): Boolean =
        isValid(TileflowPosition(box.west, box.south)) &&
            isValid(TileflowPosition(box.east, box.north)) &&
            box.west < box.east &&
            box.south < box.north

    /** Great-circle distance in metres. */
    public fun distanceMeters(a: TileflowPosition, b: TileflowPosition): Double {
        val dLat = (b.latitude - a.latitude) * RADIANS
        val dLng = (b.longitude - a.longitude) * RADIANS
        val h =
            sin(dLat / 2) * sin(dLat / 2) +
                cos(a.latitude * RADIANS) *
                    cos(b.latitude * RADIANS) *
                    sin(dLng / 2) *
                    sin(dLng / 2)
        return 2 * EARTH_RADIUS_METERS * asin(min(1.0, sqrt(h)))
    }
}
