package dev.tileflow.sdk.boundaries

import dev.tileflow.sdk.JoinBoundaryRowsOptions
import dev.tileflow.sdk.TileflowBoundaryClass
import dev.tileflow.sdk.TileflowBoundaryJoinResult
import dev.tileflow.sdk.TileflowBoundaryLookup
import dev.tileflow.sdk.TileflowBoundaryRow
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.isSafeBoundaryInteger
import dev.tileflow.sdk.joinBoundaryRows
import dev.tileflow.sdk.key
import dev.tileflow.sdk.model.MapContract.ErrorReason
import dev.tileflow.sdk.normalize
import dev.tileflow.sdk.parseBoundaryLookupCsv
import dev.tileflow.sdk.transport.MapResourceAddress
import dev.tileflow.sdk.transport.NetworkUnavailableException
import dev.tileflow.sdk.transport.ResourceDigest
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourceTooLargeException
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.util.zip.GZIPInputStream
import org.json.JSONException
import org.json.JSONObject

private val sha256 = Regex("[0-9a-f]{64}")

/** A release's lookup addresses, captured from the same TileJSON the map draws. */
internal data class BoundaryLookupDescriptor(
    val sourceUrl: String,
    val releaseId: String,
    val manifestSha256: String?,
    val manifestUrl: URI?,
    val urls: Map<TileflowBoundaryClass, URI>,
) {
    companion object {
        fun fromTileJson(tileJson: JSONObject, address: String): BoundaryLookupDescriptor? {
            val metadata = tileJson.optJSONObject("tileflow")?.optJSONObject("boundaries")
            val releaseId = (metadata?.opt("releaseId") as? String)?.takeIf { it.isNotEmpty() }
                ?: return null
            val manifestSha256 = metadata.opt("manifestSha256") as? String
            if (metadata.has("manifestSha256") && manifestSha256?.matches(sha256) != true) return null
            val lookup = metadata.optJSONObject("lookup") ?: return null
            val classes = lookup.optJSONObject("classes") ?: return null
            val manifestUrl = if (lookup.has("manifest")) {
                resolve(address, lookup.opt("manifest")) ?: return null
            } else null
            val urls = buildMap {
                for (boundaryClass in TileflowBoundaryClass.entries) {
                    val url = resolve(address, classes.opt(boundaryClass.wireName)) ?: continue
                    put(boundaryClass, url)
                }
            }
            if (urls.isEmpty()) return null
            return BoundaryLookupDescriptor(address, releaseId, manifestSha256, manifestUrl, urls)
        }

        private fun resolve(address: String, reference: Any?): URI? {
            if (reference !is String || reference.isEmpty()) return null
            val url = runCatching { URI(MapResourceAddress.resolve(address, reference)) }
                .getOrNull() ?: return null
            return url.takeIf {
                (it.scheme == "https" || it.scheme == "http") && !it.host.isNullOrEmpty() &&
                    it.userInfo == null && it.rawFragment == null
            }
        }
    }
}

internal val JoinBoundaryRowsOptions.needsMapLookup: Boolean
    get() = joinBy != to.code && lookup == null && classes?.isEmpty() != true

/** Loads only requested lookup classes through the map's existing authorized HTTP transport. */
internal object NativeBoundaryLookup {
    private const val MAXIMUM_COMPRESSED_BYTES = 16 * 1024 * 1024
    private const val MAXIMUM_CSV_BYTES = 64 * 1024 * 1024

    private data class Archive(val rows: Long, val bytes: Int, val sha256: String)

    fun join(
        rows: List<TileflowBoundaryRow>,
        options: JoinBoundaryRowsOptions,
        descriptor: BoundaryLookupDescriptor?,
        loader: ResourceLoader,
    ): TileflowBoundaryJoinResult {
        requireOnline(loader)

        if (options.joinBy == options.to.code || options.lookup != null)
            return joinBoundaryRows(rows, options)
        if (options.classes?.isEmpty() == true)
            return joinBoundaryRows(rows, options.copy(lookup = TileflowBoundaryLookup(emptyList())))

        if (descriptor == null) throw unavailable()
        val urls = descriptor.urls
        val classes = TileflowBoundaryClass.entries.filter { it in (options.classes ?: urls.keys) }
        if (classes.isEmpty() || !urls.keys.containsAll(classes)) throw unavailable()

        val keys = rows.mapNotNullTo(HashSet()) { options.joinBy.normalize(it.key) }
        if (keys.isEmpty())
            return joinBoundaryRows(rows, options.copy(lookup = TileflowBoundaryLookup(emptyList())))

        val files = descriptor.manifestUrl?.let { url ->
            manifestFiles(read(loader, url), descriptor.releaseId)
        }
        val lookupRows = classes.flatMap { boundaryClass ->
            val url = urls.getValue(boundaryClass)
            val archive = files?.let { archive(it, boundaryClass, url) }
            val bytes = read(loader, url)
            if (archive != null &&
                (bytes.size != archive.bytes || ResourceDigest.sha256(bytes) != archive.sha256)
            ) throw invalid()

            var rowCount = 0L
            val parsed = try {
                parseBoundaryLookupCsv(decode(bytes)) { row ->
                    require(row.boundaryClass == boundaryClass && row.id >= 0)
                    rowCount++
                    val key = row.key(options.joinBy)?.let(options.joinBy::normalize)
                    key != null && key in keys
                }
            } catch (_: IllegalArgumentException) {
                throw invalid()
            } catch (_: IOException) {
                throw invalid()
            }
            if (archive != null && rowCount != archive.rows) throw invalid()
            parsed
        }
        val lookup = TileflowBoundaryLookup(lookupRows)
        requireOnline(loader)
        return joinBoundaryRows(rows, options.copy(lookup = lookup))
    }

