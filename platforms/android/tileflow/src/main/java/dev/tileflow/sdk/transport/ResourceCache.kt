package dev.tileflow.sdk.transport

import dev.tileflow.sdk.TileflowResourceClass
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Classifies a resource by its URL alone, so a lookup always finds what a store placed. */
internal fun TileflowResourceClass.Companion.classify(url: URI): TileflowResourceClass {
    val path = (url.rawPath ?: "").lowercase()
    val name = path.substringAfterLast('/')
    val ext = name.substringAfterLast('.', "")
    if (
        ext in setOf("glb", "gltf", "ktx2", "basis", "b3dm") ||
            "/models/" in path ||
            "/team-models/" in path
    )
        return TileflowResourceClass.MODELS
    if (
        ext in setOf("woff2", "woff", "ttf", "otf") ||
            (ext == "pbf" && ("/fonts/" in path || "/glyphs/" in path))
    )
        return TileflowResourceClass.GLYPHS
    if (name.startsWith("sprite") && ext in setOf("json", "png"))
        return TileflowResourceClass.SPRITES
    val parts = path.split('/').filter { it.isNotEmpty() }.takeLast(3)
    if (
        parts.size == 3 &&
            parts.withIndex().all { (index, part) ->
                val value = if (index == 2) part.substringBeforeLast('.') else part
                value.isNotEmpty() && value.all { it in '0'..'9' }
            }
    )
        return TileflowResourceClass.TILES
    return if (ext == "json") TileflowResourceClass.STYLE else TileflowResourceClass.OTHER
}

/** Who may reuse a stored response. */
internal sealed class ResourceCacheScope {
    abstract val directory: String

    /** Public resources: reusable by every map and every mount in the process. */
    object Shared : ResourceCacheScope() {
        override val directory = "shared"
    }

    /**
     * Resources admitted with a Hosted grant: reusable only by maps of the same API origin and
     * Map ID, and only after that map's session admits the request again. The identifier is a
     * digest; grants and credentials never appear on disk.
     */
    data class Grant(val id: String) : ResourceCacheScope() {
        override val directory = "grant-$id"
    }

    companion object {
        fun grant(apiOrigin: URI, mapId: String): ResourceCacheScope =
            Grant(
                sha256Hex("${ResourcePolicy.origin(apiOrigin)}\n$mapId".toByteArray()).take(32)
            )
    }
}

/** Which budget an entry belongs to. */
internal enum class ResourceCacheRetention {
    /**
     * The ambient cache: one size budget, least-recently-used eviction, cleared by
     * `TileflowMapCache.clear()`, and stored where the system may reclaim it.
     */
    AMBIENT,

    /**
     * Kept until its owner removes it, such as the resources of an offline region. Eviction and
     * ambient clearing never touch it, and it is stored outside the cache directory and backups.
     */
    PINNED,
}

/**
 * The address of one stored response. Ambient and pinned stores use the same keys, so a pinned
 * entry answers exactly the requests an ambient one would.
 */
internal data class ResourceCacheKey(val url: URI, val scope: ResourceCacheScope) {
    val resourceClass = TileflowResourceClass.classify(url)

    /** SHA-256 of the ASCII URL, in lowercase hexadecimal. */
    val digest = sha256Hex(url.toASCIIString().toByteArray())

    /** `<scope>/<class>/<first two digest characters>/<digest>`. */
    val relativePath = "${scope.directory}/${resourceClass.directory}/${digest.take(2)}/$digest"
}

