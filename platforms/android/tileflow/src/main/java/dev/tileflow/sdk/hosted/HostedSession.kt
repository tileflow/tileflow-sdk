package dev.tileflow.sdk.hosted

import android.os.SystemClock
import dev.tileflow.sdk.TileflowClient
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.transport.NativeHTTPTransport
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.Closeable
import java.net.URI
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal class HostedAdmission(val grant: String?, val timeoutMillis: Long)

/**
 * One logical map owns this session across renderer generations. Access runs on resource threads,
 * never the UI thread. The lock single-flights refresh; lifecycle cancellation never takes it.
 */
internal class HostedSession(
    private val client: TileflowClient,
    private val mapId: String,
    private val surfaceId: String,
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val transport: NativeHTTPTransporting = NativeHTTPTransport(65_536),
) : Closeable {
    private val retired = AtomicBoolean()
    private val background = AtomicBoolean()
    private val lock = Any()
    private var sessionId = UUID.randomUUID().toString()
    private var startedAt = now()
    private var serverStartedAt: Long? = null
    private var lastServerTime: Long? = null
    private var requests = 0
    private var authority: HostedAuthority? = null
    private var validUntil = 0L
    private val terminal = AtomicReference<TileflowErrorCode?>()

    fun authorize(url: URI, publicPolicy: ResourcePolicy): HostedAdmission =
        synchronized(lock) {
            checkActive()
            if (requests >= 10_000 || now() - startedAt >= 21_600_000) rotate()
            val current = authority?.takeIf { validUntil - now() > 30_000 } ?: refresh()
            checkActive()
            if (ResourcePolicy.origin(url) in current.origins) {
                if (!HostedContract.permits(url, mapId, current))
                    throw TileflowMapException(TileflowErrorCode.ACCESS_DENIED)
                val remaining = validUntil - now() - 500
                if (remaining <= 0)
                    throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
                requests++
                HostedAdmission(current.grant, minOf(30_000, remaining))
            } else {
                publicPolicy.validate(url)
                if (ResourcePolicy.origin(url) == ResourcePolicy.origin(client.apiOrigin)) {
                    throw TileflowMapException(TileflowErrorCode.ACCESS_DENIED)
                }
                HostedAdmission(null, 30_000)
            }
        }

    // Rejection must not wait for an in-flight refresh holding the admission lock.
    fun reject(status: Int) {
        terminal.compareAndSet(
            null,
            when (status) {
                401 -> TileflowErrorCode.CREDENTIAL_REJECTED
                429 -> TileflowErrorCode.QUOTA_EXCEEDED
                else -> TileflowErrorCode.ACCESS_DENIED
            },
        )
        transport.cancelActive()
    }

    fun setBackgrounded(value: Boolean) {
        background.set(value)
        if (value) transport.cancelActive()
    }

    override fun close() {
        retired.set(true)
        transport.close()
    }

    private fun refresh(): HostedAuthority {
        try {
            repeat(2) { attempt ->
                checkActive()
                val requestStarted = now()
                val response =
                    try {
                        transport.send(client.sessionRequest(mapId, sessionId, surfaceId))
                    } catch (_: Exception) {
                        checkActive()
                        throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
                    }
                checkActive()
                if (
                    response.status == 409 &&
                        attempt == 0 &&
                        HostedContract.isRestart(response.bytes, sessionId)
                ) {
                    rotate()
                    return@repeat
                }
                if (response.status != 201)
                    throw TileflowMapException(
                        when (response.status) {
                            401 -> TileflowErrorCode.CREDENTIAL_REJECTED
                            403,
                            404 -> TileflowErrorCode.ACCESS_DENIED
                            429 -> TileflowErrorCode.QUOTA_EXCEEDED
                            in 500..599 -> TileflowErrorCode.SESSION_UNAVAILABLE
                            else -> TileflowErrorCode.INVALID_SESSION_RESPONSE
                        }
                    )
                val next = HostedContract.parse(response.bytes, mapId, sessionId, surfaceId)
                if (lastServerTime?.let { next.serverTime < it } == true) {
                    throw TileflowMapException(TileflowErrorCode.INVALID_SESSION_RESPONSE)
                }
                if (serverStartedAt?.let { next.serverTime - it >= 21_600_000 } == true) {
                    if (attempt != 0)
                        throw TileflowMapException(TileflowErrorCode.INVALID_SESSION_RESPONSE)
                    rotate()
                    return@repeat
                }
                validUntil = requestStarted + (next.expiresAt - next.serverTime)
                if (validUntil - now() <= 30_000)
                    throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
                lastServerTime = next.serverTime
                serverStartedAt = serverStartedAt ?: next.serverTime
                authority = next
                return next
            }
            throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
        } catch (error: TileflowMapException) {
            if (
                error.code in
                    setOf(
                        TileflowErrorCode.CREDENTIAL_REJECTED,
                        TileflowErrorCode.ACCESS_DENIED,
                        TileflowErrorCode.QUOTA_EXCEEDED,
                        TileflowErrorCode.INVALID_SESSION_RESPONSE,
                    )
            )
                terminal.compareAndSet(null, error.code)
            throw error
        }
    }

    private fun rotate() {
        sessionId = UUID.randomUUID().toString()
        startedAt = now()
        serverStartedAt = null
        lastServerTime = null
        requests = 0
        authority = null
        validUntil = 0
    }

    private fun checkActive() {
        if (retired.get()) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        terminal.get()?.let { throw TileflowMapException(it) }
        if (background.get()) throw TileflowMapException(TileflowErrorCode.NOT_READY)
    }
}
