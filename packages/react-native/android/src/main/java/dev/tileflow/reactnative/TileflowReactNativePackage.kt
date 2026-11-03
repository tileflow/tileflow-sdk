package dev.tileflow.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The package's native modules: the TurboModules for offline regions and services, and the
 * modules of the MapLibre-based Map.
 */
class TileflowReactNativePackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        when (name) {
            TileflowServicesModule.NAME -> TileflowServicesModule(reactContext)
            TileflowOfflineModule.NAME -> TileflowOfflineModule(reactContext)
            "TileflowNativeAdmission" -> TileflowNativeAdmissionModule(reactContext)
            "TileflowNativeConfiguration" -> TileflowNativeConfigurationModule(reactContext)
            "TileflowNativeDocuments" -> TileflowNativeDocumentsModule(reactContext)
            "TileflowNativeSurface" -> TileflowNativeSurfaceModule(reactContext)
            else -> null
        }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        fun info(name: String, className: String, turbo: Boolean) =
            ReactModuleInfo(name, className, false, false, false, turbo)
        mapOf(
            TileflowServicesModule.NAME to
                info(TileflowServicesModule.NAME, TileflowServicesModule::class.java.name, true),
            TileflowOfflineModule.NAME to
                info(TileflowOfflineModule.NAME, TileflowOfflineModule::class.java.name, true),
            "TileflowNativeAdmission" to
                info("TileflowNativeAdmission", TileflowNativeAdmissionModule::class.java.name, false),
            "TileflowNativeConfiguration" to
                info("TileflowNativeConfiguration", TileflowNativeConfigurationModule::class.java.name, false),
            "TileflowNativeDocuments" to
                info("TileflowNativeDocuments", TileflowNativeDocumentsModule::class.java.name, false),
            "TileflowNativeSurface" to
                info("TileflowNativeSurface", TileflowNativeSurfaceModule::class.java.name, false),
        )
    }
}
