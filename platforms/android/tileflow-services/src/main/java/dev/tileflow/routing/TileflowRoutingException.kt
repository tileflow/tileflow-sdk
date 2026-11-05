package dev.tileflow.routing

import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.configuration.internal.TileflowServiceErrors

/** The codes of Routing error answers, with the HTTP status the API gives each one. */
public enum class TileflowRoutingErrorCode(public val wireName: String, public val status: Int) {
    INVALID_REQUEST("ROUTING_INVALID_REQUEST", 400),
    REQUEST_TOO_LARGE("ROUTING_REQUEST_TOO_LARGE", 413),
    /** Also answered with 401 when the credential is missing or invalid. */
    ACCESS_DENIED("ROUTING_ACCESS_DENIED", 403),
    ORIGIN_NOT_ALLOWED("ROUTING_ORIGIN_NOT_ALLOWED", 403),
    NO_ROUTE("ROUTING_NO_ROUTE", 422),
    RATE_LIMITED("ROUTING_RATE_LIMITED", 429),
    QUOTA_EXCEEDED("ROUTING_QUOTA_EXCEEDED", 429),
    CANCELLED("ROUTING_CANCELLED", 499),
    INVALID_RESPONSE("ROUTING_INVALID_RESPONSE", 502),
    UNAVAILABLE("ROUTING_UNAVAILABLE", 503),
    TIMEOUT("ROUTING_TIMEOUT", 504),
}

/** A failed Routing operation. */
public class TileflowRoutingException(
    kind: TileflowServiceErrorKind,
    public val code: TileflowRoutingErrorCode?,
    status: Int?,
    requestId: String?,
    retryAfterSeconds: Long?,
    message: String,
    cause: Throwable? = null,
) : TileflowServiceException(kind, status, requestId, retryAfterSeconds, message, cause)

internal val routingErrors: TileflowServiceErrors<TileflowRoutingErrorCode> =
    TileflowServiceErrors(
        service = TileflowService.ROUTING,
        name = "Routing",
        codes = TileflowRoutingErrorCode.entries,
        wireName = { it.wireName },
        statusOf = { it.status },
        exception = {
            TileflowRoutingException(
                it.kind,
                it.code,
                it.status,
                it.requestId,
                it.retryAfterSeconds,
                it.message,
                it.cause,
            )
        },
        unauthorizedCode = TileflowRoutingErrorCode.ACCESS_DENIED,
    )
