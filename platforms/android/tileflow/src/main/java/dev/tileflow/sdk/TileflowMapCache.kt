package dev.tileflow.sdk

import android.content.Context
import dev.tileflow.sdk.transport.ResourceCacheStore
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What a cached resource is. Each class is its own partition on disk and in usage reports. */
public enum class TileflowResourceClass {
    /** Style documents and map metadata: manifests, style JSON and TileJSON. */
    STYLE,

    /** Vector, raster and elevation tiles. */
    TILES,

    /** Glyph ranges and font files. */
    GLYPHS,

    /** Sprite sheets and their indexes. */
    SPRITES,

    /** 3D assets: glTF and GLB models and their textures. */
    MODELS,
    OTHER;

    internal val directory: String = name.lowercase()

    internal companion object
}

/**
 * How much of the shared resource cache is in use.
 *
 * @property bytes Bytes on disk, including each entry's stored headers.
 * @property maximumBytes The budget beyond which least recently used resources are removed.
 */
public data class TileflowMapCacheUsage(
    val bytes: Long,
    val entries: Int,
    val maximumBytes: Long,
    val bytesByClass: Map<TileflowResourceClass, Long>,
)

/**
 * The disk cache every map in the process shares.
 *
 * Public resources such as styles, tiles, glyphs, sprites and 3D models are stored as their
 * `Cache-Control`, `ETag` and `Last-Modified` headers allow, revalidated when stale and reused by
 * every map and mount, also when the network is unavailable. A response marked `no-store` is never
 * written; Hosted maps' protected resources are served that way today. The budget comes from
 * [TileflowDeviceProfile.current] unless [maximumBytes] is set.
 */
public class TileflowMapCache private constructor(internal val store: ResourceCacheStore) {
    /** The bytes the cache may keep before it removes least recently used resources. */
    public var maximumBytes: Long
        get() = store.maximumBytes
        set(value) {
            store.maximumBytes = value
        }

    /** Current usage. Waits for the cache to index what earlier launches stored. */
    public suspend fun usage(): TileflowMapCacheUsage =
        withContext(Dispatchers.IO) {
            val usage = store.usage()
            TileflowMapCacheUsage(
                usage.bytes,
                usage.entries,
                store.maximumBytes,
                usage.bytesByClass,
            )
        }

    /**
     * Removes every cached resource. Maps already showing keep what they have loaded and fetch
     * anything else again.
     */
    public suspend fun clear(): Unit = withContext(Dispatchers.IO) { store.clear() }

    public companion object {
        @Volatile private var instance: TileflowMapCache? = null

        /** The process's cache. */
        @JvmStatic
        public fun get(context: Context): TileflowMapCache =
            instance
                ?: synchronized(this) {
                    instance
                        ?: run {
                            val application = context.applicationContext ?: context
                            val profile = TileflowDeviceProfile.current(application)
                            TileflowMapCache(
                                ResourceCacheStore(
                                    File(application.cacheDir, "dev.tileflow/resources-v1"),
                                    File(application.noBackupFilesDir, "dev.tileflow/resources-v1"),
                                    profile.cacheBytes,
                                )
                            )
                        }
                            .also { instance = it }
                }

        internal fun existing(): TileflowMapCache? = instance
    }
}
