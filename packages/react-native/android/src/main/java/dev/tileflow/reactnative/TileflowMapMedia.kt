package dev.tileflow.reactnative

import android.content.Context
import android.util.Base64
import com.facebook.react.views.imagehelper.ImageSource
import dev.tileflow.configuration.internal.TileflowInternalApi
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.transport.TileflowApplicationImageTransport
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Application images use the host's URIs, without the map's credential or resource grants. */
@OptIn(TileflowInternalApi::class)
internal object TileflowMapMedia {
    internal const val MAXIMUM_BYTES = TileflowApplicationImageTransport.MAXIMUM_BYTES

    suspend fun load(context: Context, value: String): ByteArray =
        withContext(Dispatchers.IO) {
            val coroutine = currentCoroutineContext()
            coroutine.ensureActive()
            val uri = ImageSource(context, value).uri
            val bytes =
                when (uri.scheme?.lowercase()) {
                    "http",
                    "https" -> TileflowApplicationImageTransport.load(uri.toString())
                    "data" -> data(value) { coroutine.ensureActive() }
                    "asset",
                    "assets" ->
                        context.assets.open(uri.path.orEmpty().removePrefix("/")).use {
                            bounded(it) { coroutine.ensureActive() }
                        }
                    "res" ->
                        context.resources
                            .openRawResource(
                                uri.lastPathSegment?.toIntOrNull()
                                    ?: throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                            )
                            .use { bounded(it) { coroutine.ensureActive() } }
                    "file",
                    "content",
                    "android.resource" ->
                        (context.contentResolver.openInputStream(uri)
                                ?: throw TileflowMapException(TileflowErrorCode.RESOURCE_FAILED))
                            .use { bounded(it) { coroutine.ensureActive() } }
                    else -> throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                }
            coroutine.ensureActive()
            if (bytes.isEmpty()) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            bytes
        }

    internal fun bounded(stream: InputStream, check: () -> Unit = {}): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            check()
            val count = stream.read(buffer)
            if (count < 0) return output.toByteArray()
            if (output.size() > MAXIMUM_BYTES - count)
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            output.write(buffer, 0, count)
        }
    }

    private fun data(value: String, check: () -> Unit): ByteArray {
        val comma = value.indexOf(',')
        if (comma < 0) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val payload = value.substring(comma + 1)
        if (value.substring(0, comma).endsWith(";base64", ignoreCase = true)) {
            if (payload.length > ((MAXIMUM_BYTES + 2) / 3) * 4)
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            return Base64.decode(payload, Base64.DEFAULT).also {
                if (it.size > MAXIMUM_BYTES)
                    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            }
        }
        if (payload.length > MAXIMUM_BYTES * 3)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val input = payload.toByteArray(Charsets.UTF_8)
        val output = ByteArrayOutputStream()
        var index = 0
        while (index < input.size) {
            if (index % 16_384 == 0) check()
            if (output.size() >= MAXIMUM_BYTES)
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            if (input[index] == '%'.code.toByte()) {
                if (index + 2 >= input.size)
                    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                val byte =
                    String(input, index + 1, 2, Charsets.US_ASCII).toIntOrNull(16)
                        ?: throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                output.write(byte)
                index += 3
            } else output.write(input[index++].toInt())
        }
        return output.toByteArray()
    }
}
