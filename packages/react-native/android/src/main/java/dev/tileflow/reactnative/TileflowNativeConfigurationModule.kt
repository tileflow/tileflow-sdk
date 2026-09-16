package dev.tileflow.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class TileflowNativeConfigurationModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
	private var invalidated = false

	override fun getName() = "TileflowNativeConfiguration"

	@ReactMethod fun readConfiguration(promise: Promise) {
		synchronized(this) {
			if (invalidated) {
				promise.reject("NATIVE_CONFIGURATION_UNAVAILABLE", "Native application configuration is unavailable.")
				return
			}
			val configuration = try {
				applicationConfiguration.read { readMobileConfigurationResources(reactApplicationContext) }
			} catch (_: Exception) {
				promise.reject("NATIVE_CONFIGURATION_INVALID", "Native application configuration is invalid.")
				return
			}
			// No constants, events or public state. This bounded response belongs to the private bridge.
			promise.resolve(Arguments.makeNativeMap(mapOf(
				"apiOrigin" to configuration.apiOrigin,
				"credential" to configuration.credential
			)))
		}
	}

	override fun invalidate() {
		synchronized(this) { invalidated = true }
		super.invalidate()
	}

	companion object {
		// The cache retains immutable application data, never a React context or Map lifetime.
		private val applicationConfiguration = MobileConfigurationCache()
	}
}