/** What is kept with a stored body. Times are epoch milliseconds. */
internal data class ResourceCacheMetadata(
    val url: String,
    val status: Int,
    val headers: Map<String, String>,
    val responseTime: Long,
    val expires: Long,
    val staleLimit: Long,
    val bodyLength: Int,
    val bodySha256: String,
) {
    fun isFresh(now: Long) = now < expires

    fun isUsableAfterNetworkFailure(now: Long) = now < staleLimit

    fun json(): ByteArray =
        JSONObject()
            .put("url", url)
            .put("status", status)
            .put("headers", JSONObject(headers))
            .put("responseTime", responseTime)
            .put("expires", expires)
            .put("staleLimit", staleLimit)
            .put("bodyLength", bodyLength)
            .put("bodySHA256", bodySha256)
            .toString()
            .toByteArray()

    companion object {
        fun of(
            url: URI,
            status: Int,
            headers: Map<String, String>,
            responseTime: Long,
            protected: Boolean,
            bodyLength: Int,
            bodySha256: String,
        ): ResourceCacheMetadata {
            val stored = ResourceCachePolicy.storable(headers)
            val expiry = ResourceCachePolicy.expiry(stored, responseTime, protected)
            return ResourceCacheMetadata(
                url.toASCIIString(),
                status,
                stored,
                responseTime,
                expiry,
                ResourceCachePolicy.staleLimit(stored, expiry, protected),
                bodyLength,
                bodySha256,
            )
        }

        fun parse(bytes: ByteArray): ResourceCacheMetadata {
            val value = JSONObject(String(bytes, Charsets.UTF_8))
            val headers = value.getJSONObject("headers")
            return ResourceCacheMetadata(
                value.getString("url"),
                value.getInt("status"),
                headers.keys().asSequence().associateWith { headers.getString(it) },
                value.getLong("responseTime"),
                value.getLong("expires"),
                value.getLong("staleLimit"),
                value.getInt("bodyLength"),
                value.getString("bodySHA256"),
            )
        }
    }
}

/** A stored response, verified against its digest. */
internal class StoredResource(val metadata: ResourceCacheMetadata, val body: ByteArray)

internal class ResourceCacheCorruptedException : IOException("The cached resource is corrupted.")

/**
 * The entry file format, shared by ambient and pinned stores and identical on iOS:
 * ```
 * body ‖ metadata JSON ‖ metadata length (UInt32 BE) ‖ format (UInt32 BE) ‖ "TFC1"
 * ```
 *
 * The trailer lets a streamed body be written once, front to back. Reading checks the magic,
 * format, lengths, URL and the body's SHA-256; any mismatch drops the entry.
 */
internal object ResourceCacheEntryFormat {
    val MAGIC = "TFC1".toByteArray()
    const val VERSION = 1
    const val TRAILER_LENGTH = 12

    fun trailer(metadata: ResourceCacheMetadata): ByteArray {
        val json = metadata.json()
        return ByteBuffer.allocate(json.size + TRAILER_LENGTH)
            .put(json)
            .putInt(json.size)
            .putInt(VERSION)
            .put(MAGIC)
            .array()
    }

    fun encode(metadata: ResourceCacheMetadata, body: ByteArray): ByteArray =
        body + trailer(metadata)

    fun decode(data: ByteArray, expecting: URI): StoredResource {
        val count = data.size
        if (count < TRAILER_LENGTH) throw ResourceCacheCorruptedException()
        val buffer = ByteBuffer.wrap(data)
        if (
            !data.copyOfRange(count - 4, count).contentEquals(MAGIC) ||
                buffer.getInt(count - 8) != VERSION
        )
            throw ResourceCacheCorruptedException()
        val metadataLength = buffer.getInt(count - 12)
        if (metadataLength <= 0 || metadataLength > count - TRAILER_LENGTH)
            throw ResourceCacheCorruptedException()
        val bodyLength = count - TRAILER_LENGTH - metadataLength
        val metadata =
            try {
                ResourceCacheMetadata.parse(
                    data.copyOfRange(bodyLength, bodyLength + metadataLength)
                )
            } catch (_: Exception) {
                throw ResourceCacheCorruptedException()
            }
        if (metadata.url != expecting.toASCIIString() || metadata.bodyLength != bodyLength)
            throw ResourceCacheCorruptedException()
        val body = data.copyOfRange(0, bodyLength)
        if (sha256Hex(body) != metadata.bodySha256) throw ResourceCacheCorruptedException()
        return StoredResource(metadata, body)
    }
}

