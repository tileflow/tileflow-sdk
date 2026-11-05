package dev.tileflow.sdk

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class BoundaryJoinTest {
    @Test
    fun matchesCoreJoinAndCsvResults() {
        val json = requireNotNull(javaClass.getResourceAsStream("/boundary-joins.json"))
            .bufferedReader().use { JSONObject(it.readText()) }
        val lookups = json.getJSONObject("lookups")

        for (case in json.getJSONArray("cases").read { getJSONObject(it) }) {
            val name = case.getString("name")
            val result = runCatching {
                val lookup = when (val input = case.opt("lookup")) {
                    is String -> TileflowBoundaryLookup(lookups.getJSONArray(input).lookupRows())
                    is JSONArray -> TileflowBoundaryLookup(input.lookupRows())
                    else -> case.optStringOrNull("csv")?.let { csv ->
                        val parsed = parseBoundaryLookupCsv(csv)
                        assertEquals(name, case.getJSONArray("parsed").lookupRows(), parsed)
                        TileflowBoundaryLookup(parsed)
                    }
                }
                val options = case.getJSONObject("options")
                joinBoundaryRows(
                    rows = case.getJSONArray("rows").joinRows(),
                    options = JoinBoundaryRowsOptions(
                        joinBy = code(options.getString("joinBy")),
                        to = target(options.optString("to", "id")),
                        classes = options.optJSONArray("classes")?.read {
                            boundaryClass(getString(it))
                        }?.toSet(),
                        lookup = lookup,
                    ),
                )
            }

            val expectedError = case.optStringOrNull("error")
            if (expectedError != null) {
                val error = result.exceptionOrNull()
                assertEquals(name, IllegalArgumentException::class.java, error?.javaClass)
                assertEquals(name, expectedError, error?.message)
            } else {
                val expected = case.getJSONObject("expected")
                assertEquals(
                    name,
                    TileflowBoundaryJoinResult(
                        joinBy = target(expected.getString("joinBy")),
                        rows = expected.getJSONArray("rows").joinRows(),
                        duplicates = expected.getJSONArray("duplicates").read { key(get(it)) },
                        ambiguous = expected.getJSONArray("ambiguous").read { key(get(it)) },
                        unmatched = expected.getJSONArray("unmatched").read { key(get(it)) },
                    ),
                    result.getOrElse { throw AssertionError(name, it) },
                )
            }
        }
    }

    private fun JSONArray.lookupRows(): List<TileflowBoundaryLookupRow> = read { index ->
        val row = getJSONObject(index)
        TileflowBoundaryLookupRow(
            id = row.getDouble("id"),
            boundaryClass = boundaryClass(row.getString("class")),
            adminLevel = (row.opt("admin_level") as? Number)?.toLong(),
            classTier = row.optStringOrNull("class_tier"),
            iso31661 = row.optStringOrNull("iso_3166_1"),
            iso31662 = row.optStringOrNull("iso_3166_2"),
            name = row.optStringOrNull("name"),
            nameEn = row.optStringOrNull("name_en"),
            nuts = row.optStringOrNull("nuts"),
            ref = row.optStringOrNull("ref"),
            wikidata = row.optStringOrNull("wikidata"),
        )
    }

    private fun JSONArray.joinRows(): List<TileflowBoundaryRow> = read { index ->
        val row = getJSONObject(index)
        val value = when (val raw = row.get("value")) {
            is Number -> TileflowBoundaryValue.Number(raw.toDouble())
            is String -> TileflowBoundaryValue.Category(raw)
            else -> null
        }
        TileflowBoundaryRow(key(row.get("key")), value)
    }

    private fun key(raw: Any): TileflowBoundaryKey = when (raw) {
        is Number -> TileflowBoundaryKey.Number(raw.toDouble())
        is String -> TileflowBoundaryKey.Text(raw)
        else -> error("Invalid fixture key")
    }

    private fun boundaryClass(wireName: String): TileflowBoundaryClass =
        TileflowBoundaryClass.entries.firstOrNull { it.wireName == wireName }
            ?: throw IllegalArgumentException("Unknown Boundaries class: $wireName.")

    private fun code(wireName: String) = TileflowBoundaryCode.entries.single { it.wireName == wireName }

    private fun target(wireName: String) =
        TileflowBoundaryTarget.entries.single { it.code.wireName == wireName }

    private fun JSONObject.optStringOrNull(name: String): String? = opt(name) as? String

    private fun <T> JSONArray.read(value: JSONArray.(Int) -> T): List<T> =
        List(length()) { value(it) }
}
