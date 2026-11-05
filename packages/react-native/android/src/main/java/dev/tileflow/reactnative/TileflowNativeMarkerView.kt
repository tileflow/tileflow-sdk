package dev.tileflow.reactnative

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.view.ReactViewGroup

internal class TileflowNativeMarkerView(context: ThemedReactContext) : ReactViewGroup(context) {
    var instanceId = ""
    var annotationId = ""
    var optionsJson = ""
    var owner: TileflowNativeMapView? = null

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        owner?.syncMarker(this)
    }
}
