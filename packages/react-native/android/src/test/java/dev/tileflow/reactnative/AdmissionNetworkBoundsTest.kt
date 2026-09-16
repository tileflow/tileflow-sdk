package dev.tileflow.reactnative

import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit
import okhttp3.Dispatcher
import org.junit.Assert.*
import org.junit.Test

internal class HeldAdmissionExecutor : AbstractExecutorService() {
	private val pending = ArrayDeque<Runnable>()
	private var stopped = false
	override fun execute(command: Runnable) { check(!stopped); pending.addLast(command) }
	override fun shutdown() { stopped = true }
	override fun shutdownNow(): MutableList<Runnable> {
		stopped = true
		val work = pending.toMutableList(); pending.clear(); return work
	}
	override fun isShutdown() = stopped
	override fun isTerminated() = stopped && pending.isEmpty()
	override fun awaitTermination(timeout: Long, unit: TimeUnit) = isTerminated
	fun flush() { while (pending.isNotEmpty()) pending.removeFirst().run() }
}

class AdmissionNetworkBoundsTest {
	@Test fun cancelledProtectedCallsHoldPhysicalCapacityUntilTheirTerminalCallback() {
		val executor = HeldAdmissionExecutor()
		val network = AdmissionOkHttpNetwork(Dispatcher(executor))
		var replies = 0
		val request = AdmissionHttpRequest("https://tiles.tileflow.test/world/0/0/0.pbf", emptyMap()) { true }
		val calls = (1..2048).map { network.start(request) { assertNull(it); replies++ } }
		assertEquals(0, replies)
		for (call in calls) call.cancel()
		network.start(request) { assertNull(it); replies++ }
		assertEquals(1, replies)
		// Cancelled calls never reach a socket. The held executor is a barrier,
		// not a sleep; releasing it runs the real OkHttp terminal callbacks.
		executor.flush()
		assertEquals(2049, replies)
		val last = network.start(request) { assertNull(it); replies++ }
		assertEquals(2049, replies)
		last.cancel(); executor.flush()
		assertEquals(2050, replies)
		network.close()
		network.start(request) { assertNull(it); replies++ }
		assertEquals(2051, replies)
	}
}
