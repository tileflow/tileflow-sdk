package dev.tileflow.sdk.transport

import java.net.URI

internal data class ResourcePolicy(
    val origins: Set<String>,
    val allowsLoopbackHttp: Boolean = false,
) {
    fun validate(url: URI) {
        require(
            url.toASCIIString().length <= 6144 && url.userInfo == null && url.rawFragment == null
        )
        require(!url.host.isNullOrEmpty())
        require(
            url.scheme == "https" ||
                (allowsLoopbackHttp &&
                    url.scheme == "http" &&
                    url.host in setOf("localhost", "127.0.0.1", "[::1]"))
        )
        require(origin(url) in origins) { "The resource origin is not configured." }
    }

    companion object {
        fun origin(url: URI): String {
            val defaultPort =
                (url.scheme == "https" && url.port == 443) ||
                    (url.scheme == "http" && url.port == 80)
            val port = if (url.port == -1 || defaultPort) "" else ":${url.port}"
            return "${url.scheme.lowercase()}://${url.host.lowercase()}$port"
        }
    }
}