/**
 * The process's resource cache on disk.
 *
 * Layout. Ambient entries live under `<cacheDir>/dev.tileflow/resources-v1/`, which the system may
 * reclaim; pinned entries live under `<noBackupFilesDir>/dev.tileflow/resources-v1/pinned/`. Both
 * use [ResourceCacheKey.relativePath]:
 * ```
 * shared/<class>/<aa>/<sha256(url)>         public resources
 * grant-<scope>/<class>/<aa>/<sha256(url)>  protected resources of one grant scope
 * staging/<store>/<uuid>                    partial writes; others' are removed on open
 * ```
 *
 * Entries are written to `staging/` and renamed into place, so a reader sees a whole entry or none.
 * Each file is self-describing ([ResourceCacheEntryFormat]); there is no separate journal to fall
 * out of step. A corrupted or mismatched entry is deleted when read.
 *
 * Eviction. Ambient entries share one byte budget across every class and scope. When a write takes
 * the total above the budget, the least recently used entries are removed until the total is at
 * most 90% of it. An entry's last use is its file modification time, refreshed on every read.
 * Pinned entries are never evicted, never counted against the budget and never removed by ambient
 * clearing; their owner removes them with [removePinned].
 *
 * `no-store`. The transport never offers this store a response whose `Cache-Control` says
 * `no-store`, such as protected Hosted responses served with `private, no-store`.
 */
