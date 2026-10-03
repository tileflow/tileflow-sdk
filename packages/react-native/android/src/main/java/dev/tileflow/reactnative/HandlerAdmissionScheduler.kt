package dev.tileflow.reactnative

import android.os.Handler
import android.os.Looper
import android.os.SystemClock

internal class HandlerAdmissionScheduler : AdmissionScheduler {
	private val handler = Handler(Looper.getMainLooper())
	override fun nowMs(): Long = SystemClock.elapsedRealtime()
	override fun dispatch(action: () -> Unit) { handler.post { action() } }
	override fun after(delayMs: Long, action: () -> Unit): AdmissionCancellation {
		val task = Runnable { action() }
		handler.postDelayed(task, delayMs)
		return AdmissionCancellation { handler.removeCallbacks(task) }
	}
}
