package dev.tileflow.sdk

import java.math.BigInteger

public sealed interface TileflowBoundaryKey {
    public data class Number(val value: Double) : TileflowBoundaryKey
    public data class Text(val value: String) : TileflowBoundaryKey
}

public enum class TileflowBoundaryCode(public val wireName: String) {
    ID("id"),
    REF("ref"),
    ISO_3166_1("iso_3166_1"),
    ISO_3166_2("iso_3166_2"),
    NUTS("nuts"),
    WIKIDATA("wikidata"),
}

public enum class TileflowBoundaryTarget(internal val code: TileflowBoundaryCode) {
    ID(TileflowBoundaryCode.ID),
    REF(TileflowBoundaryCode.REF);

    public val wireName: String get() = code.wireName
}

public enum class TileflowBoundaryClass(public val wireName: String) {
    COUNTRY("country"),
    DEPENDENCY("dependency"),
    REGION("region"),
    PROVINCE_OR_COUNTY("province_or_county"),
    MUNICIPALITY("municipality"),
    DISTRICT("district"),
    NEIGHBOURHOOD("neighbourhood"),
}

public data class TileflowBoundaryRow(val key: TileflowBoundaryKey, val value: TileflowBoundaryValue?)

public data class TileflowBoundaryJoinResult(
    val joinBy: TileflowBoundaryTarget,
    val rows: List<TileflowBoundaryRow>,
    val duplicates: List<TileflowBoundaryKey>,
    val ambiguous: List<TileflowBoundaryKey>,
    val unmatched: List<TileflowBoundaryKey>,
) {
    /** Converts the joined rows to replacement feature state. Null values remove prior state. */
    public fun values(labels: Boolean = false, state: String = "value"): TileflowBoundaryValues =
        when (joinBy) {
            TileflowBoundaryTarget.ID -> TileflowBoundaryValues.byIds(
                rows.mapNotNull { row ->
                    val key = row.key as? TileflowBoundaryKey.Number
                    if (key == null || row.value == null) null else key.value.toLong() to row.value
                }.toMap(),
                labels,
                state,
            )
            TileflowBoundaryTarget.REF -> TileflowBoundaryValues.byRefs(
                rows.mapNotNull { row ->
                    val key = row.key as? TileflowBoundaryKey.Text
                    if (key == null || row.value == null) null else key.value to row.value
                }.toMap(),
                labels,
                state,
            )
        }
}

public data class JoinBoundaryRowsOptions(
    val joinBy: TileflowBoundaryCode,
    val to: TileflowBoundaryTarget = TileflowBoundaryTarget.ID,
    val classes: Set<TileflowBoundaryClass>? = null,
    val lookup: TileflowBoundaryLookup? = null,
)

public data class TileflowBoundaryLookupRow(
    val id: Double,
    val boundaryClass: TileflowBoundaryClass,
    val adminLevel: Long? = null,
    val classTier: String? = null,
    val iso31661: String? = null,
    val iso31662: String? = null,
    val name: String? = null,
    val nameEn: String? = null,
    val nuts: String? = null,
    val ref: String? = null,
    val wikidata: String? = null,
)

public class TileflowBoundaryLookup(rows: List<TileflowBoundaryLookupRow>) {
    public val rows: List<TileflowBoundaryLookupRow> = rows.toList()
    private val indexes = TileflowBoundaryCode.entries.associateWith {
        mutableMapOf<TileflowBoundaryKey, MutableList<TileflowBoundaryLookupRow>>()
    }

    init {
        for (row in this.rows) {
            require(row.id.isSafeBoundaryInteger() && row.id >= 0) {
                val label = if (row.id.isSafeBoundaryInteger()) row.id.toLong() else row.id
                "Boundaries lookup row has an invalid id: $label."
            }

            for (code in TileflowBoundaryCode.entries) {
                val key = row.key(code)?.let(code::normalize) ?: continue
                indexes.getValue(code).getOrPut(key, ::mutableListOf).add(row)
            }
        }
    }

    /** Returns the rows matching a normalized code and optional class filter. */
    public fun find(
        code: TileflowBoundaryCode,
        key: TileflowBoundaryKey,
        classes: Set<TileflowBoundaryClass>? = null,
    ): List<TileflowBoundaryLookupRow> {
        val normalized = code.normalize(key) ?: return emptyList()
        val matches = indexes.getValue(code)[normalized].orEmpty()
        return if (classes == null) matches.toList() else matches.filter { it.boundaryClass in classes }
    }
}

