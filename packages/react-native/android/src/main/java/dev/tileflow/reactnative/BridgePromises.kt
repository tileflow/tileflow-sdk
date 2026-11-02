package dev.tileflow.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import dev.tileflow.reactnative.bridge.BridgeFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// Converts the bridge's plain maps and lists into React Native values and settles promises.

internal fun writableMap(values: Map<String, Any?>): WritableMap =
    Arguments.createMap().also { map ->
        for ((key, value) in values) {
            when (value) {
                null -> map.putNull(key)
                is Boolean -> map.putBoolean(key, value)
                is Number -> map.putDouble(key, value.toDouble())
                is String -> map.putString(key, value)
                is Map<*, *> -> map.putMap(key, writableMap(value.stringKeys()))
                is List<*> -> map.putArray(key, writableArray(value))
                else -> map.putString(key, value.toString())
            }
        }
    }

internal fun writableArray(values: List<*>): WritableArray =
    Arguments.createArray().also { array ->
        for (value in values) {
            when (value) {
                null -> array.pushNull()
                is Boolean -> array.pushBoolean(value)
                is Number -> array.pushDouble(value.toDouble())
                is String -> array.pushString(value)
                is Map<*, *> -> array.pushMap(writableMap(value.stringKeys()))
                is List<*> -> array.pushArray(writableArray(value))
                else -> array.pushString(value.toString())
            }
        }
    }

private fun Map<*, *>.stringKeys(): Map<String, Any?> = entries.associate { (key, value) -> key.toString() to value }

internal fun Promise.fail(failure: BridgeFailure) {
    reject(failure.code, failure.message, writableMap(failure.info))
}

/** Runs [work] and settles the promise with its value, converted for JavaScript. */
internal fun CoroutineScope.settle(
    promise: Promise,
    failure: (Throwable) -> BridgeFailure,
    work: suspend () -> Any?,
) {
    launch {
        try {
            when (val value = work()) {
                null, Unit -> promise.resolve(null)
                is Map<*, *> -> promise.resolve(writableMap(value.stringKeys()))
                is List<*> -> promise.resolve(writableArray(value))
                else -> promise.resolve(value)
            }
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Throwable) {
            promise.fail(if (error is BridgeFailure) error else failure(error))
        }
    }
}
