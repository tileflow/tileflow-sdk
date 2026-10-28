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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock

internal class HostedAdmission(val grant: String?, val timeoutMillis: Long)

/**
 * One logical map owns this session across renderer generations. Access runs on resource threads,
 * never the UI thread. The lock single-flights refresh, so waiters share its result or its retry
 * delay, and none waits longer than its request budget. Lifecycle cancellation never takes it.
 */
internal class HostedSession(
    private val client: TileflowClient,
    private val mapId: String,
    private val surfaceId: String,
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val transport: NativeHTTPTransporting = NativeHTTPTransport(65_536),
    private val waitMillis: Long = 30_000,
) : Closeable {
    private val retired = AtomicBoolean()
    private val background = AtomicBoolean()
    private val retryRequested = AtomicBoolean()
    private val refreshing = AtomicBoolean()
    private val staleGrant = AtomicReference<String?>()
    private val forcedRenewalAt = AtomicReference<Long?>()
    private val lock = ReentrantLock()
    private var sessionId = UUID.randomUUID().toString()
    private var startedAt = now()
    private var serverStartedAt: Long? = null
    private var lastServerTime: Long? = null
    private var requests = 0
    // Written under the lock; read without it only to compare grants.
    @Volatile private var authority: HostedAuthority? = null
    private var validUntil = 0L
    private val terminal = AtomicReference<TileflowErrorCode?>()
    // Recoverable bootstrap failures delay the next bootstrap; a still-valid grant keeps admitting.
    private var failures = 0
    private var retryAt: Long? = null
    private var retryError = TileflowErrorCode.SESSION_UNAVAILABLE

    fun authorize(url: URI, publicPolicy: ResourcePolicy): HostedAdmission {
        val acquired =
            try {
                lock.tryLock(waitMillis, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                false
            }
        if (!acquired) throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
        try {
            checkActive()
            staleGrant.getAndSet(null)?.let {
                if (authority?.grant == it) {
                    authority = null
                    validUntil = 0
                }
            }
            if (requests >= 10_000 || now() - startedAt >= 21_600_000) rotate()
            val current =
                authority?.takeIf { validUntil - now() > 30_000 } ?: delayed() ?: refresh()
            checkActive()
            if (ResourcePolicy.origin(url) in current.origins) {
                if (!HostedContract.permits(url, mapId, current))
                    throw TileflowMapException(TileflowErrorCode.ACCESS_DENIED)
                val remaining = validUntil - now() - 500
                if (remaining <= 0)
                    throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
                requests++
                return HostedAdmission(current.grant, minOf(30_000, remaining))
            } else {
                publicPolicy.validate(url)
                if (ResourcePolicy.origin(url) == ResourcePolicy.origin(client.apiOrigin)) {
                    throw TileflowMapException(TileflowErrorCode.ACCESS_DENIED)
                }
                return HostedAdmission(null, 30_000)
            }
        } finally {
            lock.unlock()
        }
    }

    /**
     * A granted resource was refused for good; the session stops until [retry]. Rejection must not
     * wait for an in-flight refresh holding the admission lock.
     */
    fun reject(code: TileflowErrorCode) {
        terminal.compareAndSet(null, code)
        transport.cancelActive()
    }

    /**
     * The service no longer accepts [grant], for example after a credential or policy change. The
     * next admission bootstraps again and the caller may retry once. A second forced renewal within
     * 30 s keeps the grant and returns false, so a resource the service keeps refusing cannot loop
     * bootstrap. It never stops the session or waits for an in-flight bootstrap.
     */
    fun invalidate(grant: String): Boolean {
        // A newer grant or an in-flight bootstrap has already replaced it.
        if (refreshing.get() || authority?.grant != grant) return true
        val at = now()
        if (forcedRenewalAt.get()?.let { at - it < 30_000 } == true) return false
        forcedRenewalAt.set(at)
        staleGrant.set(grant)
        return true
    }

    /** Clears a terminal stop and any retry delay; the next admission bootstraps again. */
    fun retry() {
        retryRequested.set(true)
    }

    fun setBackgrounded(value: Boolean) {
        background.set(value)
        if (value) transport.cancelActive()
    }

    override fun close() {
        retired.set(true)
        transport.close()
    }

    /** During a retry delay a still-valid grant keeps admitting; otherwise the delay fails. */
    private fun delayed(): HostedAuthority? {
        val until = retryAt ?: return null
        if (now() >= until) return null
        return authority?.takeIf { validUntil > now() } ?: throw TileflowMapException(retryError)
    }

    private fun refresh(): HostedAuthority {
        refreshing.set(true)
        try {
            return bootstrap().also {
                failures = 0
                retryAt = null
            }
        } catch (failure: StatusFailure) {
            record(failure.code, failure.retryAfterMillis)
            throw TileflowMapException(failure.code)
        } catch (error: TileflowMapException) {
            record(error.code, null)
            throw error
        } finally {
            refreshing.set(false)
        }
    }

    /**
     * Credential, access and quota failures stop the session; anything else delays the next
     * bootstrap by 1 s doubling to 60 s, or longer when the service sends Retry-After.
     */
    private fun record(code: TileflowErrorCode, retryAfterMillis: Long?) {
        if (retired.get() || background.get() || terminal.get() != null) return
        if (code in HostedContract.terminalCodes) {
            if (terminal.compareAndSet(null, code)) {
                authority = null
                validUntil = 0
            }
            return
        }
        if (
            code !in
                setOf(
                    TileflowErrorCode.RATE_LIMITED,
                    TileflowErrorCode.SESSION_UNAVAILABLE,
                    TileflowErrorCode.INVALID_SESSION_RESPONSE,
                )
        )
            return
        // The admission lock single-flights bootstraps and none starts during a delay.
        failures = minOf(failures + 1, 16)
        val backoff = minOf(1_000L shl (failures - 1), 60_000L)
        retryAt = now() + maxOf(backoff, retryAfterMillis ?: 0)
        retryError = code
    }

    private fun bootstrap(): HostedAuthority {
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
                throw StatusFailure(
                    HostedContract.failure(response.status, response.bytes),
                    HostedContract.retryAfterMillis(
                        response.headers["Retry-After"],
                        System.currentTimeMillis(),
                    ),
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
            val until = requestStarted + (next.expiresAt - next.serverTime)
            if (until - now() <= 30_000)
                throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
            lastServerTime = next.serverTime
            serverStartedAt = serverStartedAt ?: next.serverTime
            authority = next
            validUntil = until
            return next
        }
        throw TileflowMapException(TileflowErrorCode.SESSION_UNAVAILABLE)
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
        if (retryRequested.getAndSet(false)) {
            // A stopped session never reuses the grant that was refused.
            if (terminal.getAndSet(null) != null) {
                authority = null
                validUntil = 0
            }
            failures = 0
            retryAt = null
        }
        terminal.get()?.let { throw TileflowMapException(it) }
        if (background.get()) throw TileflowMapException(TileflowErrorCode.NOT_READY)
    }
}

/** A failed bootstrap status and the delay the service asked for. */
private class StatusFailure(val code: TileflowErrorCode, val retryAfterMillis: Long?) : Exception()
