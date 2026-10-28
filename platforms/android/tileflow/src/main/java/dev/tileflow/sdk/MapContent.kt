package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract
import org.json.JSONArray
import org.json.JSONObject

public data class TileflowAnnotation(
    val id: String,
    val coordinate: TileflowCoordinate,
    val title: String,
    val color: String = "#e9573f",
) {
    internal fun json(): JSONObject {
        if (
            !Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$").matches(id) ||
                title.isBlank() ||
                title.length > 256 ||
                coordinate.longitude !in -180.0..180.0 ||
                coordinate.latitude !in -90.0..90.0 ||
                !Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(color)
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        return JSONObject()
            .put("id", id)
            .put("kind", "marker")
            .put("ariaLabel", title)
            .put("coordinate", JSONArray(listOf(coordinate.longitude, coordinate.latitude)))
            .put("marker", JSONObject().put("color", color))
    }
}

public enum class TileflowGeoJSONLayerKind(internal val wireName: String) {
    CIRCLE("circle"),
    LINE("line"),
    FILL("fill"),
}

/**
 * An application-owned GeoJSON FeatureCollection drawn as one layer.
 *
 * The GeoJSON travels to the renderer over the SDK's data channel rather than in a message, up to
 * 32 MiB per layer and 64 MiB per update. The renderer validates it against RFC 7946 (without
 * GeometryCollection or foreign members, with closed rings and positions within range); invalid
 * GeoJSON makes [TileflowMapView.setContent] fail with [TileflowErrorCode.INVALID_REQUEST] and the
 * reason `invalidGeoJSON`, leaving the content as it was.
 */
public class TileflowGeoJSONLayer(
    public val id: String,
    geoJSON: String,
    public val kind: TileflowGeoJSONLayerKind,
    public val color: String = "#e9573f",
    public val size: Double = 6.0,
    public val opacity: Double = 1.0,
) {
    internal val bytes: ByteArray = geoJSON.toByteArray(Charsets.UTF_8)

    /** Identifies the data, so layers that share it, or keep it across updates, send it once. */
    internal val digest: String

    init {
        if (
            !Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$").matches(id) ||
                !Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(color) ||
                size !in 0.0..64.0 ||
                opacity !in 0.0..1.0
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        if (bytes.isEmpty() || bytes.size > ProtocolContract.MAXIMUM_DATA_BYTES)
            throw TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext.of(
                    ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                    ProtocolContract.MAXIMUM_DATA_BYTES,
                ),
            )
        digest = DataChannel.digest(bytes)
    }

    internal fun json(data: DataChannel.Reference): JSONObject =
        JSONObject()
            .put("id", id)
            .put("data", data.json())
            .put("kind", kind.wireName)
            .put("color", color)
            .put("size", size)
            .put("opacity", opacity)
}

public data class TileflowPoiSelection(
    val id: String?,
    val coordinate: TileflowCoordinate,
    val name: String?,
    val category: String,
)

internal data class MapContent(
    val annotations: List<TileflowAnnotation> = emptyList(),
    val overlays: List<TileflowGeoJSONLayer> = emptyList(),
) {
    fun validate() {
        if (
            annotations.size > 128 ||
                overlays.size > 16 ||
                annotations.map { it.id }.toSet().size != annotations.size ||
                overlays.map { it.id }.toSet().size != overlays.size
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        annotations.forEach { it.json() }
        val total = overlays.distinctBy { it.digest }.sumOf { it.bytes.size.toLong() }
        if (total > ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES)
            throw TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext.of(
                    ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                    ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES,
                ),
            )
    }

    /**
     * The command payload, with each distinct layer's GeoJSON registered on the data channel. The
     * caller releases the references when the request settles.
     */
    fun json(channel: DataChannel): Pair<JSONObject, List<DataChannel.Reference>> {
        validate()
        val annotations = JSONArray(annotations.map { it.json() })
        val references = mutableListOf<DataChannel.Reference>()
        try {
            val overlays =
                JSONArray(
                    overlays.map { layer ->
                        val reference =
                            channel.register(layer.bytes, layer.digest, "application/geo+json")
                        references += reference
                        layer.json(reference)
                    }
                )
            return JSONObject().put("annotations", annotations).put("overlays", overlays) to
                references
        } catch (error: Exception) {
            channel.release(references)
            throw error
        }
    }
}
