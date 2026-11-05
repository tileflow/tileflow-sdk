package dev.tileflow.reactnative

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.TileflowMarkerViewManagerDelegate
import com.facebook.react.viewmanagers.TileflowMarkerViewManagerInterface

internal class TileflowMarkerViewManager :
    ViewGroupManager<TileflowNativeMarkerView>(),
    TileflowMarkerViewManagerInterface<TileflowNativeMarkerView> {
    private val delegate = TileflowMarkerViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<TileflowNativeMarkerView> = delegate

    override fun getName(): String = "TileflowMarkerView"

    override fun createViewInstance(context: ThemedReactContext) = TileflowNativeMarkerView(context)

    override fun setInstanceId(view: TileflowNativeMarkerView, value: String?) {
        view.instanceId = value.orEmpty()
    }

    override fun setAnnotationId(view: TileflowNativeMarkerView, value: String?) {
        view.annotationId = value.orEmpty()
    }

    override fun setOptionsJson(view: TileflowNativeMarkerView, value: String?) {
        view.optionsJson = value.orEmpty()
    }

    override fun onAfterUpdateTransaction(view: TileflowNativeMarkerView) {
        super.onAfterUpdateTransaction(view)
        view.owner?.syncMarker(view)
    }

    override fun onDropViewInstance(view: TileflowNativeMarkerView) {
        view.owner = null
        super.onDropViewInstance(view)
    }

    override fun prepareToRecycleView(
        context: ThemedReactContext,
        view: TileflowNativeMarkerView,
    ): TileflowNativeMarkerView? = null
}
