package dev.tileflow.sdk

import android.app.ActivityManager
import android.content.Context
import android.os.Build

/** A coarse class of the device's graphics hardware. */
public enum class TileflowGpuClass {
    /** A low-RAM device or one with less than 3 GB of memory. */
    LOW,
    STANDARD,

    /** A device declaring media performance class 13 or later, or with 8 GB of memory or more. */
    HIGH,
}

/**
 * What the SDK assumes about the device when an application does not say otherwise: the rendering
 * quality new maps use, which caps their pixel ratio, and the size of the shared resource cache.
 *
 * [current] starts as [detect]. Assign [override] before creating maps to change any value; maps
 * created afterwards and the cache budget follow it. An explicit [TileflowMapOptions.quality] still
 * wins for its map.
 *
 * @property isLowRamDevice `ActivityManager.isLowRamDevice()`, or less than 3 GB of memory.
 * @property quality The default rendering quality of new maps.
 * @property cacheBytes The bytes the shared resource cache may keep on disk.
 */
public data class TileflowDeviceProfile(
    val physicalMemory: Long,
    val isLowRamDevice: Boolean,
    val gpuClass: TileflowGpuClass,
    val quality: TileflowQuality,
    val cacheBytes: Long,
) {
    public companion object {
        @Volatile private var chosen: TileflowDeviceProfile? = null

        /** The profile the SDK recommends for this device's memory and graphics hardware. */
        @JvmStatic
        public fun detect(context: Context): TileflowDeviceProfile {
            val manager = context.getSystemService(ActivityManager::class.java)
            val memory = ActivityManager.MemoryInfo().also { manager?.getMemoryInfo(it) }
            val performanceClass =
                if (Build.VERSION.SDK_INT >= 31) Build.VERSION.MEDIA_PERFORMANCE_CLASS else 0
            return recommended(
                memory.totalMem,
                manager?.isLowRamDevice == true,
                performanceClass,
            )
        }

        /** The profile new maps and the resource cache use. Starts as [detect]. */
        @JvmStatic
        public fun current(context: Context): TileflowDeviceProfile =
            chosen
                ?: synchronized(this) {
                    chosen ?: detect(context.applicationContext ?: context).also { chosen = it }
                }

        /**
         * Replaces the profile for maps created afterwards and the cache budget. Pass null to
         * return to the detected profile.
         */
        @JvmStatic
        public fun override(context: Context, profile: TileflowDeviceProfile?) {
            val next = profile ?: detect(context.applicationContext ?: context)
            synchronized(this) { chosen = next }
            TileflowMapCache.existing()?.maximumBytes = next.cacheBytes
        }

        /** The chosen or detected profile, if a map, the cache or an override has read it. */
        internal fun known(): TileflowDeviceProfile? = chosen

        internal fun recommended(
            physicalMemory: Long,
            lowRam: Boolean,
            mediaPerformanceClass: Int,
        ): TileflowDeviceProfile {
            val gigabyte = 1L shl 30
            val low = lowRam || physicalMemory in 1 until 3 * gigabyte
            val gpu =
                when {
                    low -> TileflowGpuClass.LOW
                    mediaPerformanceClass >= 33 || physicalMemory >= 8 * gigabyte ->
                        TileflowGpuClass.HIGH
                    else -> TileflowGpuClass.STANDARD
                }
            val quality =
                when {
                    gpu == TileflowGpuClass.LOW -> TileflowQuality.LOW
                    gpu == TileflowGpuClass.HIGH && physicalMemory >= 8 * gigabyte ->
                        TileflowQuality.HIGH
                    else -> TileflowQuality.BALANCED
                }
            val cacheBytes =
                when {
                    low -> 64L shl 20
                    physicalMemory >= 6 * gigabyte -> 512L shl 20
                    else -> 256L shl 20
                }
            return TileflowDeviceProfile(physicalMemory, low, gpu, quality, cacheBytes)
        }
    }
}
