package dev.tileflow.sdk.attribution

import java.net.URI

/**
 * Reads a source's attribution, which a style declares as plain text or as HTML with links, into
 * the items a map shows.
 *
 * The text is what a browser shows for the HTML: tags are left out, character references are
 * decoded and runs of white space become one space. Nothing else changes. An attribution that is a
 * list of links separated only by white space, as Tileflow's sources write theirs, gives one item
 * per link, so a credit two sources share appears once; any other attribution is one item, so text
 * around a link stays with it. Only `https` addresses become links.
 */
internal object MapAttributionText {
    data class Item(val text: String, val links: List<MapAttributionEntry.Link>)

    /** A run of text inside one link, or outside any. */
    private class Run(val text: String, val href: String?)

    fun items(attribution: String): List<Item> {
        val runs = runs(attribution)
        val groups = mutableListOf(mutableListOf<Run>())
        for ((index, run) in runs.withIndex()) {
            val separator =
                run.href == null &&
                    run.text.all(::collapsible) &&
                    runs.subList(0, index).lastOrNull { it.text.isNotEmpty() }?.href != null &&
                    runs.subList(index + 1, runs.size).firstOrNull { it.text.isNotEmpty() }?.href !=
                        null
            if (separator) groups += mutableListOf<Run>() else groups.last() += run
        }
        return groups.mapNotNull(::item)
    }

    private val address = Regex("https://[^\\s()<>\"']+")

    /**
     * [links] with every `https` address written in [text] opening itself; where a link covers the
     * address, the address takes that part. Trailing punctuation is not part of an address.
     */
    fun linkingAddresses(
        text: String,
        links: List<MapAttributionEntry.Link>,
    ): List<MapAttributionEntry.Link> {
        val found =
            address
                .findAll(text)
                .mapNotNull { match ->
                    val value = match.value.trimEnd('.', ',', ';', ':', '!', '?')
                    val start = match.range.first
                    if (isPage(value)) MapAttributionEntry.Link(start, start + value.length, value)
                    else null
                }
                .toList()
        if (found.isEmpty()) return links
        val pieces =
            links.flatMap { link ->
                var parts = listOf(link.start to link.end)
                for (inside in found) {
                    parts =
                        parts.flatMap { (start, end) ->
                            if (end <= inside.start || start >= inside.end) listOf(start to end)
                            else
                                listOf(
                                        start to maxOf(start, inside.start),
                                        minOf(end, inside.end) to end,
                                    )
                                    .filter { it.first < it.second }
                        }
                }
                parts.map { MapAttributionEntry.Link(it.first, it.second, link.url) }
            }
        return (pieces + found).sortedBy { it.start }
    }

    /** Whether [address] is an `https` page. */
    fun isPage(address: String): Boolean =
        runCatching { URI(address) }
            .getOrNull()
            ?.let { it.scheme.equals("https", ignoreCase = true) && !it.host.isNullOrEmpty() } ==
            true

    /** White space HTML collapses; a no-break space is kept. */
    private fun collapsible(character: Char): Boolean =
        character.isWhitespace() && character != ' '

    /** The runs' text with white space collapsed and trimmed, and the links among it. */
    private fun item(runs: List<Run>): Item? {
        val text = StringBuilder()
        val links = mutableListOf<MapAttributionEntry.Link>()
        var pendingSpace = false
        for (run in runs) {
            val page = run.href?.takeIf(::isPage)
            var start = -1
            for (character in run.text) {
                if (collapsible(character)) {
                    pendingSpace = text.isNotEmpty()
                    continue
                }
                if (pendingSpace) {
                    text.append(' ')
                    pendingSpace = false
                }
                if (start < 0) start = text.length
                text.append(character)
            }
            if (page != null && start in 0 until text.length)
                links += MapAttributionEntry.Link(start, text.length, page)
        }
        return if (text.isEmpty()) null else Item(text.toString(), links)
    }

