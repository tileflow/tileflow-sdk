package dev.tileflow.sdk

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.offline.OfflineReachability
import dev.tileflow.sdk.transport.MapResourceContexts
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.maplibre.android.storage.FileSource

/** The fixture map server, reached through `adb reverse tcp:18645 tcp:<port>`. */
internal object Fixture {
    const val ORIGIN = "http://127.0.0.1:18645"
    const val HOSTED_MAP_ID = "map_offlinefixture01"

    /** The fixture's Hosted counters, read directly, never through the SDK. */
    fun counters(reset: Boolean = false): JSONObject {
        val connection = URL("$ORIGIN/__fixture/hosted").openConnection() as HttpURLConnection
        connection.requestMethod = if (reset) "POST" else "GET"
        return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
    }

    fun require(url: String = "$ORIGIN/maps/$HOSTED_MAP_ID/mobile/manifest.json") {
        val reachable = runCatching {
                (URL(url).openConnection() as HttpURLConnection).responseCode == 200
            }
            .getOrDefault(false)
        assumeTrue("Start scripts/mobile-fixture-server.mjs and adb reverse tcp:18645", reachable)
    }
}

/** What MapLibre Native requested while a test ran, as the interception saw it. */
internal class EngineRequests : AutoCloseable {
    /** Tileflow requests: the remote resource and the status answered, or null on failure. */
    val answered = CopyOnWriteArrayList<Pair<URI, Int?>>()
    /** Requests MapLibre sent to its own client. */
    val delegated = CopyOnWriteArrayList<String>()

    // Observers nest: an inner one also reports to the one it replaced, and restores it.
    private val previousRequest = MapResourceContexts.onRequest
    private val previousDelegated = MapResourceContexts.onDelegated

    init {
        MapResourceContexts.onRequest = { url, status ->
            answered.add(url to status)
            previousRequest?.invoke(url, status)
        }
        MapResourceContexts.onDelegated = {
            delegated.add(it)
            previousDelegated?.invoke(it)
        }
    }

    fun matching(fragment: String): List<Pair<URI, Int?>> =
        answered.filter { it.first.toASCIIString().contains(fragment) }

    override fun close() {
        MapResourceContexts.onRequest = previousRequest
        MapResourceContexts.onDelegated = previousDelegated
    }
}

/** Rows MapLibre's own database holds: its ambient cache and offline regions. */
internal fun mapLibreDatabaseRows(context: Context): Map<String, Int> {
    val file = File(FileSource.getResourcesCachePath(context), "mbgl-offline.db")
    if (!file.exists()) return emptyMap()
    val database = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
    return database.use {
        listOf("resources", "tiles").associateWith { table ->
            it.rawQuery("SELECT COUNT(*) FROM $table", null).use { rows ->
                if (rows.moveToFirst()) rows.getInt(0) else 0
            }
        }
    }
}

/** Switches the device's airplane mode, as a person does, and waits until the system agrees. */
internal fun airplaneMode(enabled: Boolean) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val command = "cmd connectivity airplane-mode ${if (enabled) "enable" else "disable"}"
    instrumentation.uiAutomation.executeShellCommand(command).close()
    val deadline = System.currentTimeMillis() + 20_000
    while (
        OfflineReachability.isReachable(instrumentation.targetContext) == enabled &&
            System.currentTimeMillis() < deadline
    )
        Thread.sleep(100)
}