internal class ResourceCacheStore(
    val ambientRoot: File,
    val durableRoot: File,
    maximumBytes: Long,
    private val now: () -> Long = System::currentTimeMillis,
) {
    companion object {
        /**
         * The largest pinned body, such as one resource of a downloaded region: the largest the
         * Hosted offline pack contract allows.
         */
        const val MAXIMUM_PINNED_ENTRY_BYTES = 32 * 1024 * 1024
    }

    data class Usage(
        val bytes: Long = 0,
        val entries: Int = 0,
        val bytesByClass: Map<TileflowResourceClass, Long> = emptyMap(),
    )

    private class IndexEntry(
        val bytes: Long,
        var lastUse: Long,
        val resourceClass: TileflowResourceClass,
    )

    private val lock = Any()
    private val maintenance =
        Executors.newSingleThreadExecutor {
            Thread(it, "tileflow-resource-cache").apply { isDaemon = true }
        }
    private val indexed = CountDownLatch(1)
    private val index = HashMap<String, IndexEntry>()
    private var total = 0L
    private var budget = maximumBytes.coerceAtLeast(0)
    private var generation = 0
    private var evictionScheduled = false
    private var dropped = 0
    private val directories = HashSet<String>()
    private val stagingName = UUID.randomUUID().toString()

    init {
        maintenance.execute {
            // Earlier processes' partial writes; this store's own staging directory stays.
            for (root in listOf(ambientRoot, File(durableRoot, "pinned")))
                File(root, "staging").listFiles().orEmpty().forEach {
                    if (it.name != stagingName) it.deleteRecursively()
                }
            File(ambientRoot, "trash").deleteRecursively()
            val scanned = scan()
            synchronized(lock) {
                // Entries written during the scan are already indexed under the same paths.
                for ((path, entry) in scanned) {
                    if (index.containsKey(path)) continue
                    index[path] = entry
                    total += entry.bytes
                }
            }
            indexed.countDown()
            evictIfNeeded()
        }
    }

    var maximumBytes: Long
        get() = synchronized(lock) { budget }
        set(value) {
            synchronized(lock) { budget = value.coerceAtLeast(0) }
            evictIfNeeded()
        }

    /** Entries dropped because they failed verification since the store opened. */
    val droppedEntries: Int
        get() = synchronized(lock) { dropped }

    /** The largest body stored: one eighth of the budget, at most 16 MiB. */
    val maximumEntryBytes: Long
        get() = synchronized(lock) { minOf(budget / 8, 16L * 1024 * 1024) }

    fun file(key: ResourceCacheKey, retention: ResourceCacheRetention): File =
        File(root(retention), key.relativePath)

    /** A verified stored response, or null. Reading refreshes the entry's last use. */
    fun read(key: ResourceCacheKey, retention: ResourceCacheRetention): StoredResource? {
        val file = file(key, retention)
        val data = runCatching { file.readBytes() }.getOrNull() ?: return null
        return try {
            val stored = ResourceCacheEntryFormat.decode(data, key.url)
            val time = now()
            if (retention == ResourceCacheRetention.AMBIENT)
                synchronized(lock) { index[key.relativePath]?.lastUse = time }
            file.setLastModified(time)
            stored
        } catch (_: ResourceCacheCorruptedException) {
            remove(key, retention)
            synchronized(lock) { dropped += 1 }
            null
        }
    }

    /** Starts writing an entry. The returned writer stores nothing until it commits. */
    fun writer(key: ResourceCacheKey, retention: ResourceCacheRetention): ResourceCacheWriter? {
        val limit =
            if (retention == ResourceCacheRetention.PINNED) MAXIMUM_PINNED_ENTRY_BYTES.toLong()
            else maximumEntryBytes
        if (limit <= 0) return null
        val staging = File(root(retention), "staging/$stagingName")
        val file = File(staging, UUID.randomUUID().toString())
        return try {
            staging.mkdirs()
            ResourceCacheWriter(
                this,
                key,
                retention,
                file,
                FileOutputStream(file),
                limit,
                synchronized(lock) { generation },
            )
        } catch (_: IOException) {
            file.delete()
            null
        }
    }

    /** Stores a whole response at once. */
    fun write(
        key: ResourceCacheKey,
        retention: ResourceCacheRetention,
        metadata: ResourceCacheMetadata,
        body: ByteArray,
    ): Boolean {
        val writer = writer(key, retention) ?: return false
        if (!writer.append(body, 0, body.size)) return false
        return writer.commit(metadata)
    }

    fun remove(key: ResourceCacheKey, retention: ResourceCacheRetention) {
        file(key, retention).delete()
        if (retention != ResourceCacheRetention.AMBIENT) return
        synchronized(lock) { index.remove(key.relativePath)?.let { total -= it.bytes } }
    }

    /** Removes pinned entries. Their owner tracks which keys it holds. */
    fun removePinned(keys: Iterable<ResourceCacheKey>) {
        for (key in keys) remove(key, ResourceCacheRetention.PINNED)
    }

    /** Removes ambient entries of one scope, or of every scope. Writes in flight are discarded. */
    fun clear(scope: ResourceCacheScope? = null) {
        indexed.await()
        val moved =
            synchronized(lock) {
                generation += 1
                val prefix = scope?.let { "${it.directory}/" }
                val iterator = index.entries.iterator()
                while (iterator.hasNext()) {
                    val (path, entry) = iterator.next()
                    if (prefix == null || path.startsWith(prefix)) {
                        total -= entry.bytes
                        iterator.remove()
                    }
                }
                directories.clear()
                val names =
                    scope?.let { listOf(it.directory) }
                        ?: ambientRoot.list().orEmpty().filter { it != "staging" && it != "trash" }
                val trash = File(ambientRoot, "trash").apply { mkdirs() }
                names.mapNotNull { name ->
                    val target = File(trash, UUID.randomUUID().toString())
                    if (File(ambientRoot, name).renameTo(target)) target else null
                }
            }
        maintenance.execute { moved.forEach { it.deleteRecursively() } }
    }

    /** Ambient usage, once the store has indexed what earlier processes left on disk. */
    fun usage(): Usage {
        indexed.await()
        return synchronized(lock) {
            val byClass = HashMap<TileflowResourceClass, Long>()
            for (entry in index.values)
                byClass[entry.resourceClass] = (byClass[entry.resourceClass] ?: 0) + entry.bytes
            Usage(total, index.size, byClass)
        }
    }

    /** Waits until pending maintenance, such as indexing and eviction, has finished. */
    fun settle() {
        indexed.await()
        val done = CountDownLatch(1)
        maintenance.execute { done.countDown() }
        done.await(30, TimeUnit.SECONDS)
    }

    internal fun commit(
        staging: File,
        key: ResourceCacheKey,
        retention: ResourceCacheRetention,
        bytes: Long,
        started: Int,
    ): Boolean {
        val target = file(key, retention)
        val directory = target.parentFile!!
        synchronized(lock) {
            if (started != generation) return false
            if (directory.path !in directories) {
                if (!directory.isDirectory && !directory.mkdirs()) return false
                directories.add(directory.path)
            }
            if (!staging.renameTo(target)) return false
            if (retention != ResourceCacheRetention.AMBIENT) return true
            val previous =
                index.put(key.relativePath, IndexEntry(bytes, now(), key.resourceClass))
            total += bytes - (previous?.bytes ?: 0)
        }
        evictIfNeeded()
        return true
    }

    private fun root(retention: ResourceCacheRetention): File =
        if (retention == ResourceCacheRetention.AMBIENT) ambientRoot
        else File(durableRoot, "pinned")

    private fun scan(): Map<String, IndexEntry> {
        val result = HashMap<String, IndexEntry>()
        val classes = TileflowResourceClass.entries.associateBy { it.directory }
        for (scope in ambientRoot.listFiles().orEmpty()) {
            if (!scope.isDirectory || scope.name == "staging" || scope.name == "trash") continue
            for (classDirectory in scope.listFiles().orEmpty()) {
                val resourceClass = classes[classDirectory.name] ?: continue
                for (shard in classDirectory.listFiles().orEmpty()) {
                    for (file in shard.listFiles().orEmpty()) {
                        if (!file.isFile) continue
                        result["${scope.name}/${classDirectory.name}/${shard.name}/${file.name}"] =
                            IndexEntry(file.length(), file.lastModified(), resourceClass)
                    }
                }
            }
        }
        return result
    }

    private fun evictIfNeeded() {
        synchronized(lock) {
            if (total <= budget || evictionScheduled) return
            evictionScheduled = true
        }
        maintenance.execute {
            indexed.await()
            val victims =
                synchronized(lock) {
                    evictionScheduled = false
                    if (total <= budget) return@synchronized emptyList()
                    val target = budget / 10 * 9
                    val removed = ArrayList<String>()
                    for ((path, entry) in index.entries.sortedBy { it.value.lastUse }) {
                        if (total <= target) break
                        index.remove(path)
                        total -= entry.bytes
                        removed.add(path)
                    }
                    removed
                }
            for (path in victims) File(ambientRoot, path).delete()
        }
    }
}

