package dev.tileflow.search

import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.configuration.internal.TileflowServiceErrors

/** The codes of Search error answers, with the HTTP status the API gives each one. */
public enum class TileflowSearchErrorCode(public val wireName: String, public val status: Int) {
    FILTER_UNSUPPORTED("GEOCODING_FILTER_UNSUPPORTED", 422),
    PLAN_UNAVAILABLE("GEOCODING_PLAN_UNAVAILABLE", 403),
    EVALUATION_REQUIRED("GEOCODING_EVALUATION_REQUIRED", 403),
    EVALUATION_EXPIRED("GEOCODING_EVALUATION_EXPIRED", 403),
    EVALUATION_EXHAUSTED("GEOCODING_EVALUATION_EXHAUSTED", 429),
    INVALID_CURSOR("GEOCODING_INVALID_CURSOR", 400),
    CURSOR_EXPIRED("GEOCODING_CURSOR_EXPIRED", 410),
    ABORTED("GEOCODING_ABORTED", 499),
    DISABLED("GEOCODING_DISABLED", 503),
    INVALID_REQUEST("GEOCODING_INVALID_REQUEST", 400),
    INVALID_SUGGESTION("GEOCODING_INVALID_SUGGESTION", 400),
    ORIGIN_NOT_ALLOWED("GEOCODING_ORIGIN_NOT_ALLOWED", 403),
    PICK_LIMIT_EXCEEDED("GEOCODING_PICK_LIMIT_EXCEEDED", 429),
    QUOTA_EXCEEDED("GEOCODING_QUOTA_EXCEEDED", 429),
    REQUEST_TOO_LARGE("GEOCODING_REQUEST_TOO_LARGE", 413),
    SPENDING_LIMIT_REACHED("GEOCODING_SPENDING_LIMIT_REACHED", 429),
    CREDENTIAL_QUOTA_EXCEEDED("GEOCODING_CREDENTIAL_QUOTA_EXCEEDED", 429),
    SUGGESTION_EXPIRED("GEOCODING_SUGGESTION_EXPIRED", 410),
    SUSPENDED("GEOCODING_SUSPENDED", 403),
    UNAVAILABLE("GEOCODING_UNAVAILABLE", 503),
    UNPAID_BUDGET_EXHAUSTED("GEOCODING_UNPAID_BUDGET_EXHAUSTED", 429),
    UNPAID_LIMIT_REACHED("GEOCODING_UNPAID_LIMIT_REACHED", 429),
    UPSTREAM_INVALID("GEOCODING_UPSTREAM_INVALID", 502),
    UPSTREAM_THROTTLED("GEOCODING_UPSTREAM_THROTTLED", 429),
    UPSTREAM_TIMEOUT("GEOCODING_UPSTREAM_TIMEOUT", 504),
    UPSTREAM_UNAVAILABLE("GEOCODING_UPSTREAM_UNAVAILABLE", 502),
    USAGE_UNCONFIRMED("GEOCODING_USAGE_UNCONFIRMED", 503),
}

/**
 * A failed Search operation. Filters the API cannot combine fail locally with
 * [TileflowServiceErrorKind.INVALID_REQUEST] and [TileflowSearchErrorCode.FILTER_UNSUPPORTED].
 */
public class TileflowSearchException(
    kind: TileflowServiceErrorKind,
    public val code: TileflowSearchErrorCode?,
    status: Int?,
    requestId: String?,
    retryAfterSeconds: Long?,
    message: String,
    cause: Throwable? = null,
) : TileflowServiceException(kind, status, requestId, retryAfterSeconds, message, cause)

internal val searchErrors: TileflowServiceErrors<TileflowSearchErrorCode> =
    TileflowServiceErrors(
        service = TileflowService.SEARCH,
        name = "Search",
        codes = TileflowSearchErrorCode.entries,
        wireName = { it.wireName },
        statusOf = { it.status },
        exception = {
            TileflowSearchException(
                it.kind,
                it.code,
                it.status,
                it.requestId,
                it.retryAfterSeconds,
                it.message,
                it.cause,
            )
        },
        codelessStatuses = setOf(401, 403, 429),
    )
