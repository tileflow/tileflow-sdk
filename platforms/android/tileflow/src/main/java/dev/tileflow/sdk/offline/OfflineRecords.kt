package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where the offline store keeps its records, beside the resource cache's durable root:
 * ```
 * regions/<sha256(id)>/region.json        the region record, replaced atomically
 * regions/<sha256(id)>/v<n>/request-<i>.json, pack-<i>.json
 *                                         a Hosted version's requests and created packs
 * regions/<sha256(id)>/v<n>/plan.json     a self-hosted version's resolved plan
 * regions/<sha256(id)>/v<n>/progress      `<digest> <bytes>` of each stored resource, appended
 * regions/<sha256(id)>/v<n>/staging/<digest>
 *                                         changed bodies of resources the stored version uses,
 *                                         committed when the update completes
 * ```
 *
 * Resource bodies live in the resource cache's pinned partition under the transport's own keys. A
 * record lists its versions; every other file belongs to one of them, so a record that is replaced
 * atomically never refers to a half-written version.
 */
internal class OfflineLayout(val root: File) {
    val regions = File(root, "regions")

    fun region(id: String) = File(regions, sha256Hex(id.toByteArray()))

    fun record(id: String) = File(region(id), "region.json")

    fun version(id: String, number: Int) = File(region(id), "v$number")

    fun request(id: String, number: Int, pack: Int) =
        File(version(id, number), "request-$pack.json")

    fun pack(id: String, number: Int, pack: Int) = File(version(id, number), "pack-$pack.json")

    fun plan(id: String, number: Int) = File(version(id, number), "plan.json")

    fun progress(id: String, number: Int) = File(version(id, number), "progress")

    fun staging(id: String, number: Int) = File(version(id, number), "staging")

    companion object {
        /** Writes a whole file through a temporary file and a rename, so readers see either. */
        fun write(data: ByteArray, file: File) {
            file.parentFile?.mkdirs()
            val temporary = File(file.parentFile, ".${file.name}.${UUID.randomUUID()}")
            try {
                FileOutputStream(temporary).use {
                    it.write(data)
                    it.fd.sync()
                }
                if (!temporary.renameTo(file)) throw java.io.IOException("rename failed")
            } finally {
                temporary.delete()
            }
        }
    }
}

/**
 * A version's stored resources, one `<digest> <bytes>` line each, appended as resources complete.
 * A line cut short by a crash is ignored; its resource is requested again with `If-None-Match`.
 */
internal class OfflineProgressLog(private val file: File) {
    private var stream: FileOutputStream? = null

    @Synchronized
    fun append(entries: List<Pair<String, Long>>) {
        if (entries.isEmpty()) return
        val output =
            stream
                ?: FileOutputStream(file.apply { parentFile?.mkdirs() }, true).also { stream = it }
        // A line cut short by a crash is completed by the newline that starts the next batch.
        output.write(
            ("\n" + entries.joinToString("\n") { "${it.first} ${it.second}" } + "\n").toByteArray()
        )
        output.fd.sync()
    }

    @Synchronized
    fun close() {
        runCatching { stream?.close() }
        stream = null
    }

    companion object {
        /** Stored bytes by digest. */
        fun read(file: File): Map<String, Long> {
            val text = runCatching { file.readText() }.getOrNull() ?: return emptyMap()
            val stored = HashMap<String, Long>()
            for (line in text.split('\n')) {
                val parts = line.split(' ')
                val bytes = parts.getOrNull(1)?.toLongOrNull()
                if (parts.size == 2 && parts[0].length == 64 && bytes != null && bytes >= 0)
                    stored[parts[0]] = bytes
            }
            return stored
        }

        fun write(stored: Map<String, Long>, file: File) =
            OfflineLayout.write(
                stored.entries.joinToString("") { "${it.key} ${it.value}\n" }.toByteArray(),
                file,
            )
    }
}

/** A stored error, with what the public error carries. */
internal data class OfflineStoredError(
    val code: String,
    val reason: String? = null,
    val status: Int? = null,
    val limit: Int? = null,
    val retryAfterMillis: Long? = null,
) {
    val exception: TileflowOfflineException
        get() =
            TileflowOfflineException(
                runCatching { TileflowOfflineErrorCode.valueOf(code) }
                    .getOrDefault(TileflowOfflineErrorCode.INVALID_RESPONSE),
                TileflowErrorContext(reason = reason, status = status, limit = limit),
                retryAfterMillis,
            )

    fun toJson(): JSONObject =
        JSONObject()
            .put("code", code)
            .putOpt("reason", reason)
            .putOpt("status", status)
            .putOpt("limit", limit)
            .putOpt("retryAfterMillis", retryAfterMillis)

    companion object {
        fun of(error: TileflowOfflineException) =
            OfflineStoredError(
                error.code.name,
                error.context.reason,
                error.context.status,
                error.context.limit,
                error.retryAfterMillis,
            )

        fun fromJson(value: JSONObject) =
            OfflineStoredError(
                value.getString("code"),
                value.optString("reason").takeIf { value.has("reason") },
                if (value.has("status")) value.getInt("status") else null,
                if (value.has("limit")) value.getInt("limit") else null,
                if (value.has("retryAfterMillis")) value.getLong("retryAfterMillis") else null,
            )
    }
}

