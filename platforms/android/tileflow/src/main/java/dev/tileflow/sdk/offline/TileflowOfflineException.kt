package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext

/** Why an offline region could not be planned, created or checked. */
public enum class TileflowOfflineErrorCode {
    /**
     * The region cannot be downloaded as given; the context's reason says why. Nothing was sent.
     */
    INVALID_REGION,
    /** A zoom, theme or Map ID is outside its documented range. Nothing was sent. */
    INVALID_OPTIONS,
    /** The configuration has no map credential. Nothing was sent. */
    MISSING_CREDENTIAL,
    /** The configured API origin cannot serve Hosted maps. Nothing was sent. */
    INVALID_CONFIGURATION,
    /** The map credential is invalid, revoked or expired. */
    CREDENTIAL_REJECTED,
    /**
     * The pack's grant is forged, expired or out of date. Create the pack again; creation decides
     * whether access continues.
     */
    GRANT_REJECTED,
    /** The credential does not authorize this Map, or a resource is not part of the pack. */
    ACCESS_DENIED,
    /** The Map has no current mobile delivery, or a theme does not exist. */
    NOT_FOUND,
    /** The Team's plan does not include offline packs. */
    NOT_INCLUDED,
    /** Offline downloads are turned off for this credential. */
    DOWNLOADS_DISABLED,
    /**
     * The pack has more billable resources than the plan allows, given as the `limit`. Choose a
     * smaller region or fewer zooms.
     */
    PACK_TOO_LARGE,
    /** Nothing in the region can be downloaded. */
    NOT_DOWNLOADABLE,
    /** The device would hold more billable resources than the plan allows, given as the `limit`. */
    DEVICE_LIMIT_EXCEEDED,
    /** The credential's daily download limit is reached until the retry delay. */
    DAILY_LIMIT_REACHED,
    /** The Team's map view or spending limit is reached. */
    QUOTA_EXCEEDED,
    /** Too many requests from this network. Retry after the retry delay. */
    RATE_LIMITED,
    /** The Map changed since the pack was created. Revalidate, then create the pack again. */
    SUPERSEDED,
    /** The service refused the request as malformed. */
    REJECTED,
    /** Offline packs are disabled or temporarily unavailable. Retry later. */
    UNAVAILABLE,
    /** No HTTP answer arrived. */
    NETWORK,
    /** The service answered outside its contract, or a body did not match its manifest. */
    INVALID_RESPONSE,
    /** The device does not have room for the region. Free space, then resume it. */
    INSUFFICIENT_STORAGE,
    /** No region has this identifier. */
    REGION_NOT_FOUND;

    /** Whether the same request can succeed later without the application changing anything. */
    public val isRecoverable: Boolean
        get() = this in setOf(DAILY_LIMIT_REACHED, RATE_LIMITED, UNAVAILABLE, NETWORK)
}

/**
 * A failed offline call. A Hosted refusal carries the service's code as the context's `reason`
 * and its HTTP status; size limits carry the `limit`.
 *
 * @property retryAfterMillis The wait the service asked for, when it sent one.
 */
public class TileflowOfflineException
@JvmOverloads
public constructor(
    public val code: TileflowOfflineErrorCode,
    public val context: TileflowErrorContext = TileflowErrorContext.NONE,
    public val retryAfterMillis: Long? = null,
) :
    Exception(
        "Tileflow offline operation failed: ${code.name}" +
            listOfNotNull(
                    context.toString().takeIf { it.isNotEmpty() },
                    retryAfterMillis?.let { "retry after: $it ms" },
                )
                .joinToString(", ")
                .let { if (it.isEmpty()) "" else " ($it)" }
    ) {
    /** Whether the same request can succeed later without the application changing anything. */
    public val isRecoverable: Boolean
        get() = code.isRecoverable

    internal companion object {
        fun region(reason: String): TileflowOfflineException =
            TileflowOfflineException(
                TileflowOfflineErrorCode.INVALID_REGION,
                TileflowErrorContext(reason = reason),
            )

        fun options(reason: String): TileflowOfflineException =
            TileflowOfflineException(
                TileflowOfflineErrorCode.INVALID_OPTIONS,
                TileflowErrorContext(reason = reason),
            )

        fun invalidResponse(): TileflowOfflineException =
            TileflowOfflineException(TileflowOfflineErrorCode.INVALID_RESPONSE)
    }
}
