package dev.tileflow.reactnative

import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.PermissionAwareActivity
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.location.TileflowLocationAccuracy
import dev.tileflow.sdk.location.TileflowLocationPermissions
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject

/** Only the explicit command requests permission; mounting a map never does. */
internal class TileflowMapPermissions {
    private var pending: CompletableDeferred<JSONObject>? = null

    suspend fun request(context: ReactContext): JSONObject {
        pending?.let {
            return it.await()
        }
        if (TileflowLocationPermissions.authorization(context).allowsLocation) return state(context)
        val activity =
            context.currentActivity as? PermissionAwareActivity
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result = CompletableDeferred<JSONObject>()
        pending = result
        try {
            activity.requestPermissions(
                TileflowLocationPermissions.permissions(TileflowLocationAccuracy.FULL),
                REQUEST_CODE,
            ) { requestCode, _, _ ->
                if (requestCode != REQUEST_CODE) false
                else {
                    if (pending === result) pending = null
                    result.complete(state(context))
                    true
                }
            }
        } catch (error: Throwable) {
            if (pending === result) pending = null
            result.completeExceptionally(TileflowMapException(TileflowErrorCode.NOT_READY))
        }
        return result.await()
    }

    fun cancel() {
        pending?.cancel()
        pending = null
    }

    private fun state(context: ReactContext): JSONObject =
        JSONObject()
            .put("authorization", camel(TileflowLocationPermissions.authorization(context).name))
            .put("accuracy", TileflowLocationPermissions.accuracy(context).name.lowercase())

    private fun camel(value: String) =
        value
            .lowercase()
            .split('_')
            .mapIndexed { index, part ->
                if (index == 0) part else part.replaceFirstChar { it.uppercase() }
            }
            .joinToString("")

    companion object {
        private const val REQUEST_CODE = 28743
    }
}
