package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowConfiguration
import java.net.URI

/**
 * [origin] normalized by the rule [TileflowConfiguration] applies to its API origin, or null when
 * the rule rejects it: an `https` origin, or an `http` one on `localhost`, `127.0.0.1` or `[::1]`.
 * Hosted maps apply the same rule as the service clients.
 */
@TileflowInternalApi
public fun tileflowApiOrigin(origin: URI): URI? =
    runCatching { TileflowConfiguration.normalizeOrigin(origin) }.getOrNull()
