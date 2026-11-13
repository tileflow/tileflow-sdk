package dev.tileflow.sdk.engine

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.view.View
import dev.tileflow.sdk.transport.ResourcePolicy
import java.math.BigInteger
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

internal data class NativeBrandingSource(val origin: String, val mapId: String?) {
    companion object {
        private val products = setOf("world", "world-detail", "world,world-detail", "terrain", "boundaries", "bathymetry", "bathymetry-dem", "nautical")
        private val mapIdPattern = Regex("^map_[A-Za-z0-9_-]{16}$")

        fun read(style: JSONObject, apiOrigin: String, hostedMapId: String? = null): Set<NativeBrandingSource> {
            val sources = style.optJSONObject("sources") ?: return emptySet()
            val layers = style.optJSONArray("layers") ?: JSONArray()
            val used = (0 until layers.length()).mapNotNull { index ->
                val layer = layers.optJSONObject(index) ?: return@mapNotNull null
                if (layer.optJSONObject("layout")?.optString("visibility") == "none") null
                else layer.opt("source") as? String
            }.toMutableSet()
            (style.optJSONObject("terrain")?.opt("source") as? String)?.let { used.add(it) }
            val saved = style.optJSONObject("metadata")?.optJSONObject("tileflow:brandingSources")
            val result = mutableSetOf<NativeBrandingSource>()
            for (id in used) {
                val source = sources.optJSONObject(id) ?: continue
                val urls = mutableListOf<String>()
                (source.opt("url") as? String)?.let { urls.add(it) }
                source.optJSONArray("tiles")?.let { values ->
                    for (i in 0 until values.length()) (values.opt(i) as? String)?.let { urls.add(it) }
                }
                val prior = saved?.optJSONObject(id)
                val binding = runCatching { JSONArray(prior?.optString("binding")) }.getOrNull()
                val deliveries = prior?.optJSONArray("deliveries")
                if (binding != null && deliveries != null &&
                    (0 until binding.length()).map { binding.opt(it) } == urls) {
                    for (i in 0 until deliveries.length()) {
                        val value = deliveries.optJSONObject(i) ?: continue
                        val mapId = value.opt("mapId") as? String
                        if (value.optString("apiUrl") == apiOrigin && (mapId == null || mapIdPattern.matches(mapId)))
                            result.add(NativeBrandingSource(apiOrigin, mapId))
                    }
                    continue
                }
                for (text in urls) {
                    var url = runCatching { URI(text.replace("{", "%7B").replace("}", "%7D")) }.getOrNull() ?: continue
                    if (url.scheme == "tileflow-contour" && url.host == "tiles") {
                        val dem = query(url, "demTileJson") ?: query(url, "demUrl") ?: continue
                        url = runCatching { URI(dem) }.getOrNull() ?: continue
                    }
                    if (url.scheme !in setOf("http", "https")) continue
                    val origin = ResourcePolicy.origin(url)
                    if (origin != apiOrigin && !(apiOrigin == "https://api.tileflow.dev" && origin == "https://tiles.tileflow.dev")) continue
                    val parts = url.path.split('/').filter { it.isNotEmpty() && it != "v1" }
                    if (parts.size < 2 || parts[0] != "tiles" || parts[1] !in products) continue
                    val mapId = query(url, "map")
                    if (mapId == null || mapIdPattern.matches(mapId)) result.add(NativeBrandingSource(apiOrigin, mapId))
                }
            }
            return result.map { it.copy(mapId = hostedMapId ?: it.mapId) }.toSet()
        }

        private fun query(url: URI, name: String): String? = url.rawQuery?.split('&')?.firstNotNullOfOrNull {
            val pair = it.split('=', limit = 2)
            if (URLDecoder.decode(pair[0], "UTF-8") == name) URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8") else null
        }
    }
}

