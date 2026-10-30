package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowCredential
import okhttp3.Request

/**
 * Sends [credential] as the value of header [name]. Tileflow modules authorize their own requests
 * with it, so no supported API returns a credential's value.
 */
@TileflowInternalApi
public fun Request.Builder.credentialHeader(
    name: String,
    credential: TileflowCredential,
): Request.Builder = header(name, credential.value)