    private fun read(loader: ResourceLoader, url: URI): ByteArray {
        val response = try {
            loader.loadOnline(url)
        } catch (_: NetworkUnavailableException) {
            throw offline()
        } catch (error: ResourceTooLargeException) {
            throw tooLarge(error.limitBytes.toInt())
        } catch (error: TileflowMapException) {
            if (error.code == TileflowErrorCode.ACCESS_DENIED) throw unavailable(403)
            requireOnline(loader)
            throw error
        } catch (_: IOException) {
            requireOnline(loader)
            throw unavailable()
        } catch (_: IllegalArgumentException) {
            throw unavailable()
        }
        requireOnline(loader)
        if (response.status != 200) throw unavailable(response.status)
        if (response.bytes.size > MAXIMUM_COMPRESSED_BYTES) throw tooLarge(MAXIMUM_COMPRESSED_BYTES)
        return response.bytes
    }

    private fun manifestFiles(bytes: ByteArray, releaseId: String): JSONObject {
        val manifest = try {
            JSONObject(utf8(bytes))
        } catch (_: JSONException) {
            throw invalid()
        } catch (_: IOException) {
            throw invalid()
        }
        if ((manifest.opt("schemaVersion") as? Number)?.toDouble() != 2.0 ||
            manifest.opt("family") != "boundaries" || manifest.opt("build") != releaseId
        ) throw invalid()
        return manifest.optJSONObject("files") ?: throw invalid()
    }

    private fun archive(files: JSONObject, boundaryClass: TileflowBoundaryClass, url: URI): Archive {
        val entry = files.optJSONObject(boundaryClass.wireName) ?: throw invalid()
        val digest = entry.opt("sha256") as? String ?: throw invalid()
        val rows = (entry.opt("rows") as? Number)?.toDouble() ?: throw invalid()
        val bytes = (entry.opt("bytes") as? Number)?.toDouble() ?: throw invalid()
        if (entry.opt("file") != url.path.substringAfterLast('/') || !digest.matches(sha256) ||
            !rows.isSafeBoundaryInteger() || rows < 0 || !bytes.isSafeBoundaryInteger() || bytes <= 0
        ) throw invalid()
        if (bytes > MAXIMUM_COMPRESSED_BYTES) throw tooLarge(MAXIMUM_COMPRESSED_BYTES)
        return Archive(rows.toLong(), bytes.toInt(), digest)
    }

    private fun decode(bytes: ByteArray): String {
        val gzip = bytes.size >= 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()
        val csv = if (gzip) {
            GZIPInputStream(bytes.inputStream()).use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count > MAXIMUM_CSV_BYTES - output.size()) throw tooLarge()
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        } else bytes
        if (csv.size > MAXIMUM_CSV_BYTES) throw tooLarge()
        return utf8(csv)
    }

    private fun utf8(bytes: ByteArray): String =
        Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()

    private fun requireOnline(loader: ResourceLoader) {
        try {
            loader.requireOnline()
        } catch (_: NetworkUnavailableException) {
            throw offline()
        }
    }

    private fun offline() = TileflowMapException(
        TileflowErrorCode.RESOURCE_FAILED,
        TileflowErrorContext(
            reason = ErrorReason.BOUNDARY_LOOKUP_OFFLINE.wireName,
            resource = TileflowResourceKind.DATA,
            message = "Boundary row joins on a map require an online connection.",
        ),
    )

    private fun unavailable(status: Int? = null) =
        TileflowMapException(
            TileflowErrorCode.RESOURCE_FAILED,
            TileflowErrorContext(
                reason = ErrorReason.BOUNDARY_LOOKUP_UNAVAILABLE.wireName,
                resource = TileflowResourceKind.DATA,
                status = status,
                message = "The map's Boundaries lookup could not be loaded.",
            ),
        )

    private fun tooLarge(limit: Int = MAXIMUM_CSV_BYTES) = TileflowMapException(
        TileflowErrorCode.RESOURCE_FAILED,
        TileflowErrorContext(
            reason = ErrorReason.DATA_TOO_LARGE.wireName,
            resource = TileflowResourceKind.DATA,
            limit = limit,
        ),
    )

    private fun invalid() = TileflowMapException(
        TileflowErrorCode.RESOURCE_FAILED,
        TileflowErrorContext(
            reason = ErrorReason.BOUNDARY_LOOKUP_INVALID.wireName,
            resource = TileflowResourceKind.DATA,
            message = "The map's Boundaries lookup is invalid.",
        ),
    )
}
