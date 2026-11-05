package dev.tileflow.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import dev.tileflow.reactnative.map.MapValues
import dev.tileflow.reactnative.map.NativeMapRegistry
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@ReactModule(name = TileflowMapModule.NAME)
internal class TileflowMapModule(
    context: ReactApplicationContext,
    private val registry: NativeMapRegistry,
    private val permissions: TileflowMapPermissions,
) : NativeTileflowMapModuleSpec(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun getName(): String = NAME

    override fun call(
        reactTag: Double,
        instanceId: String,
        method: String,
        payload: String,
        promise: Promise,
    ) {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                val result =
                    withContext(Dispatchers.Main.immediate) {
                        if (
                            !reactTag.isFinite() ||
                                reactTag <= 0 ||
                                reactTag > Int.MAX_VALUE ||
                                reactTag != reactTag.toInt().toDouble() ||
                                instanceId.isBlank()
                        )
                            MapValues.invalid()
                        registry.call(reactTag.toInt(), instanceId, method, JSONObject(payload))
                    }
                promise.resolve(
                    when (result) {
                        is String -> JSONObject.quote(result)
                        is JSONObject,
                        is JSONArray,
                        is Boolean -> result.toString()
                        is Number ->
                            if (result.toDouble().isFinite()) result.toString()
                            else MapValues.invalid()
                        Unit,
                        JSONObject.NULL -> "null"
                        else -> MapValues.invalid()
                    }
                )
            } catch (error: Throwable) {
                val failure =
                    MapValues.failure(
                        if (error is CancellationException)
                            TileflowMapException(TileflowErrorCode.DISPOSED)
                        else error
                    )
                val details =
                    Arguments.createMap().apply {
                        putBoolean("recoverable", failure.optBoolean("recoverable"))
                        failure.optJSONObject("context")?.let {
                            putMap("context", jsonWritable(it))
                        }
                    }
                promise.reject(
                    failure.getString("code"),
                    failure.optString("message", "Native map request failed."),
                    details,
                )
            }
        }
    }

    override fun invalidate() {
        scope.cancel()
        UiThreadUtil.runOnUiThread {
            registry.clear()
            permissions.cancel()
        }
        super.invalidate()
    }

    private fun jsonWritable(value: JSONObject) =
        writableMap(value.keys().asSequence().associateWith { plain(value.get(it)) })

    private fun plain(value: Any?): Any? =
        when (value) {
            null,
            JSONObject.NULL -> null
            is JSONObject -> value.keys().asSequence().associateWith { plain(value.get(it)) }
            is JSONArray -> (0 until value.length()).map { plain(value.get(it)) }
            else -> value
        }

    companion object {
        const val NAME = "TileflowMapModule"
    }
}
