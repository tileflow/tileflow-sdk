package dev.tileflow.sdk

import dev.tileflow.sdk.model.MapContract
import org.json.JSONObject

public data class TileflowErrorCorrection(val code: String, val message: String)

/**
 * Diagnostic detail for a failure, warning or rejected call. It never holds a URL path, query or
 * credential; a resource is identified by its kind and origin only.
 *
 * @property reason A stable identifier for the cause within the code, for example
 *   `protocolVersion`, `dataTooLarge`, `dataIntegrity`, `invalidGeoJSON`, `graphicsContextLost`
 *   or `featureUnavailable`.
 * @property origin The scheme, host and port of the resource, for example
 *   `https://tiles.example.com`.
 * @property status The HTTP status of the resource's answer.
 * @property limit The limit that was exceeded, in bytes or items.
 * @property message A developer-facing explanation in English. Not for display to people using
 *   the app.
 * @property count How many bytes or items there were when [limit] was exceeded, when known.
 * @property feature The capability the map holds and this renderer does not draw, with the reason
 *   `featureUnavailable`: for example `scene3d`, `terrain3d` or `pitchAbove60`.
 */
public data class TileflowErrorContext(
    val reason: String? = null,
    val resource: TileflowResourceKind? = null,
    val origin: String? = null,
    val status: Int? = null,
    val limit: Int? = null,
    val message: String? = null,
    val count: Int? = null,
    val feature: String? = null,
    val rule: String? = null,
    val operation: String? = null,
    val path: String? = null,
    val layerId: String? = null,
    val referenceLayerId: String? = null,
    val slot: String? = null,
    val referenceSlot: String? = null,
    val corrections: List<TileflowErrorCorrection> = emptyList(),
) {
    override fun toString(): String =
        listOfNotNull(
                reason?.let { "reason: $it" },
                feature?.let { "feature: $it" },
                rule?.let { "rule: $it" },
                resource?.let { "resource: ${it.wireName}" },
                origin?.let { "origin: $it" },
                status?.let { "status: $it" },
                limit?.let { "limit: $it" },
                count?.let { "count: $it" },
                message,
            )
            .joinToString(", ")

    internal companion object {
        val NONE: TileflowErrorContext = TileflowErrorContext()

        fun of(reason: MapContract.ErrorReason, limit: Int? = null): TileflowErrorContext =
            TileflowErrorContext(reason = reason.wireName, limit = limit)
    }
}

/** A failed call or load, with a code from the taxonomy the SDK shares with its renderer. */
public class TileflowMapException
@JvmOverloads
public constructor(
    public val code: TileflowErrorCode,
    public val context: TileflowErrorContext = TileflowErrorContext.NONE,
) :
    Exception(
        "Tileflow map operation failed: ${code.name}" +
            context.toString().let { if (it.isEmpty()) "" else " ($it)" }
    ) {
    /** Whether the same work can succeed later without the application changing anything. */
    public val isRecoverable: Boolean
        get() = code.isRecoverable

    internal companion object {
        /** An error the renderer sent. A code the renderer may not send is a renderer fault. */
        fun fromWire(value: JSONObject?): TileflowMapException {
            val raw = value?.optString("code")
            val code =
                raw?.takeIf { it in MapContract.RENDERER_ERRORS }
                    ?.let(TileflowErrorCode::fromWire)
                    ?: return TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
            val context = value.optJSONObject("context")
            fun integer(key: String): Int? =
                context?.opt(key)?.let { it as? Number }?.toDouble()?.takeIf {
                    it == Math.floor(it) && it in 0.0..Int.MAX_VALUE.toDouble()
                }?.toInt()
            fun text(source: JSONObject?, key: String): String? =
                source?.opt(key)?.let { it as? String }
            return TileflowMapException(
                code,
                TileflowErrorContext(
                    reason = text(context, "reason"),
                    resource = TileflowResourceKind.fromWire(text(context, "resource")),
                    origin = text(context, "origin"),
                    status = integer("status"),
                    limit = integer("limit"),
                    message = text(value, "message")?.take(512),
                    feature = text(context, "feature")?.take(64),
                    rule = text(context, "rule")?.take(64),
                    operation = text(context, "operation"),
                    path = text(context, "path"),
                    layerId = text(context, "layerId"),
                    referenceLayerId = text(context, "referenceLayerId"),
                    slot = text(context, "slot"),
                    referenceSlot = text(context, "referenceSlot"),
                    corrections = context?.optJSONArray("corrections")?.let { values ->
                        (0 until values.length()).mapNotNull { index ->
                            val value = values.optJSONObject(index)
                            val code = text(value, "code") ?: return@mapNotNull null
                            val message = text(value, "message") ?: return@mapNotNull null
                            TileflowErrorCorrection(code, message)
                        }
                    } ?: emptyList(),
                ),
            )
        }
    }
}
