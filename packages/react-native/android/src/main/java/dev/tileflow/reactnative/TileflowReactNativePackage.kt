package dev.tileflow.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import dev.tileflow.reactnative.map.NativeMapRegistry

/** Native maps, offline regions and services share the application's SDK configuration. */
class TileflowReactNativePackage : BaseReactPackage() {
    private val maps = NativeMapRegistry()
    private val permissions = TileflowMapPermissions()

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        when (name) {
            TileflowServicesModule.NAME -> TileflowServicesModule(reactContext)
            TileflowOfflineModule.NAME -> TileflowOfflineModule(reactContext)
            TileflowMapModule.NAME -> TileflowMapModule(reactContext, maps, permissions)
            else -> null
        }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> =
        listOf(TileflowMapViewManager(maps, permissions), TileflowMarkerViewManager())

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        fun info(name: String, className: String, turbo: Boolean) =
            ReactModuleInfo(name, className, false, false, false, turbo)
        mapOf(
            TileflowServicesModule.NAME to
                info(TileflowServicesModule.NAME, TileflowServicesModule::class.java.name, true),
            TileflowOfflineModule.NAME to
                info(TileflowOfflineModule.NAME, TileflowOfflineModule::class.java.name, true),
            TileflowMapModule.NAME to
                info(TileflowMapModule.NAME, TileflowMapModule::class.java.name, true),
        )
    }
}
