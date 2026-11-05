package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.testing.failure
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class GpxTest {
    private fun read(text: String) = TileflowGpx.read(text.toByteArray())

    private fun reason(text: String) = failure<TileflowGpxException> { read(text) }.reason

    @Test
    fun tracksAndRoutesBecomeLinesInDocumentOrder() {
        val track =
            read(
                """<?xml version="1.0" encoding="UTF-8"?>
                <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"
                     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
                  <wpt lat="1" lon="1"><name>Waypoint</name></wpt>
                  <trk>
                    <!-- recorded -->
                    <name> Morning &amp; ride </name>
                    <trkseg>
                      <trkpt lat="40.4168" lon="-3.7038">
                        <ele>657.5</ele><time>2026-10-01T08:00:00Z</time>
                      </trkpt>
                      <trkpt lat=" 40.4170 " lon='-3.7030'>
                        <extensions><gpxtpx:hr>120</gpxtpx:hr></extensions>
                      </trkpt>
                      <trkpt lat="40.4172" lon="-3.7020"><ele>not a number</ele></trkpt>
                    </trkseg>
                    <trkseg><trkpt lat="40.5" lon="-3.6"/></trkseg>
                  </trk>
                  <rte><name>Second</name>
                    <rtept lat="41" lon="-3"><ele><![CDATA[700]]></ele></rtept>
                    <rtept lat="42" lon="-3"/>
                  </rte>
                </gpx>"""
            )
        assertEquals("Morning & ride", track.name)
        assertEquals(2, track.lines.size)
        assertEquals(
            listOf(
                TileflowGpxPoint(TileflowPosition(-3.7038, 40.4168), 657.5),
                TileflowGpxPoint(TileflowPosition(-3.703, 40.417), null),
                TileflowGpxPoint(TileflowPosition(-3.702, 40.4172), null),
            ),
            track.lines[0],
        )
        assertEquals(
            listOf(
                TileflowGpxPoint(TileflowPosition(-3.0, 41.0), 700.0),
                TileflowGpxPoint(TileflowPosition(-3.0, 42.0), null),
            ),
            track.lines[1],
        )
    }

    @Test
    fun prefixedDocumentsAndRoutesWithoutNamesRead() {
        val track =
            read(
                """<g:gpx xmlns:g="http://www.topografix.com/GPX/1/0">
                  <g:trk>
                    <g:trkseg><g:trkpt lat="1" lon="2"/><g:trkpt lat="3" lon="4"/></g:trkseg>
                  </g:trk>
                  <g:rte><g:name>Later</g:name></g:rte>
                </g:gpx>"""
            )
        // The first track has no name, so the first named route names the document.
        assertEquals("Later", track.name)
        assertEquals(
            listOf(TileflowPosition(2.0, 1.0), TileflowPosition(4.0, 3.0)),
            track.lines.single().map { it.position },
        )
        val unnamed =
            """<gpx><trk><name> </name><trkseg>
                 <trkpt lat="1" lon="2"/><trkpt lat="1" lon="3"/>
               </trkseg></trk></gpx>"""
        assertNull(read(unnamed).name)
    }

    @Test
    fun invalidDocumentsFailWithTheirReason() {
        assertEquals(TileflowGpxException.Reason.NOT_GPX, reason("""<kml><trkseg/></kml>"""))
        assertEquals(TileflowGpxException.Reason.NOT_GPX, reason("""<gpx><trk>"""))
        assertEquals(TileflowGpxException.Reason.NOT_GPX, reason("not xml"))
        for (point in
            listOf(
                """lat="91" lon="0"""",
                """lat="0" lon="-180.5"""",
                """lat="0"""",
                """lat="" lon="0"""",
                """lat="NaN" lon="0"""",
                """lat="0x10" lon="0"""",
            )) {
            assertEquals(
                TileflowGpxException.Reason.INVALID_POINT,
                reason(
                    """<gpx><trk><trkseg>
                         <trkpt $point/><trkpt lat="0" lon="0"/>
                       </trkseg></trk></gpx>"""
                ),
            )
        }
        assertEquals(
            TileflowGpxException.Reason.NO_TRACK_OR_ROUTE,
            reason(
                """<gpx><wpt lat="1" lon="1"/>
                     <trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>
                   </gpx>"""
            ),
        )
        val many = StringBuilder("<gpx><trk><trkseg>")
        repeat(1_000_001) { many.append("<trkpt lat=\"0\" lon=\"0\"/>") }
        assertEquals(
            TileflowGpxException.Reason.TOO_MANY_POINTS,
            reason(many.append("</trkseg></trk></gpx>").toString()),
        )
    }

    @Test
    fun externalEntitiesAreNeverLoaded() {
        val secret = File.createTempFile("tileflow-gpx", ".txt")
        try {
            secret.writeText("private")
            val document =
                """<?xml version="1.0"?>
                <!DOCTYPE gpx [<!ENTITY secret SYSTEM "${secret.toURI()}">]>
                <gpx><trk><name>&secret;</name><trkseg>
                  <trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/>
                </trkseg></trk></gpx>"""
            val name =
                try {
                    read(document).name
                } catch (error: TileflowGpxException) {
                    null
                }
            assertFalse(name.orEmpty().contains("private"))
        } finally {
            secret.delete()
        }
    }
}
