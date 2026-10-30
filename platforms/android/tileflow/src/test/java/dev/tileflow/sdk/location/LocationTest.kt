package dev.tileflow.sdk.location

import android.Manifest
import android.app.Application
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import dev.tileflow.sdk.MapLocation
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowMapControls
import dev.tileflow.sdk.TileflowMapEvent
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapOptions
import dev.tileflow.sdk.TileflowMapView
import dev.tileflow.sdk.compassTapped
import dev.tileflow.sdk.receiveFollowModeChanged
import dev.tileflow.sdk.recenterTapped
import dev.tileflow.sdk.location.PlatformLocationEngine.Companion.isBetter
import java.lang.ref.WeakReference
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
public class LocationTest {
    private class Recorder : TileflowLocationConsumer {
        val locations = mutableListOf<TileflowLocation>()
        val headings = mutableListOf<TileflowHeading>()

        override fun locationUpdated(location: TileflowLocation) {
            locations += location
        }

        override fun headingUpdated(heading: TileflowHeading) {
            headings += heading
        }
    }

    /** About 111 m east, then 111 m north, near the equator. */
    private val route =
        listOf(
            TileflowCoordinate(0.0, 0.0),
            TileflowCoordinate(0.001, 0.0),
            TileflowCoordinate(0.001, 0.001),
        )

    private val context: Context = RuntimeEnvironment.getApplication()

    @Test
    public fun theSimulatedProviderReplaysARouteAtItsSpeed() {
        val provider =
            TileflowSimulatedLocationProvider(
                route,
                speed = 10.0,
                horizontalAccuracy = 8.0,
                playsAutomatically = false,
            )
        assertEquals(222.4, provider.length, 0.5)
        // A new consumer receives the start of the route at once, travelling east.
        val first = Recorder()
        provider.addConsumer(first)
        assertEquals(1, first.locations.size)
        assertEquals(0.0, first.locations[0].coordinate.longitude, 0.0)
        assertEquals(90.0, first.locations[0].course!!, 0.01)
        assertEquals(8.0, first.locations[0].horizontalAccuracy!!, 0.0)
        assertEquals(90.0, first.headings.last().direction, 0.01)

        // Each step moves by the distance the speed covers; positions between vertices interpolate.
        val halfway = provider.advance(5_560)
        assertEquals(0.0005, halfway.coordinate.longitude, 0.00001)
        val turned = provider.advance(6_000)
        assertEquals(0.001, turned.coordinate.longitude, 1e-9)
        assertTrue(turned.coordinate.latitude > 0)
        assertEquals(0.0, turned.course!!, 0.01)
        assertEquals(3, first.locations.size)

        // A later consumer starts at the current position; a removed one hears nothing more.
        val second = Recorder()
        provider.addConsumer(second)
        assertEquals(listOf(turned), second.locations)
        provider.removeConsumer(first)
        provider.advance(100_000)
        assertEquals(3, first.locations.size)
        assertEquals(2, second.locations.size)
        // The route ends at its last point, standing still.
        assertTrue(provider.isFinished)
        assertEquals(route.last(), second.locations.last().coordinate)
        assertEquals(0.0, second.locations.last().speed!!, 0.0)
    }

    @Test
    public fun aLoopingRouteStartsAgainAndProvidersHoldConsumersWeakly() {
        val provider =
            TileflowSimulatedLocationProvider(
                route,
                speed = 100.0,
                loops = true,
                playsAutomatically = false,
            )
        var consumer: Recorder? = Recorder()
        provider.addConsumer(consumer!!)
        provider.addConsumer(consumer)
        assertEquals("A consumer is added once.", 1, consumer.locations.size)
        val looped = provider.advance(2_500)
        assertFalse(provider.isFinished)
        assertEquals(250 - provider.length, provider.distance, 0.001)
        assertEquals(90.0, looped.course!!, 0.01)
        val consumers = LocationConsumers()
        consumers.add(consumer)
        val released = WeakReference(consumer)
        consumer = null
        System.gc()
        if (released.get() == null) assertTrue("A provider never keeps a consumer alive.", consumers.isEmpty)
    }

