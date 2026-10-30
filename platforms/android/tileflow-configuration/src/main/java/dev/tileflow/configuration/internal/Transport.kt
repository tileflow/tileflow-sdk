package dev.tileflow.configuration.internal

import android.content.Context
import dev.tileflow.configuration.Tileflow
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer
import org.json.JSONException
import org.json.JSONObject

/** The details of a failed operation, before a service turns them into its exception. */
@TileflowInternalApi
public class TileflowServiceFailure<C : Any>(
    public val kind: TileflowServiceErrorKind,
    public val code: C?,
    public val status: Int?,
    public val requestId: String?,
    public val retryAfterSeconds: Long?,
    public val message: String,
    public val cause: Throwable? = null,
)

/**
 * How a service names its failures and reads its error answers. A code in an error answer is
 * trusted only with the HTTP status the contract gives it, or with 401 for [unauthorizedCode].
 * An answer without a code keeps its message only for [codelessStatuses].
 */
@TileflowInternalApi
public class TileflowServiceErrors<C : Any>(
    public val service: TileflowService,
    public val name: String,
    codes: Iterable<C>,
    wireName: (C) -> String,
    private val statusOf: (C) -> Int,
    private val exception: (TileflowServiceFailure<C>) -> TileflowServiceException,
    private val unauthorizedCode: C? = null,
    private val codelessStatuses: Set<Int> = emptySet(),
    private val requestIdPattern: Regex = REQUEST_ID,
) {
    private val codes: Map<String, C> = codes.associateBy(wireName)

    public val failedMessage: String = "Tileflow $name request failed"

    public val invalidResponseMessage: String = "Tileflow $name returned an invalid response"

    public fun make(failure: TileflowServiceFailure<C>): TileflowServiceException =
        exception(failure)

    public fun configuration(message: String, cause: Throwable? = null): TileflowServiceException =
        make(
            TileflowServiceFailure(
                TileflowServiceErrorKind.CONFIGURATION,
                null,
                null,
                null,
                null,
                message,
                cause,
            )
        )

    public fun invalidRequest(message: String, code: C? = null): TileflowServiceException =
        make(
            TileflowServiceFailure(
                TileflowServiceErrorKind.INVALID_REQUEST,
                code,
                null,
                null,
                null,
                message,
            )
        )

    public fun network(cause: Throwable?): TileflowServiceException =
        make(
            TileflowServiceFailure(
                TileflowServiceErrorKind.NETWORK,
                null,
                null,
                null,
                null,
                failedMessage,
                cause,
            )
        )

    public fun invalidResponse(status: Int, cause: Throwable? = null): TileflowServiceException =
        make(
            TileflowServiceFailure(
                TileflowServiceErrorKind.INVALID_RESPONSE,
                null,
                status,
                null,
                null,
                invalidResponseMessage,
                cause,
            )
        )

    /** The failure an HTTP error answer describes; [body] is its JSON object, when readable. */
    public fun rejection(
        status: Int,
        body: JSONObject?,
        retryAfterSeconds: Long?,
    ): TileflowServiceFailure<C> {
        fun failure(code: C?, requestId: String?, message: String) =
            TileflowServiceFailure(
                TileflowServiceErrorKind.REJECTED,
                code,
                status,
                requestId,
                retryAfterSeconds,
                message,
            )
        val generic = failure(null, null, failedMessage)
        if (body == null) return generic
        val message = (body.opt("error") as? String)?.let { TileflowText.bounded(it, 512) }
        val requestId = body.opt("requestId")
        if (
            message == null ||
                (requestId != null &&
                    (requestId !is String ||
                        requestId.length !in 1..128 ||
                        !requestIdPattern.matches(requestId)))
        )
            return generic
        if (body.has("code")) {
            val code = (body.opt("code") as? String)?.let(codes::get) ?: return generic
            val trusted =
                statusOf(code) == status || (code == unauthorizedCode && status == 401)
            return if (trusted) failure(code, requestId as String?, message) else generic
        }
        return if (status in codelessStatuses) failure(null, requestId as String?, message)
        else generic
    }

    public companion object {
        public val REQUEST_ID: Regex = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$")

        /** A delay in seconds: 1 to 8 ASCII digits, at most one year. HTTP dates are ignored. */
        public fun retryAfterSeconds(value: String?): Long? {
            if (value == null || value.length !in 1..8 || !value.all { it in '0'..'9' })
                return null
            return value.toLong().takeIf { it <= 31_536_000 }
        }
    }
}

/**
 * The HTTP exchange of a Tileflow service: JSON over HTTPS with the service's credential and the
 * app identity, without redirects or caching, within 30 seconds and bounded request and answer
 * sizes. Blocking work runs on [Dispatchers.IO]; cancelling the coroutine cancels the call.
 */
