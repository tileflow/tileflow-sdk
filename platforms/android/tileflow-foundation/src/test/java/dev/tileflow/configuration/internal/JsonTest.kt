package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.testing.failure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JsonTest {
    private fun read(text: String) =
        TileflowJsonObject(TileflowJson.parseObject(text.toByteArray()))

    @Test
    fun valuesAreNeverCoerced() {
        val value =
            read(
                """{"number":"12","text":12,"flag":"true","list":{},"object":[],"integer":12.5,
                   "whole":12.0,"position":[-3.7,40.4],"unknown":{"nested":true}}"""
            )
        failure<TileflowInvalidResponseException> { value.double("number") }
        failure<TileflowInvalidResponseException> { value.string("text") }
        failure<TileflowInvalidResponseException> { value.boolean("flag") }
        failure<TileflowInvalidResponseException> { value.array("list") }
        failure<TileflowInvalidResponseException> { value.obj("object") }
        failure<TileflowInvalidResponseException> { value.long("integer") }
        assertEquals(12L, value.long("whole"))
        assertEquals(12.0, value.double("whole"), 0.0)
        assertEquals(TileflowPosition(-3.7, 40.4), value.position("position"))
        failure<TileflowInvalidResponseException> { value.string("missing") }
    }

    @Test
    fun optionalValuesMayBeAbsentAndNullableValuesMayBeNull() {
        val value = read("""{"nothing":null,"text":"a"}""")
        assertNull(value.optString("missing"))
        assertEquals("a", value.optString("text"))
        failure<TileflowInvalidResponseException> { value.optString("nothing") }
        assertNull(value.nullableString("nothing"))
        failure<TileflowInvalidResponseException> { value.nullableString("missing") }
        assertTrue(value.isNull("nothing"))
        assertFalse(value.isNull("missing"))
    }

    @Test
    fun positionsAndTextFollowTheContract() {
        for (position in listOf("[181,0]", "[0,-91]", "[0]", "[0,0,0]", "[\"0\",0]"))
            failure<TileflowInvalidResponseException> {
                read("""{"position":$position}""").position("position")
            }
        assertEquals("Madrid", read("""{"text":"  Madrid\n"}""").boundedText("text", 10))
        failure<TileflowInvalidResponseException> {
            read("""{"text":" "}""").boundedText("text", 10)
        }
        failure<TileflowInvalidResponseException> {
            read("""{"text":"a\u0000b"}""").boundedText("text", 10)
        }
        failure<TileflowInvalidResponseException> {
            read("""{"text":"\ud800"}""").literalText("text", 10)
        }
        assertEquals("\uD83D\uDE00", read("""{"text":"\ud83d\ude00"}""").literalText("text", 10))
        assertEquals("a", TileflowText.trim("\uFEFF\u00A0a\u2029"))
    }

    @Test
    fun onlyUtf8JsonObjectsParse() {
        assertEquals(1, TileflowJson.parseObject("\uFEFF{\"a\":1}".toByteArray()).length())
        for (bytes in
            listOf(
                byteArrayOf(0x7b, 0xc3.toByte(), 0x7d),
                "[]".toByteArray(),
                "{} {}".toByteArray(),
                "".toByteArray(),
                "\"text\"".toByteArray(),
            ))
            failure<TileflowInvalidResponseException> { TileflowJson.parseObject(bytes) }
    }
}