/** Joins application rows to area IDs or refs without fetching a lookup. */
public fun joinBoundaryRows(
    rows: List<TileflowBoundaryRow>,
    options: JoinBoundaryRowsOptions,
): TileflowBoundaryJoinResult {
    val (joinBy, to, classes, lookup) = options
    val direct = joinBy == to.code
    require(direct || lookup != null) {
        "Joining rows by ${joinBy.wireName} to ${to.code.wireName} requires the Boundaries lookup table."
    }

    val values = linkedMapOf<TileflowBoundaryKey, TileflowBoundaryValue?>()
    val seen = mutableSetOf<TileflowBoundaryKey>()
    val duplicates = linkedSetOf<TileflowBoundaryKey>()
    val ambiguous = mutableListOf<TileflowBoundaryKey>()
    val unmatched = mutableListOf<TileflowBoundaryKey>()

    for (row in rows) {
        val key = joinBy.normalize(row.key)
        if (key == null) {
            unmatched.add(row.key)
            continue
        }

        if (!seen.add(key)) duplicates.add(key)
        if (direct) {
            values[key] = row.value
            continue
        }

        val matches = checkNotNull(lookup).find(joinBy, key, classes)
        val first = matches.firstOrNull()
        if (first == null) {
            unmatched.add(row.key)
            continue
        }
        if (matches.any { it.id != first.id }) {
            ambiguous.add(row.key)
            continue
        }

        when (to) {
            TileflowBoundaryTarget.ID -> values[TileflowBoundaryKey.Number(if (first.id == 0.0) 0.0 else first.id)] = row.value
            TileflowBoundaryTarget.REF -> {
                val refs = matches.mapNotNull { it.ref }
                if (refs.isEmpty()) unmatched.add(row.key)
                for (ref in refs) values[TileflowBoundaryKey.Text(ref)] = row.value
            }
        }
    }

    return TileflowBoundaryJoinResult(
        joinBy = to,
        rows = values.map { (key, value) -> TileflowBoundaryRow(key, value) },
        duplicates = duplicates.toList(),
        ambiguous = ambiguous,
        unmatched = unmatched,
    )
}

internal fun TileflowBoundaryLookupRow.key(code: TileflowBoundaryCode): TileflowBoundaryKey? =
    when (code) {
        TileflowBoundaryCode.ID -> TileflowBoundaryKey.Number(id)
        TileflowBoundaryCode.REF -> ref?.let(TileflowBoundaryKey::Text)
        TileflowBoundaryCode.ISO_3166_1 -> iso31661?.let(TileflowBoundaryKey::Text)
        TileflowBoundaryCode.ISO_3166_2 -> iso31662?.let(TileflowBoundaryKey::Text)
        TileflowBoundaryCode.NUTS -> nuts?.let(TileflowBoundaryKey::Text)
        TileflowBoundaryCode.WIKIDATA -> wikidata?.let(TileflowBoundaryKey::Text)
    }

internal fun TileflowBoundaryCode.normalize(key: TileflowBoundaryKey): TileflowBoundaryKey? {
    if (this == TileflowBoundaryCode.ID) {
        val id = when (key) {
            is TileflowBoundaryKey.Number -> key.value
            is TileflowBoundaryKey.Text -> boundaryNumber(key.value.trimBoundaryCode())
        } ?: return null
        if (!id.isSafeBoundaryInteger() || id < 0) return null
        return TileflowBoundaryKey.Number(if (id == 0.0) 0.0 else id)
    }

    val text = (key as? TileflowBoundaryKey.Text)?.value?.trimBoundaryCode()
        ?.takeIf { it.isNotEmpty() } ?: return null
    return TileflowBoundaryKey.Text(if (this == TileflowBoundaryCode.REF) text else text.uppercase())
}

internal fun Double.isSafeBoundaryInteger(): Boolean =
    this in -9007199254740991.0..9007199254740991.0 && this % 1.0 == 0.0

// Use the same whitespace and number syntax as the JavaScript join.
internal fun String.trimBoundaryCode(): String = trim {
    it in '\u0009'..'\u000D' || it in '\u2000'..'\u200A' ||
        it in "\u0020\u00A0\u1680\u2028\u2029\u202F\u205F\u3000\uFEFF"
}

private val decimal = Regex("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
private val based = Regex("0(?:[xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)")

internal fun boundaryNumber(text: String): Double? {
    if (decimal.matches(text)) return text.toDoubleOrNull()
    if (!based.matches(text)) return null
    val radix = when (text[1].lowercaseChar()) {
        'x' -> 16
        'o' -> 8
        else -> 2
    }
    return BigInteger(text.substring(2), radix).toDouble()
}
