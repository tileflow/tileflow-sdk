package dev.tileflow.sdk.transport

import java.net.URI
import java.util.Base64

internal object ResourceAddress {
    const val ORIGIN = "https://tileflow.invalid"
    const val RUNTIME_URL = "$ORIGIN/runtime/index.html"

    fun encode(url: URI): URI {
        val token =
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(url.toASCIIString().toByteArray(Charsets.UTF_8))
        return URI("$ORIGIN/resource/$token")
    }

    fun decode(url: URI): URI {
        require(url.scheme == "https" && url.host == "tileflow.invalid" && url.port == -1)
        require(url.userInfo == null && url.rawQuery == null && url.rawFragment == null)
        require(url.rawPath.startsWith("/resource/"))
        val parts = url.rawPath.removePrefix("/resource/").split('/')
        require(parts.size == 1 || parts.size == 4)
        val token = parts[0]
        require(
            token.length in 1..8192 &&
                token.all {
                    it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' || it == '_'
                }
        )
        var text =
            Charsets.UTF_8.newDecoder()
                .decode(java.nio.ByteBuffer.wrap(Base64.getUrlDecoder().decode(token)))
                .toString()
        val remote = URI(text)
        require(encode(remote).toASCIIString() == "$ORIGIN/resource/$token")
        if (parts.size == 1) return remote
        val coordinates = parts.drop(1)
        require(coordinates.all { Regex("^(0|[1-9][0-9]{0,7})$").matches(it) })
        val (z, x, y) = coordinates.map(String::toInt)
        require(z <= 24 && x < (1 shl z) && y < (1 shl z))
        for ((axis, coordinate) in listOf("z", "x", "y").zip(coordinates)) {
            val placeholder = "%7B$axis%7D"
            require(text.contains(placeholder))
            text = text.replace(placeholder, coordinate)
        }
        return URI(text)
    }
}
