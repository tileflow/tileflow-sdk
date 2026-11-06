package dev.tileflow.measure

import android.app.Activity
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.util.Log

internal fun installContent(activity: Activity, root: FrameLayout, run: String): () -> Unit {
    val listener = object : ViewTreeObserver.OnDrawListener {
        override fun onDraw() {
            root.post {
                root.viewTreeObserver.removeOnDrawListener(this)
                Log.i(TAG, "EMPTY_DRAWN $run")
            }
        }
    }
    root.viewTreeObserver.addOnDrawListener(listener)
    return {}
}
