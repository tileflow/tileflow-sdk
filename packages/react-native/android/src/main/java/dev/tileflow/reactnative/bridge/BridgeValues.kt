package dev.tileflow.reactnative.bridge

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition

// Values as they cross the React Native bridge: maps and lists from JavaScript in, maps and lists
// for JavaScript out. Nothing here uses React, so the conversions are tested on their own.

/** A JavaScript argument that does not have the documented shape. */
class BridgeArgumentException(val path: String, val expected: String) :
    IllegalArgumentException("$path must be $expected")

/** A failed bridge call as JavaScript receives it: a code, a message and the error's fields. */
class BridgeFailure(val code: String, override val message: String, val info: Map<String, Any?>) :
    Exception(message)

/** A JavaScript object read with the path of each key, for errors that name the bad field. */
class BridgeObject(value: Any?, val path: String = "request") {
    val values: Map<String, Any?> =
        (value as? Map<*, *>)?.entries?.associate { (key, item) -> key.toString() to item }
            ?: throw BridgeArgumentException(path, "an object")

    private fun present(key: String): Any? = values[key]

    private fun error(key: String, expected: String) = BridgeArgumentException("$path.$key", expected)

    fun has(key: String): Boolean = present(key) != null

    fun string(key: String): String = optionalString(key) ?: throw error(key, "a string")

    fun optionalString(key: String): String? =
        present(key)?.let { it as? String ?: throw error(key, "a string") }

    fun double(key: String): Double = optionalDouble(key) ?: throw error(key, "a number")

    fun optionalDouble(key: String): Double? =
        present(key)?.let {
            number(it)?.takeIf(Double::isFinite) ?: throw error(key, "a finite number")
        }

    fun int(key: String): Int = optionalInt(key) ?: throw error(key, "an integer")

    fun optionalInt(key: String): Int? =
        optionalDouble(key)?.let {
            if (it != Math.rint(it) || it < Int.MIN_VALUE || it > Int.MAX_VALUE)
                throw error(key, "an integer")
            it.toInt()
        }

    fun bool(key: String, default: Boolean): Boolean = optionalBool(key) ?: default

    fun optionalBool(key: String): Boolean? =
        present(key)?.let { it as? Boolean ?: throw error(key, "a boolean") }

    fun obj(key: String): BridgeObject = optionalObject(key) ?: throw error(key, "an object")

    fun optionalObject(key: String): BridgeObject? = present(key)?.let { BridgeObject(it, "$path.$key") }

    fun array(key: String): List<Any?> = optionalArray(key) ?: throw error(key, "an array")

    fun optionalArray(key: String): List<Any?>? =
        present(key)?.let { it as? List<*> ?: throw error(key, "an array") }

    fun strings(key: String): List<String> =
        (optionalArray(key) ?: emptyList()).mapIndexed { index, item ->
            item as? String ?: throw BridgeArgumentException("$path.$key[$index]", "a string")
        }

    fun ints(key: String): List<Int> =
        (optionalArray(key) ?: emptyList()).mapIndexed { index, item ->
            number(item)?.takeIf { it == Math.rint(it) }?.toInt()
                ?: throw BridgeArgumentException("$path.$key[$index]", "an integer")
        }

    /** A string of a fixed set, as JavaScript writes the native case (`openingHours`, `en-US`). */
    inline fun <reified Value : Enum<Value>> choice(key: String): Value? {
        val text = optionalString(key) ?: return null
        return enumValues<Value>().firstOrNull { it.name == constantName(text) }
            ?: throw BridgeArgumentException("$path.$key", "a supported value")
    }

    inline fun <reified Value : Enum<Value>> choices(key: String): List<Value> =
        strings(key).map { text ->
            enumValues<Value>().firstOrNull { it.name == constantName(text) }
                ?: throw BridgeArgumentException("$path.$key", "supported values")
        }

    fun position(key: String): TileflowPosition =
        optionalPosition(key) ?: throw error(key, "[longitude, latitude]")

    fun optionalPosition(key: String): TileflowPosition? =
        present(key)?.let { position(it, "$path.$key") }

    fun positions(key: String): List<TileflowPosition> = positions(array(key), "$path.$key")

    fun optionalBoundingBox(key: String): TileflowBoundingBox? {
        val value = present(key) ?: return null
        val numbers = (value as? List<*>)?.mapNotNull(::number)
        if (numbers == null || numbers.size != 4 || !numbers.all(Double::isFinite))
            throw error(key, "[west, south, east, north]")
        return TileflowBoundingBox(numbers[0], numbers[1], numbers[2], numbers[3])
    }

    fun optionalStringMap(key: String): Map<String, String>? {
        val value = present(key) ?: return null
        val map = value as? Map<*, *> ?: throw error(key, "an object of strings")
        return map.entries.associate { (name, item) ->
            name.toString() to (item as? String ?: throw error(key, "an object of strings"))
        }
    }

    companion object {
        fun number(value: Any?): Double? = (value as? Number)?.toDouble()

        fun position(value: Any?, path: String): TileflowPosition {
            val numbers = (value as? List<*>)?.mapNotNull(::number)
            if (numbers == null || numbers.size != 2 || !numbers.all(Double::isFinite))
                throw BridgeArgumentException(path, "[longitude, latitude]")
            return TileflowPosition(numbers[0], numbers[1])
        }

        fun positions(values: List<Any?>, path: String): List<TileflowPosition> =
            values.mapIndexed { index, value -> position(value, "$path[$index]") }

        /** `openingHours` → `OPENING_HOURS`, `en-US` → `EN_US`. */
        fun constantName(text: String): String =
            text.replace('-', '_').replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").uppercase()

        /** `INVALID_REGION` → `invalidRegion`. */
        fun caseName(constant: String): String =
            constant.lowercase().split('_').mapIndexed { index, word ->
                if (index == 0) word else word.replaceFirstChar(Char::uppercase)
            }.joinToString("")
    }
}

/** Builds a JavaScript object, leaving out absent values as the Swift bridge does. */
class BridgeMap {
    val values = linkedMapOf<String, Any?>()

    fun put(key: String, value: Any?): BridgeMap {
        if (value != null) values[key] = value
        return this
    }
}

fun bridgeObject(build: BridgeMap.() -> Unit): Map<String, Any?> = BridgeMap().apply(build).values

fun TileflowPosition.bridge(): List<Double> = listOf(longitude, latitude)

fun TileflowBoundingBox.bridge(): List<Double> = listOf(west, south, east, north)

fun List<TileflowPosition>.bridgePositions(): List<List<Double>> = map { it.bridge() }
