package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCoordinate
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

/** Scene arithmetic shared by live frames and the Core parity fixtures. */
internal object NativeSceneMath {
    private const val radians = PI / 180
    private fun turn(value: Double, full: Double): Double = ((value % full) + full) % full
    fun smooth(t: Double): Double = t * t * (3 - 2 * t)
    fun mix(a: Double, b: Double, t: Double): Double = if (t <= 0) a else if (t >= 1) b else a + (b - a) * t

    data class Direction(val azimuth: Double, val altitude: Double)

    /** NOAA solar position with the apparent elevation corrected for atmospheric refraction. */
    fun sunPosition(date: Double, longitude: Double, latitude: Double): Direction {
        val t = (date / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525
        val mean = turn(280.46646 + t * (36_000.76983 + t * 0.0003032), 360.0)
        val m = (357.52911 + t * (35_999.05029 - 0.0001537 * t)) * radians
        val e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
        val centre = sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            sin(2 * m) * (0.019993 - 0.000101 * t) + sin(3 * m) * 0.000289
        val omega = (125.04 - 1934.136 * t) * radians
        val apparent = (mean + centre - 0.00569 - 0.00478 * sin(omega)) * radians
        val obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
            0.00256 * cos(omega)) * radians
        val declination = asin(sin(obliquity) * sin(apparent))
        val y = tan(obliquity / 2).pow(2)
        val l = mean * radians
        val equation = 4 / radians * (y * sin(2 * l) - 2 * e * sin(m) + 4 * e * y * sin(m) * cos(2 * l) -
            0.5 * y * y * sin(4 * l) - 1.25 * e * e * sin(2 * m))
        val minutes = turn(date, 86_400_000.0) / 60_000
        val h = (turn(minutes + equation + 4 * longitude, 1440.0) / 4 - 180) * radians
        val phi = latitude * radians
        val zenith = (sin(phi) * sin(declination) + cos(phi) * cos(declination) * cos(h)).coerceIn(-1.0, 1.0)
        val elevation = 90 - acos(zenith) / radians
        val tangent = tan(elevation * radians)
        val refracted = when {
            elevation > 85 -> 0.0
            elevation > 5 -> 58.1 / tangent - 0.07 / tangent.pow(3) + 0.000086 / tangent.pow(5)
            elevation > -0.575 -> 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
            else -> -20.772 / tangent
        }
        return Direction(turn(atan2(sin(h), cos(h) * sin(phi) - tan(declination) * cos(phi)) / radians + 180, 360.0),
            min(90.0, elevation + refracted / 3600))
    }

    fun resolvedSun(preset: JSONObject, direction: Direction, source: String): JSONObject {
        val azimuth = turn(direction.azimuth, 360.0)
        val altitude = direction.altitude.coerceIn(-90.0, 90.0)
        val h = altitude * radians
        val a = azimuth * radians
        val horizon = smooth(((altitude + 0.5) / 3.5).coerceIn(0.0, 1.0))
        val intensity = preset.getDouble("intensity").coerceIn(0.0, 1.0) * horizon
        val ambient = JSONObject(preset.getJSONObject("ambient").toString())
        fun rgb(color: String): List<Double> =
            NativeEvaluators.parseColour(color)?.take(3)?.map { it / 255 } ?: listOf(1.0,1.0,1.0)
        fun luminance(channels: List<Double>): Double {
            val linear = channels.map { if (it <= 0.04045) it / 12.92 else ((it + 0.055) / 1.055).pow(2.4) }
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
        }
        val direct = rgb(preset.getString("color"))
        val fill = rgb(ambient.getString("color"))
        val ambientIntensity = ambient.getDouble("intensity").coerceIn(0.0, 1.0)
        val brightness = (luminance(fill) * ambientIntensity + luminance(direct) * intensity * max(0.0, sin(h))) / 2
        return JSONObject().put("azimuth", azimuth).put("altitude", altitude).put("source", source)
            .put("direction", JSONArray(listOf(sin(a)*cos(h), cos(a)*cos(h), sin(h))))
            .put("color", preset.get("color")).put("rgb", JSONArray(direct)).put("intensity", intensity)
            .put("shadowIntensity", preset.getDouble("shadowIntensity").coerceIn(0.0,1.0))
            .put("ambient", ambient.put("rgb", JSONArray(fill)).put("intensity", ambientIntensity))
            .put("brightness", round(brightness.coerceIn(0.0,1.0) * 1e6) / 1e6)
    }

    data class ShotFrame(val at: Long, val camera: TileflowCamera, val blend: Double?)
    fun shot(frames: List<ShotFrame>, elapsed: Long, linear: Boolean): ShotFrame {
        val at = elapsed.coerceIn(frames.first().at, frames.last().at)
        val index = frames.indexOfFirst { it.at >= at }.coerceAtLeast(1)
        val from = frames[index-1]
        val to = frames[index]
        val t0 = (at - from.at).toDouble() / (to.at - from.at)
        val t = if (linear) t0 else smooth(t0)
        val a = from.camera
        val b = to.camera
        val ac = TileflowCoordinate(a.longitude, a.latitude)
        val bc = TileflowCoordinate(b.longitude, b.latitude)
        val coordinate = when {
            t <= 0 || ac == bc -> ac
            t >= 1 -> bc
            else -> {
                val (x,y) = NativeCameraMath.project(ac)
                val (u,v) = NativeCameraMath.project(bc)
                val dx = u - x
                NativeCameraMath.unproject(x + (if (dx > 0.5) dx - 1 else if (dx < -0.5) dx + 1 else dx) * t, mix(y,v,t))
            }
        }
        val bearing = when {
            t <= 0 -> a.bearing
            t >= 1 -> b.bearing
            else -> turn(a.bearing + (turn(b.bearing - a.bearing + 180,360.0) - 180) * t + 180,360.0) - 180
        }
        return ShotFrame(at, TileflowCamera(coordinate.longitude, coordinate.latitude, mix(a.zoom,b.zoom,t), bearing, mix(a.pitch,b.pitch,t)),
            from.blend?.let { mix(it, to.blend ?: it, t) })
    }

    fun gradient(progress: JSONObject, color: String, highlight: String?): JSONArray {
        val start = progress.optDouble("start", 0.0)
        val end = max(start, progress.optDouble("end", 1.0))
        val hot = highlight ?: color
        val clear = "rgba(0, 0, 0, 0)"
        val stops = mutableListOf<Pair<Double,String>>()
        if (end - start < 0.0005) {
            stops += 0.0 to clear
            stops += 1.0 to clear
        } else {
            if (start > 0) stops += start - 0.0005 to clear
            stops += start to color
            (progress.opt("light") as? Number)?.toDouble()?.let { light ->
                if (light > start && light <= end) {
                    stops += max(start,light - 0.04) to color
                    stops += light to hot
                    if (light < end) stops += min(end,light + 0.014) to color
                }
            }
            if (end < 1) stops += max(start,end - 0.04) to color
            stops += end to hot
            if (end < 1) stops += end + 0.0005 to clear
        }
        val gradient = JSONArray().put("interpolate").put(JSONArray().put("linear")).put(JSONArray().put("line-progress"))
        var last = -1.0
        for ((at, ink) in stops) if (at in 0.0..1.0 && at > last) {
            gradient.put(at).put(ink)
            last = at
        }
        // The web gradient ends with the line ink when there is no head.
        if (end == 1.0 && end-start >= 0.0005 && last == 1.0) gradient.put(gradient.length()-1, color)
        return gradient
    }
}
