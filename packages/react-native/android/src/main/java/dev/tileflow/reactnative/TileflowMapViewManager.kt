package dev.tileflow.reactnative

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.TileflowMapViewManagerDelegate
import com.facebook.react.viewmanagers.TileflowMapViewManagerInterface
import dev.tileflow.reactnative.map.NativeMapRegistry
import dev.tileflow.reactnative.map.NativeMapSession

internal class TileflowMapViewManager(
    private val registry: NativeMapRegistry,
    private val permissions: TileflowMapPermissions,
) :
    ViewGroupManager<TileflowNativeMapView>(),
    TileflowMapViewManagerInterface<TileflowNativeMapView> {
    private val delegate = TileflowMapViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<TileflowNativeMapView> = delegate

    override fun getName(): String = "TileflowMapView"

    override fun createViewInstance(context: ThemedReactContext) =
        TileflowNativeMapView(context, registry) { map, emit ->
            NativeMapSession(
                map,
                { TileflowMapMedia.load(context, it) },
                { permissions.request(context) },
                emit,
            )
        }

    override fun setInstanceId(view: TileflowNativeMapView, value: String?) {
        view.instanceId = value.orEmpty()
    }

    override fun setSourceJson(view: TileflowNativeMapView, value: String?) {
        view.sourceJson = value.orEmpty()
    }

    override fun setAppearanceJson(view: TileflowNativeMapView, value: String?) {
        view.appearanceJson = value ?: "{}"
    }

    override fun setOptionsJson(view: TileflowNativeMapView, value: String?) {
        view.optionsJson = value ?: "{}"
    }

    override fun onAfterUpdateTransaction(view: TileflowNativeMapView) {
        super.onAfterUpdateTransaction(view)
        view.commitProperties()
    }

    override fun addView(parent: TileflowNativeMapView, child: View, index: Int) =
        parent.addReactChild(child, index)

    override fun getChildCount(parent: TileflowNativeMapView): Int = parent.reactChildCount()

    override fun getChildAt(parent: TileflowNativeMapView, index: Int): View =
        parent.reactChild(index)

    override fun removeViewAt(parent: TileflowNativeMapView, index: Int) =
        parent.removeReactChild(index)

    override fun onDropViewInstance(view: TileflowNativeMapView) {
        view.dispose()
        super.onDropViewInstance(view)
    }

    override fun prepareToRecycleView(
        context: ThemedReactContext,
        view: TileflowNativeMapView,
    ): TileflowNativeMapView? = null

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
        mapOf("topMapEvent" to mapOf("registrationName" to "onMapEvent"))
}
