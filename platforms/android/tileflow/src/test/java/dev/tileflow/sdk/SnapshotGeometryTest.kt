package dev.tileflow.sdk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SnapshotGeometryTest {
    @Test
    fun creditsFollowTheViewportThroughTheAntimeridianAndWorldCopies() {
        fun longitude(value: Double) = ((value + 540) % 360) - 180
        val crossing =
            SnapshotBounds.measure(128.0, 64.0) { x, y ->
                TileflowCoordinate(longitude(170 + x / 128 * 20), 20 - y / 64 * 10)
            }
        assertArrayEquals(doubleArrayOf(170.0, 10.0, 190.0, 20.0), crossing, 1e-9)
        val copies =
            SnapshotBounds.measure(1024.0, 64.0) { x, y ->
                TileflowCoordinate(longitude(-170 + 720 * x / 1024), 20 - y / 64 * 10)
            }
        assertEquals(720.0, copies[2] - copies[0], 1e-9)
        val horizon =
            SnapshotBounds.measure(128.0, 64.0) { _, _ ->
                TileflowCoordinate(Double.NaN, Double.NaN)
            }
        assertArrayEquals(doubleArrayOf(-180.0, -90.0, 180.0, 90.0), horizon, 0.0)
    }

    @Test
    fun physicalLimitAccountsForTheRoundedMapLibreViewport() {
        TileflowMapSnapshotOptions(2047.25f, 2048f, 2f).validate()
        assertThrows(TileflowMapException::class.java) {
            TileflowMapSnapshotOptions(0.5f, 0.5f, 8192f).validate()
        }
    }

    @Test
    fun standaloneOptionsValidateGeometryAndFeatureIds() {
        val circle = TileflowCircleAnnotationOptions().withPoint(TileflowCoordinate(2.0, 3.0))
        assertEquals("snapshot-marker", circle.build("snapshot-marker").id)
        assertThrows(TileflowMapException::class.java) { circle.build("../other") }
        assertThrows(TileflowMapException::class.java) {
            TileflowCircleAnnotationOptions().build("marker")
        }
    }
}
