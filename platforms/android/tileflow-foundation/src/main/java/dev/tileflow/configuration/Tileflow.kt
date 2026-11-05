package dev.tileflow.configuration

import android.content.Context

/**
 * The process-wide Tileflow configuration. Service clients use the configuration set with
 * [configure], or else the one in the application's resources, read on first use and cached for the
 * process, including a failure to read it.
 */
public object Tileflow {
    private val lock = Any()
    @Volatile private var explicit: TileflowConfiguration? = null
    @Volatile private var resources: Result<TileflowConfiguration>? = null

    /** Replaces the resource configuration for the rest of the process. */
    @JvmStatic
    public fun configure(configuration: TileflowConfiguration) {
        explicit = configuration
    }

    /**
     * Reads and caches the application's resources configuration now, which reports a malformed
     * value at startup instead of at the first service request. Optional.
     *
     * @throws TileflowConfigurationException when a resource value is invalid.
     */
    @JvmStatic
    public fun configure(context: Context) {
        resourceConfigurationOf(readResources(context))
    }

    /**
     * The configuration set with [configure], or else the application's resources configuration.
     *
     * @throws TileflowConfigurationException when the resource configuration is invalid.
     */
    @JvmStatic
    public fun configuration(context: Context): TileflowConfiguration =
        configuration(readResources(context))

    internal fun configuration(read: () -> TileflowConfiguration): TileflowConfiguration =
        explicit ?: resourceConfigurationOf(read)

    private fun readResources(context: Context): () -> TileflowConfiguration = {
        TileflowConfiguration.fromResources(context.applicationContext ?: context)
    }

    private fun resourceConfigurationOf(read: () -> TileflowConfiguration): TileflowConfiguration {
        val result =
            resources
                ?: synchronized(lock) { resources ?: runCatching(read).also { resources = it } }
        return result.getOrElse {
            throw TileflowConfigurationException(
                it.message ?: "The Tileflow resource configuration is invalid.",
                it,
            )
        }
    }

    internal fun resetForTesting() {
        explicit = null
        resources = null
    }
}
