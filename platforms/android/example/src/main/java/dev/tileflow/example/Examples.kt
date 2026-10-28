package dev.tileflow.example

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import dev.tileflow.sdk.TileflowMap
import dev.tileflow.sdk.TileflowMapEvent
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import java.net.URI
import kotlinx.coroutines.launch

internal fun Intent.mapSource(): TileflowMapSource {
    val url = URI(getStringExtra("manifest") ?: "http://127.0.0.1:18645/manifest.json")
    return TileflowMapSource(
        map = getStringExtra("map") ?: "fixture",
        manifestUrl = url,
        allowsLoopbackHttp = url.host == "127.0.0.1",
    )
}

class ViewExample : ComponentActivity() {
    private lateinit var map: TileflowMapView
    private var dark = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.map_screen)
        map = findViewById(R.id.map)
        val status = findViewById<TextView>(R.id.status)
        map.onEvent = {
            when (it) {
                TileflowMapEvent.ContentReady -> status.text = "Tileflow · Android View"
                is TileflowMapEvent.Failed -> status.text = "Map error: ${it.code}"
                is TileflowMapEvent.Tap -> status.text = "Map selected"
                else -> Unit
            }
        }
        map.setSource(intent.mapSource())
        findViewById<Button>(R.id.theme).setOnClickListener {
            dark = !dark
            lifecycleScope.launch {
                runCatching { map.setTheme(if (dark) "dark" else "light") }
                    .onFailure { status.text = "Theme unavailable" }
            }
        }
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }
}

class ComposeExample : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val source = intent.mapSource()
        setContent {
            var dark by remember { mutableStateOf(false) }
            var status by remember { mutableStateOf("Loading Tileflow…") }
            MaterialTheme {
                Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                    Button(onClick = { dark = !dark }) { Text("Change theme") }
                    Text(status, Modifier.padding(16.dp))
                    TileflowMap(
                        source,
                        Modifier.weight(1f),
                        theme = if (dark) "dark" else "light",
                    ) {
                        when (it) {
                            TileflowMapEvent.ContentReady -> status = "Tileflow · Compose"
                            is TileflowMapEvent.Failed -> status = "Map error: ${it.code}"
                            is TileflowMapEvent.Tap -> status = "Map selected"
                            else -> Unit
                        }
                    }
                }
            }
        }
    }
}
