package dev.tileflow.configuration

/** Why a Tileflow service operation failed. Cancellation is not a failure: it rethrows. */
public enum class TileflowServiceErrorKind {
    /** Missing or invalid configuration, credential or app identity. Nothing was sent. */
    CONFIGURATION,

    /** The client rejected the request before sending it. */
    INVALID_REQUEST,

    /** No HTTP answer arrived: a connection, TLS or timeout failure, or a redirect. */
    NETWORK,

    /** The API answered with an HTTP error status. */
    REJECTED,

    /** The API answered successfully, but outside its contract, too large or not UTF-8 JSON. */
    INVALID_RESPONSE,
}

/**
 * A failed Tileflow service operation. Each service throws its own subclass with a typed code.
 *
 * @property status The HTTP status of a [TileflowServiceErrorKind.REJECTED] or
 *   [TileflowServiceErrorKind.INVALID_RESPONSE] failure.
 * @property requestId The API's identifier of the request, when the answer named it.
 * @property retryAfterSeconds The delay the API asked for before a new attempt.
 */
public open class TileflowServiceException(
    public val kind: TileflowServiceErrorKind,
    public val status: Int?,
    public val requestId: String?,
    public val retryAfterSeconds: Long?,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)