/** A mounted map owns its leases and cancellation; unknown policy conceals the map. */
internal class NativeBranding(
    private val load: (URI) -> ByteArray,
    private val offline: () -> Pair<Boolean, Boolean?>,
    private val present: (State) -> Unit,
) {
    enum class State { PENDING, REQUIRED, NONE }
    private data class Lease(val required: Boolean, val revision: BigInteger, val expires: Long)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var task: Job? = null
    private var expiryTask: Job? = null
    private var sources: Set<NativeBrandingSource>? = null
    private val leases = mutableMapOf<NativeBrandingSource, Lease>()

    fun update(next: Set<NativeBrandingSource>) {
        if (next == sources) return
        sources = next
        task?.cancel()
        expiryTask?.cancel()
        leases.keys.retainAll(next)
        present(if (next.any { it.mapId != null }) State.PENDING else if (next.isEmpty()) State.NONE else State.REQUIRED)
        if (next.none { it.mapId != null }) return
        task = scope.launch {
            while (isActive) {
                refresh(next)
                val untilExpiry = leases.values.map { it.expires - SystemClock.elapsedRealtime() }.filter { it > 0 }.minOrNull() ?: 5000L
                delay(minOf(5000L, untilExpiry).coerceAtLeast(1L))
            }
        }
    }

    private suspend fun refresh(sources: Set<NativeBrandingSource>) {
        if (sources.isEmpty()) { present(State.NONE); return }
        val (fromPacks, receipt) = withContext(Dispatchers.IO) { offline() }
        if (fromPacks) {
            expiryTask?.cancel()
            present(when (receipt) { true -> State.REQUIRED; false -> State.NONE; null -> State.PENDING })
            return
        }
        var ready = true
        var required = sources.any { it.mapId == null }
        for (source in sources) {
            val mapId = source.mapId ?: continue
            val now = SystemClock.elapsedRealtime()
            if ((leases[source]?.expires ?: 0) <= now) present(State.PENDING)
            if ((leases[source]?.expires ?: 0) - now < 30000) {
                try {
                    val value = withContext(Dispatchers.IO) { JSONObject(String(load(URI("${source.origin}/maps/$mapId/mobile/branding")), Charsets.UTF_8)) }
                    currentCoroutineContext().ensureActive()
                    val revision = value.opt("revision") as? String ?: error("Invalid revision")
                    val validity = (value.opt("validForMs") as? Number)?.toDouble() ?: error("Invalid validity")
                    val decision = value.opt("catalogLogoRequired") as? Boolean ?: error("Invalid branding")
                    check(value.optString("mapId") == mapId && revision.matches(Regex("^[0-9]{1,32}$")) &&
                        validity.isFinite() && validity > 0 && validity <= 900000 && now + validity > SystemClock.elapsedRealtime())
                    val version = BigInteger(revision)
                    check(leases[source]?.let { version >= it.revision } ?: true)
                    leases[source] = Lease(decision, version, now + validity.toLong())
                    watchExpiry()
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) {}
            }
            val lease = leases[source]
            if (lease != null && lease.expires > SystemClock.elapsedRealtime()) required = required || lease.required
            else ready = false
        }
        present(if (!ready) State.PENDING else if (required) State.REQUIRED else State.NONE)
    }

    private fun watchExpiry() {
        expiryTask?.cancel()
        val expires = leases.values.minOfOrNull { it.expires } ?: return
        expiryTask = scope.launch {
            delay((expires - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
            present(State.PENDING)
        }
    }

    fun retire() { scope.cancel(); sources = null; leases.clear() }
}

internal class NativeBrandingButton(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    init { contentDescription = "Visit Tileflow"; isClickable = true; visibility = GONE; setLayerType(LAYER_TYPE_SOFTWARE, null) }
    override fun onDraw(canvas: Canvas) {
        val density = resources.displayMetrics.density
        canvas.save()
        canvas.scale(density, density)
        paint.color = Color.argb(230, 255, 255, 255)
        paint.typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
        paint.textSize = 17f
        paint.setShadowLayer(2f, 0f, 0f, Color.argb(77, 0, 0, 0))
        canvas.drawText("Tileflow", 10f, 31f, paint)
        val symbolLeft = 11f + paint.measureText("Tileflow")
        for ((x, y) in listOf(0 to 0, 6 to 0, (3 to 6), (9 to 6), (6 to 12), (12 to 12))) {
            val left = symbolLeft + x * 0.77f
            val top = 12f + y * 0.77f
            canvas.drawRect(left, top, left + 3.08f, top + 3.08f, paint)
        }
        canvas.restore()
    }
}
