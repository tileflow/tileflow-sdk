package dev.tileflow.sdk.location

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.MainThread
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

/** Whether the application may use the device's location. */
public enum class TileflowLocationAuthorization {
    /**
     * The person has not been asked yet. Android does not say whether it would still show its
     * prompt, so [TileflowLocationPermissions.authorization] reports [DENIED] instead.
     */
    NOT_DETERMINED,
    /** The location permissions are not granted. */
    DENIED,
    /** Something other than the person, such as a device policy, prevents access. */
    RESTRICTED,
    /** Allowed while the application is in use. */
    WHEN_IN_USE,
    /** Allowed at any time. The SDK never asks for it; the application may. */
    ALWAYS;

    /** Whether the application may measure the location now. */
    public val allowsLocation: Boolean
        get() = this == WHEN_IN_USE || this == ALWAYS
}

/** How precisely the application may know the location. */
public enum class TileflowLocationAccuracy {
    /** The precise location: `ACCESS_FINE_LOCATION`. */
    FULL,
    /** An approximate location, within a few kilometres: `ACCESS_COARSE_LOCATION` only. */
    REDUCED,
}

/**
 * Asks for and reads the application's access to the device's location.
 *
 * The SDK never asks on its own: launch [RequestWhenInUse] in response to something the person
 * does, such as tapping a location button. The application's manifest declares
 * `ACCESS_COARSE_LOCATION`, and `ACCESS_FINE_LOCATION` for the precise location. The SDK never asks
 * for `ACCESS_BACKGROUND_LOCATION`.
 */
public object TileflowLocationPermissions {
    /** The application's current access. */
    @JvmStatic
    public fun authorization(context: Context): TileflowLocationAuthorization =
        when {
            !granted(context, Manifest.permission.ACCESS_COARSE_LOCATION) &&
                !granted(context, Manifest.permission.ACCESS_FINE_LOCATION) ->
                TileflowLocationAuthorization.DENIED
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ->
                TileflowLocationAuthorization.ALWAYS
            else -> TileflowLocationAuthorization.WHEN_IN_USE
        }

    /** Whether the application may know the precise location or an approximate one. */
    @JvmStatic
    public fun accuracy(context: Context): TileflowLocationAccuracy =
        if (granted(context, Manifest.permission.ACCESS_FINE_LOCATION))
            TileflowLocationAccuracy.FULL
        else TileflowLocationAccuracy.REDUCED

    /** The permissions to ask for: the precise location also asks for the approximate one. */
    @JvmStatic
    public fun permissions(accuracy: TileflowLocationAccuracy): Array<String> =
        when (accuracy) {
            TileflowLocationAccuracy.FULL ->
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                )
            TileflowLocationAccuracy.REDUCED -> arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION)
        }

    private fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Asks for access while the application is in use, with the accuracy it asks for, and returns
     * the person's answer. Since Android 12 the person may share an approximate location when the
     * application asks for the precise one; launching it again with
     * [TileflowLocationAccuracy.FULL] asks to upgrade. When the access is already granted it
     * answers without a prompt. Register it as any activity result:
     * ```
     * val contract = TileflowLocationPermissions.RequestWhenInUse()
     * val request = registerForActivityResult(contract) { authorization -> … }
     * request.launch(TileflowLocationAccuracy.FULL)
     * ```
     */
    public class RequestWhenInUse :
        ActivityResultContract<TileflowLocationAccuracy, TileflowLocationAuthorization>() {
        private val permissions = ActivityResultContracts.RequestMultiplePermissions()

        override fun createIntent(context: Context, input: TileflowLocationAccuracy): Intent =
            permissions.createIntent(context, permissions(input))

        override fun getSynchronousResult(
            context: Context,
            input: TileflowLocationAccuracy,
        ): SynchronousResult<TileflowLocationAuthorization>? {
            val current = authorization(context)
            val enough =
                input == TileflowLocationAccuracy.REDUCED ||
                    accuracy(context) == TileflowLocationAccuracy.FULL
            return if (current.allowsLocation && enough) SynchronousResult(current) else null
        }

        override fun parseResult(resultCode: Int, intent: Intent?): TileflowLocationAuthorization {
            val granted = permissions.parseResult(resultCode, intent)
            PermissionChanges.notifyChanged()
            return if (granted.values.any { it }) TileflowLocationAuthorization.WHEN_IN_USE
            else TileflowLocationAuthorization.DENIED
        }
    }
}

/** Providers that start measuring as soon as a request grants access. */
@MainThread
internal object PermissionChanges {
    private val listeners = mutableListOf<WeakReference<() -> Unit>>()

    fun add(listener: () -> Unit) {
        listeners.removeAll { it.get() == null }
        listeners += WeakReference(listener)
    }

    fun notifyChanged() {
        listeners.removeAll { it.get() == null }
        for (listener in listeners.mapNotNull { it.get() }) listener()
    }
}