    /**
     * Splits HTML into text runs, each inside one link or outside any. Unknown tags are left out; a
     * `<` that opens no tag is text.
     */
    private fun runs(html: String): List<Run> {
        val runs = mutableListOf<Run>()
        var href: String? = null
        val pending = StringBuilder()
        fun flush() {
            if (pending.isNotEmpty()) runs += Run(decode(pending.toString()), href)
            pending.setLength(0)
        }
        var at = 0
        while (at < html.length) {
            val open = html.indexOf('<', at)
            if (open < 0) break
            pending.append(html, at, open)
            val close = html.indexOf('>', open)
            if (close < 0) {
                pending.append(html, open, html.length)
                at = html.length
                break
            }
            val tag = html.substring(open + 1, close)
            at = close + 1
            val closing = tag.startsWith("/")
            val name =
                tag.drop(if (closing) 1 else 0).takeWhile { it.isLetterOrDigit() }.lowercase()
            when {
                name == "a" && !closing -> {
                    flush()
                    href = attribute("href", tag)?.let(::decode)
                }
                name == "a" -> {
                    flush()
                    href = null
                }
                name == "br" -> pending.append(' ')
            }
        }
        if (at < html.length) pending.append(html, at, html.length)
        flush()
        return runs
    }

    /** The value of an attribute of a start tag, quoted or not. */
    private fun attribute(name: String, tag: String): String? {
        var at = tag.indexOfFirst { it.isWhitespace() }.takeIf { it >= 0 } ?: return null
        while (at < tag.length) {
            while (at < tag.length && (tag[at].isWhitespace() || tag[at] == '/')) at++
            val keyStart = at
            while (at < tag.length && !tag[at].isWhitespace() && tag[at] != '=' && tag[at] != '/')
                at++
            val key = tag.substring(keyStart, at)
            while (at < tag.length && tag[at].isWhitespace()) at++
            var value: String? = null
            if (at < tag.length && tag[at] == '=') {
                at++
                while (at < tag.length && tag[at].isWhitespace()) at++
                if (at < tag.length && (tag[at] == '"' || tag[at] == '\'')) {
                    val quote = tag[at]
                    val end = tag.indexOf(quote, at + 1).takeIf { it >= 0 } ?: tag.length
                    value = tag.substring(at + 1, end)
                    at = minOf(end + 1, tag.length)
                } else {
                    val end = tag.indexOfFirst(at) { it.isWhitespace() }
                    value = tag.substring(at, end)
                    at = end
                }
            }
            if (key.equals(name, ignoreCase = true)) return value ?: ""
            if (key.isEmpty() && value == null) at++
        }
        return null
    }

    private fun String.indexOfFirst(from: Int, predicate: (Char) -> Boolean): Int {
        for (index in from until length) if (predicate(this[index])) return index
        return length
    }

    private val named =
        mapOf(
            "amp" to "&",
            "lt" to "<",
            "gt" to ">",
            "quot" to "\"",
            "apos" to "'",
            "nbsp" to " ",
            "copy" to "©",
            "reg" to "®",
            "trade" to "™",
            "mdash" to "—",
            "ndash" to "–",
            "hellip" to "…",
            "middot" to "·",
            "bull" to "•",
            "laquo" to "«",
            "raquo" to "»",
        )

    /** Decodes character references: the common named ones and every numeric one. */
    fun decode(text: String): String {
        if ('&' !in text) return text
        val result = StringBuilder()
        var at = 0
        while (at < text.length) {
            val amp = text.indexOf('&', at)
            if (amp < 0) break
            result.append(text, at, amp)
            val semicolon = text.indexOf(';', amp + 1).takeIf { it in amp + 1..amp + 12 }
            val decoded =
                semicolon?.let {
                    val name = text.substring(amp + 1, it)
                    when {
                        name.startsWith("#x") || name.startsWith("#X") ->
                            name.drop(2).toIntOrNull(16)?.let(::codePoint)
                        name.startsWith("#") -> name.drop(1).toIntOrNull()?.let(::codePoint)
                        else -> named[name]
                    }
                }
            if (decoded != null && semicolon != null) {
                result.append(decoded)
                at = semicolon + 1
            } else {
                result.append('&')
                at = amp + 1
            }
        }
        if (at < text.length) result.append(text, at, text.length)
        return result.toString()
    }

    private fun codePoint(value: Int): String? =
        if (Character.isValidCodePoint(value) && value !in 0xD800..0xDFFF)
            String(Character.toChars(value))
        else null
}
