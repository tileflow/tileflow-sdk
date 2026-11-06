package dev.tileflow.measure

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.FrameLayout

internal const val TAG = "TileflowMeasure"

class MeasurementActivity : Activity() {
    private var closeContent: () -> Unit = {}
    private lateinit var run: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        run = intent.getStringExtra("run") ?: "manual"
        Log.i(TAG, "ACTIVITY $run")
        val root = FrameLayout(this)
        setContentView(root)
        closeContent = installContent(this, root, run)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("finish", false)) finish()
    }

    override fun onDestroy() {
        closeContent()
        super.onDestroy()
        Log.i(TAG, "DESTROY $run")
    }
}