/** One downloaded or downloading version of a region. Times are milliseconds since 1970. */
internal data class OfflineVersionRecord(
    val number: Int,
    val options: JSONObject,
    /** The API origin whose grant scope holds the version's protected resources. */
    val apiOrigin: String?,
    /** Hosted packs, as `request-<i>.json` and `pack-<i>.json`; zero for self-hosted content. */
    val packs: Int,
    val resources: Long,
    val billable: Long,
    val bytes: Long?,
    val state: State,
    val error: OfflineStoredError? = null,
    val retryAt: Long? = null,
    val createdAt: Long,
    val completedAt: Long? = null,
) {
    enum class State {
        DOWNLOADING,
        WAITING,
        PAUSED,
        FAILED,
        COMPLETE,
    }

    fun failed(error: TileflowOfflineException) =
        copy(state = State.FAILED, error = OfflineStoredError.of(error), retryAt = null)

    fun toJson(): JSONObject =
        JSONObject()
            .put("number", number)
            .put("options", options)
            .putOpt("apiOrigin", apiOrigin)
            .put("packs", packs)
            .put("resources", resources)
            .put("billable", billable)
            .putOpt("bytes", bytes)
            .put("state", state.name.lowercase())
            .putOpt("error", error?.toJson())
            .putOpt("retryAt", retryAt)
            .put("createdAt", createdAt)
            .putOpt("completedAt", completedAt)

    companion object {
        fun fromJson(value: JSONObject) =
            OfflineVersionRecord(
                value.getInt("number"),
                value.getJSONObject("options"),
                value.optString("apiOrigin").takeIf { value.has("apiOrigin") },
                value.getInt("packs"),
                value.getLong("resources"),
                value.getLong("billable"),
                if (value.has("bytes")) value.getLong("bytes") else null,
                State.valueOf(value.getString("state").uppercase()),
                value.optJSONObject("error")?.let(OfflineStoredError::fromJson),
                if (value.has("retryAt")) value.getLong("retryAt") else null,
                value.getLong("createdAt"),
                if (value.has("completedAt")) value.getLong("completedAt") else null,
            )
    }
}

/**
 * What the last revalidation of a region found: `current`, `update_available` or `not_updatable`.
 */
internal data class OfflineCheckRecord(
    val state: String,
    val reason: String?,
    val checkedAt: Long,
    val intervalMillis: Long,
)

/**
 * A region's record. [active] is the version the region serves, [pending] the one downloading and
 * [retired] a replaced version whose resources are still being released. [removing] marks a
 * removal in progress, which opening the store finishes.
 */
internal data class OfflineRegionRecord(
    val id: String,
    val createdAt: Long,
    val active: OfflineVersionRecord? = null,
    val pending: OfflineVersionRecord? = null,
    val retired: OfflineVersionRecord? = null,
    val removing: Boolean = false,
    val check: OfflineCheckRecord? = null,
) {
    val versions: List<OfflineVersionRecord>
        get() = listOfNotNull(active, pending, retired)

    val nextVersion: Int
        get() = (versions.maxOfOrNull { it.number } ?: 0) + 1

    fun write(file: File) {
        val value =
            JSONObject()
                .put("format", 1)
                .put("id", id)
                .put("createdAt", createdAt)
                .putOpt("active", active?.toJson())
                .putOpt("pending", pending?.toJson())
                .putOpt("retired", retired?.toJson())
                .put("removing", removing)
                .putOpt(
                    "check",
                    check?.let {
                        JSONObject()
                            .put("state", it.state)
                            .putOpt("reason", it.reason)
                            .put("checkedAt", it.checkedAt)
                            .put("interval", it.intervalMillis / 1000.0)
                    },
                )
        OfflineLayout.write(value.toString().toByteArray(), file)
    }

    companion object {
        fun read(file: File): OfflineRegionRecord? =
            runCatching {
                    val value = JSONObject(file.readText())
                    require(value.getInt("format") == 1)
                    OfflineRegionRecord(
                        value.getString("id"),
                        value.getLong("createdAt"),
                        value.optJSONObject("active")?.let(OfflineVersionRecord::fromJson),
                        value.optJSONObject("pending")?.let(OfflineVersionRecord::fromJson),
                        value.optJSONObject("retired")?.let(OfflineVersionRecord::fromJson),
                        value.optBoolean("removing"),
                        value.optJSONObject("check")?.let {
                            OfflineCheckRecord(
                                it.getString("state"),
                                it.optString("reason").takeIf { _ -> it.has("reason") },
                                it.getLong("checkedAt"),
                                (it.getDouble("interval") * 1000).toLong(),
                            )
                        },
                    )
                }
                .getOrNull()
    }
}