    @Test
    public fun androidFixesConvertAndReachTheRendererWithTheirAge() {
        val fix =
            Location(LocationManager.GPS_PROVIDER).apply {
                latitude = 40.42
                longitude = -3.7
                time = 1_000
                accuracy = 12f
            }
        val location = TileflowLocation.of(fix)
        assertEquals(TileflowCoordinate(-3.7, 40.42), location.coordinate)
        assertEquals(12.0, location.horizontalAccuracy!!, 0.0)
        assertNull(location.course)
        assertNull(location.speed)
        assertNull(location.altitude)

        val aged =
            TileflowLocation(
                TileflowCoordinate(1.0, 2.0),
                timestamp = 7_500,
                horizontalAccuracy = 5.0,
                course = -90.0,
            )
        val wire = MapLocation.wire(aged, now = 10_000)
        assertEquals(2_500L, wire.getLong("age"))
        assertEquals(270.0, wire.getDouble("course"), 0.0)
        assertEquals(5.0, wire.getDouble("accuracy"), 0.0)
        assertEquals("A clock ahead never ages.", 0L, MapLocation.wire(aged, now = 0).getLong("age"))
        assertEquals(5.0, MapLocation.normalized(725.0), 0.0)
    }

    @Test
    public fun locationOptionsReachTheRendererWithinTheirRanges() {
        val json =
            TileflowLocationOptions(
                    enabled = true,
                    puckBearing = TileflowPuckBearing.COURSE,
                    staleAfterMillis = 10_000,
                )
                .json()
        assertEquals(
            JSONObject(
                    """{"enabled":true,"bearing":"course","accuracy":true,"staleAfterMs":10000}"""
                )
                .toString(),
            json.toString(),
        )
        assertThrows(TileflowMapException::class.java) {
            TileflowLocationOptions(staleAfterMillis = 500).json()
        }
        assertThrows(TileflowMapException::class.java) {
            TileflowLocationOptions(followZoom = 30.0).json()
        }
    }

    @Test
    public fun theFollowModeAnswersPeopleAndTheApplication() {
        val state = FollowModeState()
        assertNull("Nothing ends while nothing follows.", state.end(TileflowFollowModeChangeReason.GESTURE))
        assertTrue(state.set(TileflowFollowMode.COURSE))
        assertFalse(state.set(TileflowFollowMode.COURSE))
        // The compass keeps following, north up.
        assertEquals(
            TileflowFollowModeChange(TileflowFollowMode.POSITION, TileflowFollowModeChangeReason.GESTURE),
            state.compass(),
        )
        assertNull(state.compass())
        // A gesture ends following; the recenter button returns to the mode followed last.
        assertEquals(
            TileflowFollowModeChange(TileflowFollowMode.NONE, TileflowFollowModeChangeReason.GESTURE),
            state.end(TileflowFollowModeChangeReason.GESTURE),
        )
        assertEquals(TileflowFollowMode.POSITION, state.recenter().mode)
        assertEquals(TileflowFollowMode.HEADING, state.recenter().mode)
        assertEquals(TileflowFollowMode.POSITION, state.recenter().mode)
        state.set(TileflowFollowMode.HEADING)
        assertEquals(TileflowFollowModeChangeReason.API, state.end(TileflowFollowModeChangeReason.API)?.reason)
        assertEquals(TileflowFollowMode.HEADING, state.recenter().mode)
    }

    @Test
    public fun aMapEndsFollowingForGesturesAndCameraMovesAndReportsIt(): Unit = runBlocking {
        val view = TileflowMapView(context)
        view.setOptions(TileflowMapOptions(controls = TileflowMapControls(recenterButton = true)))
        val events = mutableListOf<TileflowMapEvent>()
        view.onEvent = { events += it }
        val changes = { events.filterIsInstance<TileflowMapEvent.FollowModeChanged>().map { it.change } }

        // Without the location shown, the recenter button asks the application.
        view.recenterTapped()
        assertTrue(TileflowMapEvent.RecenterRequested in events)
        val shown = view.options.copy(location = TileflowLocationOptions(enabled = true))
        view.setOptions(shown)

        // The application's own changes are not reported back.
        view.followMode = TileflowFollowMode.HEADING
        assertEquals(TileflowFollowMode.HEADING, view.followMode)
        assertEquals(emptyList<TileflowFollowModeChange>(), changes())
        // A gesture the renderer reports for an older request is ignored; the current one ends it.
        val revision = view.location.revision
        view.receiveFollowModeChanged(JSONObject().put("reason", "gesture").put("revision", revision - 1))
        assertEquals(TileflowFollowMode.HEADING, view.followMode)
        view.receiveFollowModeChanged(JSONObject().put("reason", "gesture").put("revision", revision))
        assertEquals(TileflowFollowMode.NONE, view.followMode)
        assertEquals(
            listOf(TileflowFollowModeChange(TileflowFollowMode.NONE, TileflowFollowModeChangeReason.GESTURE)),
            changes(),
        )

        // The recenter button follows again; the compass keeps following, north up.
        view.recenterTapped()
        assertEquals(TileflowFollowMode.HEADING, view.followMode)
        assertTrue(view.compassTapped())
        assertEquals(TileflowFollowMode.POSITION, view.followMode)
        assertEquals(TileflowFollowMode.POSITION, view.controlsView.followMode)

        // A camera movement the application asks for ends following.
        view.jump(TileflowCamera(1.0, 1.0, 3.0))
        assertEquals(TileflowFollowMode.NONE, view.followMode)
        assertEquals(TileflowFollowModeChangeReason.API, changes().last().reason)
        // So does turning the location off.
        view.followMode = TileflowFollowMode.COURSE
        view.setOptions(shown.copy(location = TileflowLocationOptions(enabled = false)))
        assertEquals(TileflowFollowMode.NONE, view.followMode)
        assertEquals(TileflowFollowModeChangeReason.API, changes().last().reason)
        assertFalse("The compass acts on the camera when nothing follows.", view.compassTapped())
        view.destroy()
    }

