package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** Strict JSON reading and request encoding over `org.json`. */
@TileflowInternalApi
public object TileflowJson {
    /** A UTF-8 JSON object; anything else throws [TileflowInvalidResponseException]. */
    public fun parseObject(bytes: ByteArray): JSONObject {
        val text =
            try {
                Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString()
            } catch (_: CharacterCodingException) {
                invalidResponse()
            }
        return try {
            val tokener = JSONTokener(text.removePrefix("\uFEFF"))
            val value = tokener.nextValue()
            if (tokener.nextClean() != 0.toChar()) invalidResponse()
            value as? JSONObject ?: invalidResponse()
        } catch (error: TileflowInvalidResponseException) {
            throw error
        } catch (_: Exception) {
            invalidResponse()
        }
    }

    public fun position(position: TileflowPosition): JSONArray =
        JSONArray().put(position.longitude).put(position.latitude)

    public fun positions(positions: List<TileflowPosition>): JSONArray =
        JSONArray().also { array -> positions.forEach { array.put(position(it)) } }

    public fun bounds(box: TileflowBoundingBox): JSONArray =
        JSONArray().put(box.west).put(box.south).put(box.east).put(box.north)

    public fun strings(values: List<String>): JSONArray =
        JSONArray().also { array -> values.forEach { array.put(it) } }

    internal fun finite(value: Any?): Double {
        if (value !is Number) invalidResponse()
        val number = value.toDouble()
        requireResponse(number.isFinite())
        return number
    }

    internal fun integral(value: Any?): Long =
        when (value) {
            is Int -> value.toLong()
            is Long -> value
            is Short -> value.toLong()
            is Byte -> value.toLong()
            is BigInteger -> if (value.bitLength() < 64) value.toLong() else invalidResponse()
            is BigDecimal ->
                try {
                    value.longValueExact()
                } catch (_: ArithmeticException) {
                    invalidResponse()
                }
            is Double,
            is Float -> {
                val number = value.toDouble()
                requireResponse(
                    number.isFinite() && number == Math.rint(number) && number in -9.0e15..9.0e15
                )
                number.toLong()
            }
            else -> invalidResponse()
        }

    internal fun position(value: Any?): TileflowPosition {
        val array = value as? JSONArray ?: invalidResponse()
        requireResponse(array.length() == 2)
        val position = TileflowPosition(finite(array.opt(0)), finite(array.opt(1)))
        requireResponse(TileflowGeo.isValid(position))
        return position
    }
}

/** A JSON object read without coercion. Keys the reader does not ask for are ignored. */
@TileflowInternalApi
public class TileflowJsonObject(public val json: JSONObject) {
    /** Whether the key is present, including with a `null` value. */
    public fun has(key: String): Boolean = json.has(key)

    /** Whether the key is present with a `null` value. */
    public fun isNull(key: String): Boolean = json.opt(key) === JSONObject.NULL

    private fun present(key: String): Any = json.opt(key) ?: invalidResponse()

    private inline fun <T : Any> optional(key: String, read: (String) -> T): T? =
        if (json.has(key)) read(key) else null

    private inline fun <T : Any> nullable(key: String, read: (String) -> T): T? =
        if (present(key) === JSONObject.NULL) null else read(key)

    public fun obj(key: String): TileflowJsonObject =
        TileflowJsonObject(present(key) as? JSONObject ?: invalidResponse())

    public fun optObj(key: String): TileflowJsonObject? = optional(key, ::obj)

    public fun nullableObj(key: String): TileflowJsonObject? = nullable(key, ::obj)

    public fun array(key: String): TileflowJsonArray =
        TileflowJsonArray(present(key) as? JSONArray ?: invalidResponse())

    public fun optArray(key: String): TileflowJsonArray? = optional(key, ::array)

    public fun string(key: String): String = present(key) as? String ?: invalidResponse()

    public fun optString(key: String): String? = optional(key, ::string)

    public fun nullableString(key: String): String? = nullable(key, ::string)

