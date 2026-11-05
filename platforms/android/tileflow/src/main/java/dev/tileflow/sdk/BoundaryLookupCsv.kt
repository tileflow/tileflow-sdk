package dev.tileflow.sdk

/** Parses the UTF-8 text of a decompressed Boundaries lookup CSV. */
public fun parseBoundaryLookupCsv(text: String): List<TileflowBoundaryLookupRow> =
    parseBoundaryLookupCsv(text) { true }

internal fun parseBoundaryLookupCsv(
    text: String,
    keep: (TileflowBoundaryLookupRow) -> Boolean,
): List<TileflowBoundaryLookupRow> {
    val records = boundaryCsvRecords(text).iterator()
    val header = if (records.hasNext()) records.next() else null
    require(header != null && "id" in header && "class" in header) {
        "Boundaries lookup CSV must start with a header that has id and class."
    }

    val rows = mutableListOf<TileflowBoundaryLookupRow>()
    var line = 1
    while (records.hasNext()) {
        val record = records.next()
        line++
        if (record.size == 1 && record[0].isEmpty()) continue
        require(record.size == header.size) {
            "Boundaries lookup CSV row $line has ${record.size} fields; expected ${header.size}."
        }

        val cells = buildMap {
            for ((position, name) in header.withIndex()) {
                val cell = record[position]
                if (cell.isNotEmpty()) put(name, cell)
            }
        }
        fun number(name: String): Double? = cells[name]?.let {
            val trimmed = it.trimBoundaryCode()
            val number = if (trimmed.isEmpty()) 0.0 else boundaryNumber(trimmed)
            require(number != null && number.isSafeBoundaryInteger()) {
                "Boundaries lookup CSV row $line has a non-integer $name."
            }
            number
        }
        val id = requireNotNull(number("id")) { "Boundaries lookup row has an invalid id: undefined." }
        val className = cells["class"]
        val boundaryClass = TileflowBoundaryClass.entries.firstOrNull { it.wireName == className }
            ?: throw IllegalArgumentException("Unknown Boundaries class: ${className ?: "undefined"}.")
        val adminLevel = number("admin_level")?.toLong()
        val tier = cells["class_tier"]
        require(tier == null || tier == "primary" || tier == "secondary") {
            "Boundaries lookup CSV row $line has an unknown class_tier."
        }

        val row = TileflowBoundaryLookupRow(
            id = id,
            boundaryClass = boundaryClass,
            adminLevel = adminLevel,
            classTier = tier,
            iso31661 = cells["iso_3166_1"],
            iso31662 = cells["iso_3166_2"],
            name = cells["name"],
            nameEn = cells["name_en"],
            nuts = cells["nuts"],
            ref = cells["ref"],
            wikidata = cells["wikidata"],
        )
        if (keep(row)) rows += row
    }
    return rows
}

private fun boundaryCsvRecords(text: String): Sequence<List<String>> = sequence {
    var record = mutableListOf<String>()
    val field = StringBuilder()
    var quoted = false
    var index = 0

    while (index < text.length) {
        val char = text[index]
        when {
            quoted && char == '"' -> {
                if (text.getOrNull(index + 1) == '"') {
                    field.append('"')
                    index++
                } else {
                    quoted = false
                }
            }
            quoted -> field.append(char)
            char == '"' && field.isEmpty() -> quoted = true
            char == ',' -> {
                record.add(field.toString())
                field.clear()
            }
            char == '\n' || char == '\r' -> {
                if (char == '\r' && text.getOrNull(index + 1) == '\n') index++
                record.add(field.toString())
                yield(record)
                record = mutableListOf()
                field.clear()
            }
            else -> field.append(char)
        }
        index++
    }

    require(!quoted) { "Boundaries lookup CSV ends inside a quoted field." }
    if (field.isNotEmpty() || record.isNotEmpty()) {
        record.add(field.toString())
        yield(record)
    }
}
