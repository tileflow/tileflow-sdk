package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.internal.TileflowGeo
import dev.tileflow.configuration.internal.TileflowJson
import dev.tileflow.configuration.internal.TileflowJsonObject
import dev.tileflow.configuration.internal.invalidResponse
import dev.tileflow.configuration.internal.requireRequest
import dev.tileflow.configuration.internal.requireResponse
import org.json.JSONArray
import org.json.JSONObject

/** Validates Elevation requests and encodes them as the API expects. */
internal object ElevationWire {
    fun points(positions: List<TileflowPosition>, unit: TileflowElevationUnit): JSONObject {
        requireRequest(positions.size in 1..100) { "Give 1 to 100 positions." }
        positions.forEach(::position)
        return JSONObject()
            .put("positions", TileflowJson.positions(positions))
            .put("unit", unit.wireName)
    }

    fun profile(request: TileflowElevationProfileRequest): JSONObject {
        val body = JSONObject()
        when (val line = request.line) {
            is TileflowElevationLine.LineString -> {
                line(line.positions)
                body.put(
                    "line",
                    JSONObject()
                        .put("type", "LineString")
                        .put("coordinates", TileflowJson.positions(line.positions)),
                )
            }
            is TileflowElevationLine.MultiLineString -> {
                requireRequest(line.lines.size in 1..100) { "Give 1 to 100 lines." }
                line.lines.forEach(::line)
                body.put(
                    "line",
                    JSONObject()
                        .put("type", "MultiLineString")
                        .put(
                            "coordinates",
                            JSONArray().also { array ->
                                line.lines.forEach { array.put(TileflowJson.positions(it)) }
                            },
                        ),
                )
            }
            is TileflowElevationLine.Polyline -> {
                requireRequest(line.encoded.length in 2..400_000) {
                    "An encoded polyline has 2 to 400,000 characters."
                }
                requireRequest(line.precision == 5 || line.precision == 6) {
                    "The polyline precision must be 5 or 6."
                }
                body.put(
                    "polyline",
                    JSONObject().put("encoded", line.encoded).put("precision", line.precision),
                )
            }
        }
        request.interval?.let {
            requireRequest(it.isFinite() && it > 0) { "The interval must be greater than 0." }
        }
        request.maxSamples?.let {
            requireRequest(it in 2..1_000) { "Ask for 2 to 1,000 samples." }
        }
        request.climbThreshold?.let {
            requireRequest(it.isFinite() && it >= 0) {
                "The climb threshold must be at least 0."
            }
        }
        return body
            .putOpt("interval", request.interval)
            .putOpt("maxSamples", request.maxSamples)
            .putOpt("climbThreshold", request.climbThreshold)
            .put("unit", request.unit.wireName)
    }

    private fun line(positions: List<TileflowPosition>) {
        requireRequest(positions.size in 2..20_000) { "A line has 2 to 20,000 positions." }
        positions.forEach(::position)
    }

    private fun position(position: TileflowPosition) {
        requireRequest(TileflowGeo.isValid(position)) {
            "Positions need a longitude within ±180 and a latitude within ±90."
        }
    }
}

/** Reads Elevation answers and checks them against the request. */
internal object ElevationDecoding {
    private class Common(
        val unit: TileflowElevationUnit,
        val dataset: TileflowElevationDataset,
        val attribution: String,
        val units: Int,
    )

    private fun common(root: TileflowJsonObject): Common {
        root.requireSchemaVersion()
        val unit = root.string("unit")
        val dataset = root.obj("dataset")
        val releaseId = dataset.string("releaseId")
        requireResponse(releaseId.length in 1..128)
        val attribution = root.string("attribution")
        requireResponse(attribution.length in 1..16_384)
        val units = root.obj("usage").long("units")
        requireResponse(units in 1..Int.MAX_VALUE)
        return Common(
            TileflowElevationUnit.entries.firstOrNull { it.wireName == unit }
                ?: invalidResponse(),
            TileflowElevationDataset(releaseId, dataset.int("zoom", 0..24)),
            attribution,
            units.toInt(),
        )
    }

    fun points(
        root: TileflowJsonObject,
        count: Int,
        unit: TileflowElevationUnit,
    ): TileflowElevationPointsResponse {
        val common = common(root)
        val array = root.array("positions")
        val positions =
            array.map { index ->
                val tuple = array.array(index)
                requireResponse(tuple.size == 3)
                val position = TileflowPosition(tuple.double(0), tuple.double(1))
                requireResponse(TileflowGeo.isValid(position))
                TileflowElevatedPosition(position, tuple.nullableDouble(2))
            }
        requireResponse(positions.size == count && common.unit == unit)
        return TileflowElevationPointsResponse(
            positions,
            common.unit,
            common.dataset,
            common.attribution,
            common.units,
        )
    }

    fun profile(
        root: TileflowJsonObject,
        request: TileflowElevationProfileRequest,
    ): TileflowElevationProfile {
        val common = common(root)
        val interval = root.double("interval")
        requireResponse(interval > 0)
        val sampleArray = root.array("samples")
        val samples =
            sampleArray.map { index ->
                val tuple = sampleArray.array(index)
                requireResponse(tuple.size == 4)
                val position = TileflowPosition(tuple.double(0), tuple.double(1))
                requireResponse(TileflowGeo.isValid(position))
                val distance = tuple.double(3)
                requireResponse(distance >= 0)
                TileflowElevationSample(position, tuple.nullableDouble(2), distance)
            }
        val lineArray = root.array("lines")
        val lines =
            lineArray.map { index ->
                val pair = lineArray.array(index)
                requireResponse(pair.size == 2)
                val first = pair.long(0)
                val last = pair.long(1)
                requireResponse(first >= 0 && last >= 0 && first <= last && last < samples.size)
                first.toInt()..last.toInt()
            }
        // Lines cover every sample once, in order.
        requireResponse(
            common.unit == request.unit &&
                samples.size <= (request.maxSamples ?: DEFAULT_SAMPLES) &&
                lines.isNotEmpty() &&
                lines.first().first == 0 &&
                lines.zipWithNext().all { (previous, next) -> next.first == previous.last + 1 } &&
                lines.last().last == samples.size - 1
        )
        val summary = root.obj("summary")
        fun length(key: String) = summary.nullableDouble(key)?.also { requireResponse(it >= 0) }
        return TileflowElevationProfile(
            unit = common.unit,
            dataset = common.dataset,
            attribution = common.attribution,
            units = common.units,
            interval = interval,
            samples = samples,
            lines = lines,
            summary =
                TileflowElevationProfileSummary(
                    distance = summary.double("distance").also { requireResponse(it >= 0) },
                    ascent = length("ascent"),
                    descent = length("descent"),
                    minElevation = summary.nullableDouble("minElevation"),
                    maxElevation = summary.nullableDouble("maxElevation"),
                    startElevation = summary.nullableDouble("startElevation"),
                    endElevation = summary.nullableDouble("endElevation"),
                    maxGrade = summary.nullableDouble("maxGrade"),
                    minGrade = summary.nullableDouble("minGrade"),
                ),
        )
    }

    private const val DEFAULT_SAMPLES = 500
}