/**
 * Streams one entry into staging. Commit verifies nothing was lost and renames it into place; any
 * failure, oversize body or concurrent clear discards it.
 */
internal class ResourceCacheWriter(
    private val store: ResourceCacheStore,
    private val key: ResourceCacheKey,
    private val retention: ResourceCacheRetention,
    private val staging: File,
    private val output: FileOutputStream,
    private val limit: Long,
    private val generation: Int,
) {
    private val digest = MessageDigest.getInstance("SHA-256")
    private var length = 0L
    private var finished = false

    /** Appends body bytes. Returns false once the entry has been abandoned. */
    @Synchronized
    fun append(bytes: ByteArray, offset: Int, count: Int): Boolean {
        if (finished) return false
        if (length + count > limit) {
            discard()
            return false
        }
        return try {
            output.write(bytes, offset, count)
            digest.update(bytes, offset, count)
            length += count
            true
        } catch (_: IOException) {
            discard()
            false
        }
    }

    /** The body's length and SHA-256 so far. */
    @get:Synchronized
    val body: Pair<Int, String>
        get() =
            length.toInt() to
                (digest.clone() as MessageDigest).digest().joinToString("") { "%02x".format(it) }

    /** Writes the trailer and publishes the entry. [metadata] must describe the appended body. */
    fun commit(metadata: ResourceCacheMetadata): Boolean {
        synchronized(this) {
            if (finished) return false
            finished = true
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            val written =
                metadata.bodyLength.toLong() == length &&
                    metadata.bodySha256 == sha &&
                    runCatching {
                            output.write(ResourceCacheEntryFormat.trailer(metadata))
                            output.close()
                        }
                        .isSuccess
            if (!written) {
                runCatching { output.close() }
                staging.delete()
                return false
            }
        }
        if (!store.commit(staging, key, retention, staging.length(), generation)) {
            staging.delete()
            return false
        }
        return true
    }

    @Synchronized
    fun abort() = discard()

    private fun discard() {
        if (finished) return
        finished = true
        runCatching { output.close() }
        staging.delete()
    }
}
