package dev.tileflow.configuration

import android.content.Context

/**
 * The process-wide Tileflow configuration. Service clients use the configuration set with
 * [configure], or else the one in the application's manifest, read on first use and cached for the
 * process, including a failure to read it.
 */
public object Tileflow {
    private val lock = Any()
    @Volatile private var explicit: TileflowConfiguration? = null
    @Volatile private var manifest: Result<TileflowConfiguration>? = null

    /** Replaces the manifest configuration for the rest of the process. */
    @JvmStatic
    public fun configure(configuration: TileflowConfiguration) {
        explicit = configuration
    }

    /**
     * Reads and caches the application's manifest configuration now, which reports a malformed
     * value at startup instead of at the first service request. Optional.
     *
     * @throws TileflowConfigurationException when a manifest value is invalid.
     */
    @JvmStatic
    public fun configure(context: Context) {
        manifestConfiguration(manifest(context))
    }

    /**
     * The configuration set with [configure], or else the application's manifest configuration.
     *
     * @throws TileflowConfigurationException when the manifest configuration is invalid.
     */
    @JvmStatic
    public fun configuration(context: Context): TileflowConfiguration =
        configuration(manifest(context))

    internal fun configuration(read: () -> TileflowConfiguration): TileflowConfiguration =
        explicit ?: manifestConfiguration(read)

    private fun manifest(context: Context): () -> TileflowConfiguration = {
        TileflowConfiguration.fromManifest(context.applicationContext ?: context)
    }

    private fun manifestConfiguration(read: () -> TileflowConfiguration): TileflowConfiguration {
        val result =
            manifest
                ?: synchronized(lock) { manifest ?: runCatching(read).also { manifest = it } }
        return result.getOrElse {
            throw TileflowConfigurationException(
                it.message ?: "The Tileflow manifest configuration is invalid.",
                it,
            )
        }
    }

    internal fun resetForTesting() {
        explicit = null
        manifest = null
    }
}
