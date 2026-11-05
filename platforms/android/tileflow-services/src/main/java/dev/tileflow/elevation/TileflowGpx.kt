package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.internal.TileflowText
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.StringReader
import javax.xml.XMLConstants
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.helpers.DefaultHandler

/** A GPX point and its recorded elevation in metres, when it has one. */
public data class TileflowGpxPoint(
    public val position: TileflowPosition,
    public val elevation: Double?,
)

/**
 * The tracks and routes of a GPX document: one line per track segment and per route, in document
 * order. Waypoints are not lines and are left out.
 *
 * @property name The first track or route name, when the document has one.
 */
public data class TileflowGpxTrack(
    public val name: String?,
    public val lines: List<List<TileflowGpxPoint>>,
)

/** A document [TileflowGpx] cannot read. */
public class TileflowGpxException(public val reason: Reason) : Exception(reason.description) {
    public enum class Reason(internal val description: String) {
        /** The document is not well-formed XML with a `gpx` root element. */
        NOT_GPX("The document is not a GPX document."),
        /** A point has no latitude or longitude, or one outside its range. */
        INVALID_POINT("The GPX document has an invalid point."),
        /** The document has more than 1,000,000 track and route points. */
        TOO_MANY_POINTS("The GPX document has too many points."),
        /** No track segment or route has at least two points. */
        NO_TRACK_OR_ROUTE("The GPX document has no track or route."),
    }
}

/**
 * Reads GPX 1.0 and 1.1 documents. Namespace prefixes are ignored, external entities and DTDs are
 * never loaded, and lines with fewer than two points are left out. Reading is blocking: read large
 * documents off the main thread.
 */
public object TileflowGpx {
    private const val MAXIMUM_POINTS = 1_000_000
    private val NUMBER = Regex("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")

    /** @throws TileflowGpxException when the document cannot be read. */
    @JvmStatic
    public fun read(bytes: ByteArray): TileflowGpxTrack = read(ByteArrayInputStream(bytes))

    /**
     * Reads a document from [stream], which the caller closes.
     *
     * @throws TileflowGpxException when the document cannot be read.
     * @throws java.io.IOException when the stream fails.
     */
    @JvmStatic
    public fun read(stream: InputStream): TileflowGpxTrack {
        val handler = Handler()
        try {
            val reader = parserFactory().newSAXParser().xmlReader
            // Any external entity or DTD the parser would still load resolves to nothing.
            reader.setEntityResolver { _, _ -> InputSource(StringReader("")) }
            reader.contentHandler = handler
            reader.errorHandler = handler
            reader.parse(InputSource(stream))
        } catch (error: SAXException) {
            throw TileflowGpxException(stop(error)?.reason ?: TileflowGpxException.Reason.NOT_GPX)
        } catch (error: javax.xml.parsers.ParserConfigurationException) {
            throw TileflowGpxException(TileflowGpxException.Reason.NOT_GPX)
        }
        if (!handler.root) throw TileflowGpxException(TileflowGpxException.Reason.NOT_GPX)
        if (handler.lines.isEmpty())
            throw TileflowGpxException(TileflowGpxException.Reason.NO_TRACK_OR_ROUTE)
        return TileflowGpxTrack(handler.name, handler.lines)
    }

    private fun parserFactory(): SAXParserFactory {
        val factory = SAXParserFactory.newInstance()
        factory.isNamespaceAware = false
        factory.isValidating = false
        for ((feature, enabled) in
            listOf(
                XMLConstants.FEATURE_SECURE_PROCESSING to true,
                "http://xml.org/sax/features/external-general-entities" to false,
                "http://xml.org/sax/features/external-parameter-entities" to false,
                "http://apache.org/xml/features/nonvalidating/load-external-dtd" to false,
            )) {
            // Parsers that do not know a feature never load external content by themselves.
            try {
                factory.setFeature(feature, enabled)
            } catch (_: Exception) {}
        }
        return factory
    }

