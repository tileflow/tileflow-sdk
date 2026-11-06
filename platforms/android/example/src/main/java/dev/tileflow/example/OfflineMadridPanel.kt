package dev.tileflow.example

import android.content.Intent
import android.text.format.Formatter
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineException
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegion.DownloadState
import dev.tileflow.sdk.offline.TileflowOfflineRegion.ExpiryState
import dev.tileflow.sdk.offline.TileflowOfflineRegionEvent
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineTileSource
import java.security.MessageDigest
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch

internal data class OfflineMadridRegion(
    val id: String,
    val options: TileflowOfflineRegionLoadOptions?,
)

internal fun Intent.offlineMadridRegion(source: TileflowMapSource): OfflineMadridRegion {
    val manifest = source.manifestUrl
    val content =
        if (source.mapId != null) {
            TileflowOfflineContent.Hosted(
                requireNotNull(source.mapId),
                getStringArrayExtra("offlineThemes")?.toList() ?: listOf("default"),
            )
        } else {
            requireNotNull(manifest)
            // This example knows the tile templates of its bundled test server. Add your own
            // templates here for another self-hosted map that uses tiles.
            val sources =
                when {
                    manifest.host != "127.0.0.1" || manifest.port != 18645 -> null
                    manifest.path == "/native/manifest.json" && source.map in listOf("city", "streets") ->
                        listOf(
                            TileflowOfflineTileSource(
                                "tileflow", "${manifest.resolve("/city/")}{z}/{x}/{y}.mvt", maxZoom = 16,
                            ),
                            TileflowOfflineTileSource(
                                "tileflow-terrain", "${manifest.resolve("/terrain/")}{z}/{x}/{y}.png",
                                maxZoom = 14,
                            ),
                        )
                    source.map == "fixture" && manifest.path in listOf("/manifest.json", "/cached/manifest.json") ->
                        emptyList()
                    else -> null
                }
            sources?.let { TileflowOfflineContent.Manifest(manifest.toString(), source.map, it) }
        }

    val identity =
        listOf(getStringExtra("apiOrigin"), source.mapId, manifest, source.map).joinToString("|")
    val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray())
    return OfflineMadridRegion(
        "madrid-" + digest.take(16).joinToString("") { "%02x".format(it) },
        content?.let {
            TileflowOfflineRegionLoadOptions(
                geometry =
                    TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.715, 40.41, -3.685, 40.43)),
                content = it,
                minZoom = 13,
                maxZoom = 15,
                terrainMaxZoom = 12,
            )
        },
    )
}

@Composable
internal fun OfflineMadridPanel(
    store: TileflowOfflineStore,
    request: OfflineMadridRegion,
    usesNetwork: Boolean,
    onDismiss: () -> Unit,
    onNetworkChanged: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var region by remember(request.id) { mutableStateOf<TileflowOfflineRegion?>(null) }
    var loaded by remember(request.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(store, request.id) {
        callbackFlow {
            val subscription = store.subscribe { event ->
                val id = when (event) {
                    is TileflowOfflineRegionEvent.Changed -> event.region.id
                    is TileflowOfflineRegionEvent.Removed -> event.id
                }
                if (id == request.id) trySend(Unit)
            }
            trySend(Unit)
            awaitClose { subscription.cancel() }
        }.conflate().collect {
            region = store.region(request.id)
            loaded = true
        }
    }

    fun act(action: suspend () -> Unit) {
        if (busy) return

        busy = true
        error = null
        scope.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: TileflowOfflineException) {
                error = "Offline error: ${failure.code}"
            } finally {
                busy = false
            }
        }
    }

    val current = region
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Offline Madrid") },
        text = {
            Column {
                val status = when {
                    !loaded -> "Reading region…"
                    current != null -> current.state.label
                    busy -> "Preparing region…"
                    request.options != null -> "Ready to download"
                    else -> "This map needs offline tile templates"
                }
                Text(status)
                if (current != null) {
                    val total = current.requiredResourceCount
                    if (total > 0) {
                        LinearProgressIndicator(progress = {
                            (current.completedResourceCount.toFloat() / total).coerceIn(0f, 1f)
                        })
                        Text("${current.completedResourceCount} / $total resources")
                    }
                    Text(Formatter.formatShortFileSize(context, current.completedResourceBytes) + " downloaded")
                    Text(current.expiryLabel())
                    current.error?.let { Text("Offline error: ${it.code}") }
                }
                error?.let { Text(it) }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    val networkLabel = "Tileflow network"
                    Text(networkLabel, Modifier.padding(end = 12.dp))
                    Switch(
                        checked = usesNetwork,
                        onCheckedChange = onNetworkChanged,
                        modifier = Modifier.semantics { contentDescription = networkLabel },
                        enabled = !busy,
                    )
                }

                Row {
                    when (current?.state) {
                        null ->
                            TextButton(
                                enabled = loaded && !busy && usesNetwork && request.options != null,
                                onClick = {
                                    request.options?.let { options ->
                                        act { store.loadRegion(request.id, options) }
                                    }
                                },
                            ) { Text("Download") }
                        DownloadState.DOWNLOADING, DownloadState.WAITING ->
                            TextButton(enabled = !busy, onClick = { act { store.pauseRegion(request.id) } }) {
                                Text("Pause")
                            }
                        DownloadState.PAUSED, DownloadState.FAILED ->
                            TextButton(enabled = !busy, onClick = { act { store.resumeRegion(request.id) } }) {
                                Text("Resume")
                            }
                        DownloadState.COMPLETE -> Unit
                    }
                    if (current != null) {
                        TextButton(enabled = !busy, onClick = { act { store.removeRegion(request.id) } }) {
                            Text("Delete")
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Close") } },
    )
}

private val DownloadState.label: String
    get() = when (this) {
        DownloadState.DOWNLOADING -> "Downloading"
        DownloadState.WAITING -> "Waiting"
        DownloadState.PAUSED -> "Paused"
        DownloadState.FAILED -> "Failed"
        DownloadState.COMPLETE -> "Downloaded"
    }

private fun TileflowOfflineRegion.expiryLabel(): String {
    val date = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
    return when (val expiry = expiryState) {
        ExpiryState.Expired -> "Expired"
        is ExpiryState.GracePeriod -> "Grace period ends ${date.format(Date(expiry.endsAtMillis))}"
        ExpiryState.Valid -> expiresAtMillis?.let { "Expires ${date.format(Date(it))}" } ?: "Available offline"
        null -> if (options.content is TileflowOfflineContent.Hosted) "Expiry pending" else "No expiry"
    }
}
