package dev.tileflow.measure

import android.app.Activity
import android.widget.FrameLayout

internal fun installContent(activity: Activity, root: FrameLayout, run: String): () -> Unit =
    installMap(activity, root, run)