@TileflowInternalApi
public class TileflowServiceTransport<C : Any>(
    private val errors: TileflowServiceErrors<C>,
    private val configuration: () -> TileflowConfiguration,
    private val app: () -> TileflowAppIdentity?,
    client: OkHttpClient,
) {
    private val client: OkHttpClient =
        client
            .newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .cache(null)
            .callTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()

    /**
     * Sends [body] (a GET without one) to [path] and decodes the answer. [body] validates the
     * request by throwing [TileflowInvalidRequestException]; [decode] validates the answer by
     * throwing [TileflowInvalidResponseException].
     */
    public suspend fun <T> send(
        path: String,
        maximumRequestBytes: Int,
        maximumResponseBytes: Int,
        body: (() -> JSONObject)?,
        decode: (TileflowJsonObject) -> T,
    ): T =
        withContext(Dispatchers.IO) {
            val bytes =
                body?.let { encode ->
                    val json =
                        try {
                            encode()
                        } catch (error: TileflowInvalidRequestException) {
                            throw errors.invalidRequest(error.message ?: errors.failedMessage)
                        }
                    json.toString().toByteArray(Charsets.UTF_8)
                }
            if (bytes != null && bytes.size > maximumRequestBytes)
                throw errors.invalidRequest(
                    "The Tileflow ${errors.name} request is larger than $maximumRequestBytes bytes."
                )
            val exchange =
                try {
                    exchange(request(path, bytes), maximumResponseBytes)
                } catch (error: IOException) {
                    throw errors.network(error)
                }
            when (exchange.status) {
                in 200..299 -> {
                    val root =
                        try {
                            TileflowJson.parseObject(
                                exchange.body ?: throw TileflowInvalidResponseException()
                            )
                        } catch (error: TileflowInvalidResponseException) {
                            throw errors.invalidResponse(exchange.status, error)
                        }
                    try {
                        decode(TileflowJsonObject(root))
                    } catch (error: TileflowInvalidResponseException) {
                        throw errors.invalidResponse(exchange.status, error)
                    } catch (error: JSONException) {
                        throw errors.invalidResponse(exchange.status, error)
                    }
                }
                in 300..399 -> throw errors.network(null)
                else -> {
                    val body =
                        exchange.body?.let {
                            try {
                                TileflowJson.parseObject(it)
                            } catch (_: TileflowInvalidResponseException) {
                                null
                            }
                        }
                    throw errors.make(
                        errors.rejection(
                            exchange.status,
                            body,
                            TileflowServiceErrors.retryAfterSeconds(exchange.retryAfter),
                        )
                    )
                }
            }
        }

    private fun request(path: String, body: ByteArray?): Request {
        val configuration =
            try {
                configuration()
            } catch (error: TileflowConfigurationException) {
                throw errors.configuration(error.message ?: CONFIGURATION_MESSAGE, error)
            }
        val builder =
            Request.Builder()
                .url(configuration.apiOrigin.toString() + path)
                .cacheControl(CacheControl.FORCE_NETWORK)
                .header("Accept", "application/json")
        if (errors.service != TileflowService.GEOIP) {
            val credential =
                configuration.credential(errors.service)
                    ?: throw errors.configuration(
                        "No publishable Tileflow credential is configured for ${errors.name}."
                    )
            val identity =
                configuration.app
                    ?: try {
                        app()
                    } catch (error: TileflowConfigurationException) {
                        throw errors.configuration(error.message ?: CONFIGURATION_MESSAGE, error)
                    }
                    ?: throw errors.configuration("The application's identity is unavailable.")
            builder.header("Authorization", "Bearer ${credential.value}")
            builder.header("X-Tileflow-App", identity.id)
            identity.certificateSha256?.let { builder.header("X-Tileflow-App-Certificate", it) }
        }
        if (body == null) builder.get() else builder.post(body.toRequestBody(JSON))
        return builder.build()
    }

    private class Exchange(val status: Int, val body: ByteArray?, val retryAfter: String?)

    private suspend fun exchange(request: Request, maximumBytes: Int): Exchange =
        suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        continuation.resumeWithException(e)
                    }

                    override fun onResponse(call: Call, response: Response) {
                        val exchange =
                            try {
                                response.use {
                                    val status = it.code
                                    val body =
                                        when (status) {
                                            in 200..299 -> read(it, maximumBytes)
                                            in 300..399 -> null
                                            else -> read(it, ERROR_BYTES)
                                        }
                                    Exchange(status, body, it.header("Retry-After"))
                                }
                            } catch (error: Exception) {
                                // Resume the caller whatever happens while reading the answer.
                                continuation.resumeWithException(IOException(error))
                                return
                            }
                        continuation.resume(exchange)
                    }
                }
            )
        }

    /** The answer's bytes, or null when they exceed [maximumBytes] or cannot be read. */
    private fun read(response: Response, maximumBytes: Int): ByteArray? {
        val body = response.body ?: return null
        if (body.contentLength() > maximumBytes) return null
        return try {
            val source = body.source()
            val buffer = Buffer()
            while (source.read(buffer, 8_192) != -1L) {
                if (buffer.size > maximumBytes) return null
            }
            buffer.readByteArray()
        } catch (_: IOException) {
            null
        }
    }

    private companion object {
        const val TIMEOUT_SECONDS = 30L
        const val ERROR_BYTES = 8 * 1024
        const val CONFIGURATION_MESSAGE = "The Tileflow configuration is invalid."
        val JSON = "application/json".toMediaType()
    }
}

/** What a service client needs from an Android context. */
@TileflowInternalApi
public object TileflowServiceContext {
    /** One client for every Tileflow service, built on first use. */
    public val defaultClient: OkHttpClient by lazy { OkHttpClient.Builder().cache(null).build() }

    public fun configuration(context: Context): () -> TileflowConfiguration {
        val application = context.applicationContext ?: context
        return { Tileflow.configuration(application) }
    }

    public fun app(context: Context): () -> TileflowAppIdentity? {
        val application = context.applicationContext ?: context
        return { TileflowAppIdentity.current(application) }
    }
}
