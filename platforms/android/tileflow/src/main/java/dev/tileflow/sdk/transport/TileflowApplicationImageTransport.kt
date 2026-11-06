package dev.tileflow.sdk.transport

import dev.tileflow.configuration.internal.TileflowInternalApi
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import java.util.concurrent.FutureTask
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

/** Reads remote application images without the map's credentials or resource grants. */
@TileflowInternalApi
public object TileflowApplicationImageTransport {
    public const val MAXIMUM_BYTES: Int = 32 * 1024 * 1024

    public suspend fun load(uri: String): ByteArray {
        val url = uri.toHttpUrlOrNull()
        if (url == null || url.username.isNotEmpty() || url.password.isNotEmpty())
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

        return suspendCancellableCoroutine { continuation ->
            val transport = NativeHTTPTransport(MAXIMUM_BYTES, TileflowHttpClient.Lane.RESOURCES)
            val work = FutureTask {
                val result = runCatching {
                    transport.use { owner ->
                        owner.open(Request.Builder().url(url).build()).use { response ->
                            if (response.status !in 200..299)
                                throw TileflowMapException(TileflowErrorCode.RESOURCE_FAILED)

                            response.body.readBytes().also {
                                if (it.isEmpty())
                                    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                            }
                        }
                    }
                }.recoverCatching { error ->
                    throw when (error) {
                        is TileflowMapException -> error
                        is ResourceTooLargeException -> TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                        else -> TileflowMapException(TileflowErrorCode.RESOURCE_FAILED)
                    }
                }
                continuation.resumeWith(result)
            }

            continuation.invokeOnCancellation {
                transport.close()
                work.cancel(true)
            }
            Dispatchers.IO.dispatch(continuation.context, work)
        }
    }
}
