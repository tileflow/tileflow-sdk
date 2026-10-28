package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.configuration.internal.TileflowServiceErrors

/** The codes of Elevation error answers, with the HTTP status the API gives each one. */
public enum class TileflowElevationErrorCode(public val wireName: String, public val status: Int) {
    INVALID_REQUEST("ELEVATION_INVALID_REQUEST", 400),
    REQUEST_TOO_LARGE("ELEVATION_REQUEST_TOO_LARGE", 413),
    /** Also answered with 401 when the credential is missing or invalid. */
    ACCESS_DENIED("ELEVATION_ACCESS_DENIED", 403),
    ORIGIN_NOT_ALLOWED("ELEVATION_ORIGIN_NOT_ALLOWED", 403),
    RATE_LIMITED("ELEVATION_RATE_LIMITED", 429),
    QUOTA_EXCEEDED("ELEVATION_QUOTA_EXCEEDED", 429),
    CANCELLED("ELEVATION_CANCELLED", 499),
    UNAVAILABLE("ELEVATION_UNAVAILABLE", 503),
    TIMEOUT("ELEVATION_TIMEOUT", 504),
}

/** A failed Elevation operation. */
public class TileflowElevationException(
    kind: TileflowServiceErrorKind,
    public val code: TileflowElevationErrorCode?,
    status: Int?,
    requestId: String?,
    retryAfterSeconds: Long?,
    message: String,
    cause: Throwable? = null,
) : TileflowServiceException(kind, status, requestId, retryAfterSeconds, message, cause)

internal val elevationErrors: TileflowServiceErrors<TileflowElevationErrorCode> =
    TileflowServiceErrors(
        service = TileflowService.ELEVATION,
        name = "Elevation",
        codes = TileflowElevationErrorCode.entries,
        wireName = { it.wireName },
        statusOf = { it.status },
        exception = {
            TileflowElevationException(
                it.kind,
                it.code,
                it.status,
                it.requestId,
                it.retryAfterSeconds,
                it.message,
                it.cause,
            )
        },
        unauthorizedCode = TileflowElevationErrorCode.ACCESS_DENIED,
    )