// Options coding.

internal fun TileflowOfflineRegionLoadOptions.toJson(): JSONObject {
    fun positions(list: List<TileflowPosition>) =
        JSONArray(list.map { JSONArray().put(it.longitude).put(it.latitude) })
    val geometry =
        when (val value = geometry) {
            is TileflowOfflineGeometry.BoundingBox ->
                JSONObject()
                    .put("type", "bbox")
                    .put(
                        "bbox",
                        JSONArray()
                            .put(value.box.west)
                            .put(value.box.south)
                            .put(value.box.east)
                            .put(value.box.north),
                    )
            is TileflowOfflineGeometry.Polygon ->
                JSONObject().put("type", "polygon").put("coordinates", positions(value.ring))
            is TileflowOfflineGeometry.Corridor ->
                JSONObject()
                    .put("type", "corridor")
                    .put("line", positions(value.line))
                    .put("width", value.width)
        }
    val content =
        when (val value = content) {
            is TileflowOfflineContent.Hosted ->
                JSONObject()
                    .put("type", "hosted")
                    .put("mapId", value.mapId)
                    .put("themes", JSONArray(value.themes))
            is TileflowOfflineContent.Manifest ->
                JSONObject()
                    .put("type", "manifest")
                    .put("url", value.url)
                    .put("map", value.map)
                    .put(
                        "sources",
                        JSONArray(
                            value.sources.map {
                                JSONObject()
                                    .put("id", it.id)
                                    .put("template", it.template)
                                    .put("minZoom", it.minZoom)
                                    .put("maxZoom", it.maxZoom)
                            }
                        ),
                    )
        }
    return JSONObject()
        .put("geometry", geometry)
        .put("content", content)
        .put("minZoom", minZoom)
        .put("maxZoom", maxZoom)
        .put("terrainMaxZoom", terrainMaxZoom)
        .put("networkRestriction", networkRestriction.name.lowercase())
        .put("metadata", JSONObject(metadata))
}

internal fun offlineOptions(value: JSONObject): TileflowOfflineRegionLoadOptions? =
    runCatching {
            fun positions(array: JSONArray) =
                List(array.length()) {
                    val pair = array.getJSONArray(it)
                    TileflowPosition(pair.getDouble(0), pair.getDouble(1))
                }
            val shape = value.getJSONObject("geometry")
            val geometry =
                when (shape.getString("type")) {
                    "bbox" -> {
                        val box = shape.getJSONArray("bbox")
                        TileflowOfflineGeometry.BoundingBox(
                            TileflowBoundingBox(
                                box.getDouble(0),
                                box.getDouble(1),
                                box.getDouble(2),
                                box.getDouble(3),
                            )
                        )
                    }
                    "polygon" ->
                        TileflowOfflineGeometry.Polygon(
                            positions(shape.getJSONArray("coordinates"))
                        )
                    else ->
                        TileflowOfflineGeometry.Corridor(
                            positions(shape.getJSONArray("line")),
                            shape.getDouble("width"),
                        )
                }
            val item = value.getJSONObject("content")
            val content =
                when (item.getString("type")) {
                    "hosted" -> {
                        val themes = item.getJSONArray("themes")
                        TileflowOfflineContent.Hosted(
                            item.getString("mapId"),
                            List(themes.length()) { themes.getString(it) },
                        )
                    }
                    else -> {
                        val sources = item.getJSONArray("sources")
                        TileflowOfflineContent.Manifest(
                            item.getString("url"),
                            item.getString("map"),
                            List(sources.length()) {
                                val source = sources.getJSONObject(it)
                                TileflowOfflineTileSource(
                                    source.getString("id"),
                                    source.getString("template"),
                                    source.getInt("minZoom"),
                                    source.getInt("maxZoom"),
                                )
                            },
                        )
                    }
                }
            val metadata = value.getJSONObject("metadata")
            TileflowOfflineRegionLoadOptions(
                geometry,
                content,
                value.getInt("minZoom"),
                value.getInt("maxZoom"),
                value.getInt("terrainMaxZoom"),
                TileflowOfflineNetworkRestriction.valueOf(
                    value.getString("networkRestriction").uppercase()
                ),
                metadata.keys().asSequence().associateWith { metadata.getString(it) },
            )
        }
        .getOrNull()
