package dev.tileflow.sdk.transport

import android.content.Context
import android.content.res.AssetManager
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import dev.tileflow.sdk.TileflowDeviceProfile
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapCache
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.bridge.ProtocolContract
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * The renderer embedded in the SDK's assets. Its receipt is read once per process and its files'
 * SHA-256 digests are verified once per process, on a background thread.
 */
internal object EmbeddedRuntime {
    class Receipt(val runtimeHash: String, val protocolVersion: Int, val files: Map<String, String>)

    private val FILES =
        setOf("index.html", "runtime.js", "maplibre.css", "notices.txt", "dependencies.json")
    private val executor =
        Executors.newSingleThreadExecutor {
            Thread(it, "tileflow-runtime-verification").apply { isDaemon = true }
        }
    @Volatile private var loaded: Result<Receipt>? = null
    @Volatile private var verification: CompletableFuture<Unit>? = null

    /** The runtime's receipt. Reading it is cheap; the files are verified by [verification]. */
    fun receipt(assets: AssetManager): Receipt =
        (loaded ?: synchronized(this) { loaded ?: read(assets).also { loaded = it } }).getOrThrow()

    /** Hashes every runtime file once per process. Completes exceptionally on a mismatch. */
    fun verification(assets: AssetManager): CompletableFuture<Unit> =
        verification
            ?: synchronized(this) {
                verification
                    ?: CompletableFuture.supplyAsync({ verify(assets) }, executor).also {
                        verification = it
                    }
            }

    /** Whether verification finished, and how. Null while it runs or before it starts. */
    val failure: TileflowMapException?
        get() {
            val future = verification ?: return null
            if (!future.isDone) return null
            return runCatching { future.join() }.exceptionOrNull()?.let(::mapException)
        }

    val isVerified: Boolean
        get() = verification?.let { it.isDone && !it.isCompletedExceptionally } == true

    fun mapException(error: Throwable): TileflowMapException =
        (error as? TileflowMapException)
            ?: (error.cause as? TileflowMapException)
            ?: TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)

    private fun read(assets: AssetManager): Result<Receipt> = runCatching {
        val receipt =
            try {
                JSONObject(assets.open("tileflow/receipt.json").bufferedReader().use { it.readText() })
            } catch (_: Exception) {
                throw TileflowMapException(TileflowErrorCode.MISSING_RUNTIME)
            }
        if (
            receipt.getInt("protocolVersion") !in
                ProtocolContract.MINIMUM_VERSION..ProtocolContract.VERSION
        )
            throw TileflowMapException(
                TileflowErrorCode.INCOMPATIBLE_RUNTIME,
                TileflowErrorContext.of(ProtocolContract.ErrorReason.PROTOCOL_VERSION),
            )
        val files = receipt.getJSONObject("files")
        val names = files.keys().asSequence().toSet()
        if (names != FILES) throw TileflowMapException(TileflowErrorCode.MISSING_RUNTIME)
        Receipt(
            receipt.getString("runtimeHash"),
            receipt.getInt("protocolVersion"),
            names.associateWith { files.getString(it) },
        )
    }

    private fun verify(assets: AssetManager) {
        for ((name, expected) in receipt(assets).files) {
            val digest = MessageDigest.getInstance("SHA-256")
            assets.open("tileflow/$name").use { stream ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = stream.read(buffer)
                    if (count == -1) break
                    digest.update(buffer, 0, count)
                }
            }
            if (digest.digest().joinToString("") { "%02x".format(it) } != expected)
                throw TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)
        }
    }
}

/** Prepares what every map needs before the first one is shown. */
internal object MapPrewarmer {
    private var started = false

    fun start(context: Context) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Call prewarm on the main thread." }
        val application = context.applicationContext ?: context
        EmbeddedRuntime.verification(application.assets)
        Thread(
                {
                    TileflowDeviceProfile.current(application)
                    TileflowMapCache.get(application)
                    TileflowHttpClient.resources
                    TileflowHttpClient.sessions
                },
                "tileflow-prewarm",
            )
            .apply { isDaemon = true }
            .start()
        if (started) return
        started = true
        // Creating a WebView loads the WebView provider; a blank page starts its renderer. Only
        // the delayed release holds it, so nothing static keeps it alive.
        val view = runCatching { WebView(application) }.getOrNull() ?: return
        view.settings.javaScriptEnabled = false
        view.loadUrl("about:blank")
        Handler(Looper.getMainLooper()).postDelayed({ view.destroy() }, 10_000)
    }
}