    public fun double(key: String): Double = TileflowJson.finite(present(key))

    public fun optDouble(key: String): Double? = optional(key, ::double)

    public fun nullableDouble(key: String): Double? = nullable(key, ::double)

    public fun long(key: String): Long = TileflowJson.integral(present(key))

    public fun optLong(key: String): Long? = optional(key, ::long)

    public fun int(key: String, range: IntRange): Int {
        val value = long(key)
        requireResponse(value >= range.first && value <= range.last)
        return value.toInt()
    }

    public fun optInt(key: String, range: IntRange): Int? = optional(key) { int(it, range) }

    public fun boolean(key: String): Boolean = present(key) as? Boolean ?: invalidResponse()

    public fun optBoolean(key: String): Boolean? = optional(key, ::boolean)

    public fun position(key: String): TileflowPosition = TileflowJson.position(present(key))

    public fun bounds(key: String): TileflowBoundingBox {
        val array = array(key)
        requireResponse(array.size == 4)
        val box =
            TileflowBoundingBox(array.double(0), array.double(1), array.double(2), array.double(3))
        requireResponse(TileflowGeo.isValid(box))
        return box
    }

    public fun optBounds(key: String): TileflowBoundingBox? = optional(key, ::bounds)

    /** Trimmed text of 1 to [maximum] characters without control characters. */
    public fun boundedText(key: String, maximum: Int): String =
        TileflowText.bounded(string(key), maximum) ?: invalidResponse()

    public fun optBoundedText(key: String, maximum: Int): String? =
        optional(key) { boundedText(it, maximum) }

    /** Untrimmed text of 1 to [maximum] characters without control characters. */
    public fun literalText(key: String, maximum: Int): String =
        TileflowText.literal(string(key), maximum) ?: invalidResponse()

    public fun optLiteralText(key: String, maximum: Int): String? =
        optional(key) { literalText(it, maximum) }

    /** Requires `schemaVersion` 1. */
    public fun requireSchemaVersion() {
        requireResponse(long("schemaVersion") == 1L)
    }
}

/** A JSON array read without coercion. */
@TileflowInternalApi
public class TileflowJsonArray(public val json: JSONArray) {
    public val size: Int
        get() = json.length()

    /** This array when its size is within [range]. */
    public fun sized(range: IntRange): TileflowJsonArray {
        requireResponse(size in range)
        return this
    }

    private fun present(index: Int): Any = json.opt(index) ?: invalidResponse()

    public fun isNull(index: Int): Boolean = json.opt(index) === JSONObject.NULL

    public fun obj(index: Int): TileflowJsonObject =
        TileflowJsonObject(present(index) as? JSONObject ?: invalidResponse())

    public fun array(index: Int): TileflowJsonArray =
        TileflowJsonArray(present(index) as? JSONArray ?: invalidResponse())

    public fun string(index: Int): String = present(index) as? String ?: invalidResponse()

    public fun double(index: Int): Double = TileflowJson.finite(present(index))

    public fun nullableDouble(index: Int): Double? = if (isNull(index)) null else double(index)

    public fun long(index: Int): Long = TileflowJson.integral(present(index))

    public fun position(index: Int): TileflowPosition = TileflowJson.position(present(index))

    public fun <T> map(transform: (Int) -> T): List<T> = List(size, transform)

    public fun <T> mapObjects(transform: (TileflowJsonObject) -> T): List<T> =
        List(size) { transform(obj(it)) }

    public fun positions(): List<TileflowPosition> = List(size, ::position)

    /** Strings of 1 to [maximum] characters. */
    public fun strings(maximum: Int): List<String> =
        List(size) { index ->
            string(index).takeIf { it.length in 1..maximum } ?: invalidResponse()
        }

    /** Strings of 1 to [maximum] characters without control characters or lone surrogates. */
    public fun literalStrings(maximum: Int): List<String> =
        List(size) { TileflowText.literal(string(it), maximum) ?: invalidResponse() }
}