    @Test
    public fun theDefaultProviderFallsBackToThePlatformAndMeasuresOnlyWithAccessAndConsumers() {
        val application = context as Application
        val provider = TileflowDefaultLocationProvider(context)
        // Play services is not on this classpath: the platform's LocationManager serves positions.
        assertFalse(provider.usesGooglePlayServices)
        val consumer = Recorder()
        val manager = context.getSystemService(LocationManager::class.java)
        val shadow = shadowOf(manager)
        shadow.setProviderEnabled(LocationManager.GPS_PROVIDER, true)
        shadow.setProviderEnabled(LocationManager.NETWORK_PROVIDER, true)
        provider.addConsumer(consumer)
        val fix =
            Location(LocationManager.GPS_PROVIDER).apply {
                latitude = 40.42
                longitude = -3.7
                accuracy = 5f
                time = System.currentTimeMillis()
            }
        shadow.simulateLocation(fix)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("Without access nothing is measured.", consumer.locations.isEmpty())
        assertEquals(TileflowLocationAuthorization.DENIED, TileflowLocationPermissions.authorization(context))

        // A granted request starts measuring at once.
        shadowOf(application).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        assertEquals(TileflowLocationAccuracy.REDUCED, TileflowLocationPermissions.accuracy(context))
        shadowOf(application).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        PermissionChanges.notifyChanged()
        shadow.simulateLocation(fix)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(TileflowCoordinate(-3.7, 40.42), consumer.locations.last().coordinate)
        assertEquals(TileflowLocationAccuracy.FULL, TileflowLocationPermissions.accuracy(context))

        // Without consumers it stops.
        provider.removeConsumer(consumer)
        val count = consumer.locations.size
        shadow.simulateLocation(Location(fix).apply { time += 5_000 })
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(count, consumer.locations.size)
    }

    @Test
    public fun thePlatformEngineKeepsTheBetterOfItsProviders() {
        fun fix(provider: String, time: Long, accuracy: Float) =
            Location(provider).apply {
                this.time = time
                this.accuracy = accuracy
            }
        val gps = fix(LocationManager.GPS_PROVIDER, 10_000, 5f)
        assertTrue(isBetter(gps, null))
        assertFalse(isBetter(fix(LocationManager.NETWORK_PROVIDER, 11_000, 50f), gps))
        assertTrue(isBetter(fix(LocationManager.NETWORK_PROVIDER, 11_000, 4f), gps))
        assertTrue(isBetter(fix(LocationManager.GPS_PROVIDER, 11_000, 30f), gps))
        assertTrue("A much newer fix wins.", isBetter(fix(LocationManager.NETWORK_PROVIDER, 30_000, 900f), gps))
        assertFalse(isBetter(fix(LocationManager.GPS_PROVIDER, 9_000, 1f), gps))
    }

    @Test
    public fun theRequestContractAsksForTheAccuracyItNeeds() {
        assertEquals(
            listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            TileflowLocationPermissions.permissions(TileflowLocationAccuracy.FULL).toList(),
        )
        val contract = TileflowLocationPermissions.RequestWhenInUse()
        assertNull(contract.getSynchronousResult(context, TileflowLocationAccuracy.REDUCED))
        shadowOf(context as Application).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        assertEquals(
            TileflowLocationAuthorization.WHEN_IN_USE,
            contract.getSynchronousResult(context, TileflowLocationAccuracy.REDUCED)?.value,
        )
        assertNull(
            "The precise location still asks.",
            contract.getSynchronousResult(context, TileflowLocationAccuracy.FULL),
        )
    }
}
