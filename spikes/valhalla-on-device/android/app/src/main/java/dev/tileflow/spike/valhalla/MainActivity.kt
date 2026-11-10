package dev.tileflow.spike.valhalla

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.TextView
import java.io.File

object Bench {
    /** How long System.loadLibrary took for the router library. */
    val loadLibraryMs: Double

    init {
        val started = System.nanoTime()
        System.loadLibrary("tf_valhalla")
        loadLibraryMs = (System.nanoTime() - started) / 1e6
    }

    @JvmStatic external fun run(plan: String): String
}

/**
 * Runs the plan named by the `plan` extra (a file in the app's files directory), writes
 * `<plan>.result.json` beside it, logs it under the TfBench tag and exits.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "Valhalla on-device measurement" })
        val name = intent.getStringExtra("plan") ?: return
        Thread {
            val plan = File(filesDir, name)
            val text = plan.readText()
            val result = Bench.run(text).replaceFirst("{", "{\"loadLibraryMs\":${Bench.loadLibraryMs},")
            File(filesDir, "$name.result.json").writeText(result)
            Log.i("TfBench", "TF_BENCH_RESULT done $name")
            finishAndRemoveTask()
            Runtime.getRuntime().exit(0)
        }.start()
    }
}