    private fun stop(error: Throwable): Stop? {
        var current: Throwable? = error
        repeat(8) {
            if (current is Stop) return current as Stop
            current = (current as? SAXException)?.exception ?: current?.cause
        }
        return null
    }

    private class Stop(val reason: TileflowGpxException.Reason) : SAXException(reason.description)

    private fun number(value: String?): Double? {
        val text = value?.let(TileflowText::trim) ?: return null
        if (!NUMBER.matches(text)) return null
        return text.toDouble().takeIf { it.isFinite() }
    }

    private class Handler : DefaultHandler() {
        var root = false
        val lines = mutableListOf<List<TileflowGpxPoint>>()
        var name: String? = null
        private var nameFound = false
        private var points = 0
        private var depth = 0
        private var segmentDepth = -1
        private var segment = mutableListOf<TileflowGpxPoint>()
        private var pointDepth = -1
        private var pointPosition: TileflowPosition? = null
        private var pointElevation: Double? = null
        private var elevationRead = false
        private var elevationDepth = -1
        private var nameHolderDepth = -1
        private var nameDepth = -1
        private val text = StringBuilder()

        override fun startElement(
            uri: String?,
            localName: String?,
            qName: String?,
            attributes: Attributes,
        ) {
            // Namespace prefixes are ignored.
            val local =
                (qName?.takeIf { it.isNotEmpty() } ?: localName.orEmpty()).substringAfter(':')
            depth += 1
            if (depth == 1) {
                if (local != "gpx") throw Stop(TileflowGpxException.Reason.NOT_GPX)
                root = true
            }
            // A track or route name is its first child element.
            if (nameHolderDepth == depth - 1) {
                nameHolderDepth = -1
                if (local == "name" && !nameFound) {
                    nameDepth = depth
                    text.setLength(0)
                }
            }
            if ((local == "trk" || local == "rte") && !nameFound) nameHolderDepth = depth
            if (segmentDepth == -1) {
                if (local == "trkseg" || local == "rte") {
                    segmentDepth = depth
                    segment = mutableListOf()
                }
            } else if (pointDepth == -1 && (local == "trkpt" || local == "rtept")) {
                points += 1
                if (points > MAXIMUM_POINTS) throw Stop(TileflowGpxException.Reason.TOO_MANY_POINTS)
                val latitude = number(attributes.getValue("lat"))
                val longitude = number(attributes.getValue("lon"))
                if (
                    latitude == null ||
                        longitude == null ||
                        latitude !in -90.0..90.0 ||
                        longitude !in -180.0..180.0
                )
                    throw Stop(TileflowGpxException.Reason.INVALID_POINT)
                pointDepth = depth
                pointPosition = TileflowPosition(longitude, latitude)
                pointElevation = null
                elevationRead = false
            } else if (
                pointDepth != -1 && local == "ele" && !elevationRead && elevationDepth == -1
            ) {
                elevationDepth = depth
                text.setLength(0)
            }
        }

        override fun characters(ch: CharArray, start: Int, length: Int) {
            if (elevationDepth != -1 || nameDepth != -1) text.append(ch, start, length)
        }

        override fun endElement(uri: String?, localName: String?, qName: String?) {
            if (depth == elevationDepth) {
                pointElevation = number(text.toString())
                elevationRead = true
                elevationDepth = -1
            }
            if (depth == nameDepth) {
                name = TileflowText.trim(text.toString()).ifEmpty { null }
                nameFound = true
                nameDepth = -1
            }
            if (depth == pointDepth) {
                segment.add(TileflowGpxPoint(checkNotNull(pointPosition), pointElevation))
                pointDepth = -1
            }
            if (depth == segmentDepth) {
                if (segment.size >= 2) lines.add(segment)
                segmentDepth = -1
            }
            if (depth == nameHolderDepth) nameHolderDepth = -1
            depth -= 1
        }

        override fun fatalError(exception: org.xml.sax.SAXParseException) {
            throw exception
        }
    }
}
