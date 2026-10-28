package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.ProtocolContract
import org.json.JSONObject

/**
 * Diagnostic detail for a failure, warning or rejected call. It never holds a URL path, query or
 * credential; a resource is identified by its kind and origin only.
 *
 * @property reason A stable identifier for the cause within the code, for example
 *   `protocolVersion`, `dataTooLarge`, `dataIntegrity`, `invalidGeoJSON` or
 *   `graphicsContextLost`.
 * @property origin The scheme, host and port of the resource, for example
 *   `https://tiles.example.com`.
 * @property status The HTTP status of the resource's answer.
 * @property limit The limit that was exceeded, in bytes or items.
 * @property message A developer-facing explanation in English. Not for display to people using
 *   the app.
 */
public data class TileflowErrorContext(
    val reason: String? = null,
    val resource: TileflowResourceKind? = null,
    val origin: String? = null,
    val status: Int? = null,
    val limit: Int? = null,
    val message: String? = null,
) {
    override fun toString(): String =
        listOfNotNull(
                reason?.let { "reason: $it" },
                resource?.let { "resource: ${it.wireName}" },
                origin?.let { "origin: $it" },
                status?.let { "status: $it" },
                limit?.let { "limit: $it" },
                message,
            )
            .joinToString(", ")

    internal companion object {
        val NONE: TileflowErrorContext = TileflowErrorContext()

        fun of(reason: ProtocolContract.ErrorReason, limit: Int? = null): TileflowErrorContext =
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
                raw?.takeIf { it in ProtocolContract.RUNTIME_ERRORS }
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
                ),
            )
        }
    }
}
