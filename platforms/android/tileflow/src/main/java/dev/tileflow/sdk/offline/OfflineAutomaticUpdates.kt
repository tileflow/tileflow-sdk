package dev.tileflow.sdk.offline

import android.content.Context
import android.net.ConnectivityManager
import android.os.PowerManager
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.File
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Whether the device may update regions by itself now: on Wi-Fi or another unmetered network, and
 * not saving power.
 */
internal data class OfflineUpdateConditions(val isUnmetered: Boolean, val isLowPower: Boolean) {
    val allowsUpdates: Boolean
        get() = isUnmetered && !isLowPower

    companion object {
        /** No automatic update runs. */
        val UNAVAILABLE = OfflineUpdateConditions(isUnmetered = false, isLowPower = false)

        /** The device's network and power, as the system reports them. */
        fun current(context: Context): OfflineUpdateConditions {
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            val power = context.getSystemService(PowerManager::class.java)
            val unmetered =
                runCatching { connectivity?.activeNetwork != null && !connectivity.isActiveNetworkMetered }
                    .getOrDefault(false)
            return OfflineUpdateConditions(unmetered, power?.isPowerSaveMode == true)
        }
    }
}

/** Asks the system to run the store's automatic updates in the background. */
internal interface OfflineUpdateScheduler {
    fun schedule()

    fun cancel()
}

/**
 * Runs automatic updates as unique periodic WorkManager work, once a day, only on an unmetered
 * network and while the battery is not low. The work only revalidates regions and starts their
 * downloads, which run as their own work on unmetered networks.
 */
internal class OfflineWorkUpdateScheduler(private val context: Context) : OfflineUpdateScheduler {
    override fun schedule() {
        val request =
            PeriodicWorkRequestBuilder<OfflineUpdateWorker>(1, TimeUnit.DAYS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.UNMETERED)
                        .setRequiresBatteryNotLow(true)
                        .build()
                )
                .addTag(OfflineDownloadWorker.TAG)
                .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    override fun cancel() {
        WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }

    companion object {
        const val NAME = "dev.tileflow.offline.update"
    }
}

/** One automatic update pass of the process's store. */
internal class OfflineUpdateWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        TileflowOfflineStore.get(applicationContext)
            .core
            .updateAutomatically(OfflineUpdateConditions.current(applicationContext))
        return Result.success()
    }
}

/** The store's settings, beside its records: `settings.json`, replaced atomically. */
internal data class OfflineSettings(
    val automaticUpdates: Boolean = false,
    /** When the last automatic update pass ran, in milliseconds since 1970. */
    val lastAutomaticUpdate: Long? = null,
) {
    fun write(file: File) =
        OfflineLayout.write(
            JSONObject()
                .put("automaticUpdates", automaticUpdates)
                .putOpt("lastAutomaticUpdate", lastAutomaticUpdate)
                .toString()
                .toByteArray(),
            file,
        )

    companion object {
        fun read(file: File): OfflineSettings =
            runCatching {
                    val value = JSONObject(file.readText())
                    OfflineSettings(
                        value.optBoolean("automaticUpdates", false),
                        if (value.has("lastAutomaticUpdate")) value.getLong("lastAutomaticUpdate")
                        else null,
                    )
                }
                .getOrDefault(OfflineSettings())
    }
}
