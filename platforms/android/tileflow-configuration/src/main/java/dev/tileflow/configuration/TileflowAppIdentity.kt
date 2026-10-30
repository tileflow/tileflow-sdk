package dev.tileflow.configuration

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest
import java.util.Locale

/**
 * The application a publishable credential admits: its package name and the SHA-256 fingerprint of
 * its signing certificate. Clients detect the running application's identity; set one in
 * [TileflowConfiguration.app] only to replace it.
 *
 * @param certificateSha256 64 hexadecimal characters, in any case and optionally separated by
 *   colons. It is kept as 64 lowercase hexadecimal characters.
 * @throws TileflowConfigurationException when the id or the fingerprint is invalid.
 */
public class TileflowAppIdentity
@JvmOverloads
constructor(id: String, certificateSha256: String? = null) {
    public val id: String
    public val certificateSha256: String?

    init {
        val certificate = certificateSha256?.replace(":", "")?.lowercase(Locale.ROOT)
        if (
            id.length > 255 ||
                !APP_ID.matches(id) ||
                (certificate != null && !CERTIFICATE.matches(certificate))
        )
            throw TileflowConfigurationException(
                "A Tileflow app identity needs a package name and, optionally, a SHA-256 " +
                    "certificate fingerprint."
            )
        this.id = id
        this.certificateSha256 = certificate
    }

    override fun equals(other: Any?): Boolean =
        other is TileflowAppIdentity &&
            other.id == id &&
            other.certificateSha256 == certificateSha256

    override fun hashCode(): Int = 31 * id.hashCode() + (certificateSha256?.hashCode() ?: 0)

    override fun toString(): String =
        "TileflowAppIdentity(id=$id, certificateSha256=$certificateSha256)"

    public companion object {
        private val APP_ID = Regex("^[A-Za-z][A-Za-z0-9_-]*(\\.[A-Za-z0-9_-]+)+$")
        private val CERTIFICATE = Regex("^[0-9a-f]{64}$")
        private val lock = Any()
        @Volatile private var detected: Result<TileflowAppIdentity>? = null

        /**
         * The running application's package name and the SHA-256 fingerprint of its current
         * signing certificate, computed once per process.
         *
         * @throws TileflowConfigurationException when the application has no single current
         *   signing certificate.
         */
        @JvmStatic
        public fun current(context: Context): TileflowAppIdentity {
            val result =
                detected
                    ?: synchronized(lock) {
                        detected
                            ?: runCatching { detect(context) }.also { detected = it }
                    }
            return result.getOrElse {
                throw TileflowConfigurationException(
                    it.message ?: "The application's identity is unavailable.",
                    it,
                )
            }
        }

        private fun detect(context: Context): TileflowAppIdentity {
            val certificate =
                try {
                    signingCertificate(context.packageManager, context.packageName)
                } catch (error: PackageManager.NameNotFoundException) {
                    null
                }
                    ?: throw TileflowConfigurationException(
                        "The application has no single current signing certificate. Set " +
                            "TileflowConfiguration.app to identify it."
                    )
            return TileflowAppIdentity(context.packageName, sha256Hex(certificate))
        }

        @SuppressLint("PackageManagerGetSignatures")
        private fun signingCertificate(packageManager: PackageManager, name: String): ByteArray? {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info =
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        packageManager.getPackageInfo(
                            name,
                            PackageManager.PackageInfoFlags.of(
                                PackageManager.GET_SIGNING_CERTIFICATES.toLong()
                            ),
                        )
                    else
                        packageManager.getPackageInfo(
                            name,
                            PackageManager.GET_SIGNING_CERTIFICATES,
                        )
                val signing = info.signingInfo ?: return null
                return currentCertificate(
                    signing.hasMultipleSigners(),
                    signing.apkContentsSigners.orEmpty().map { it.toByteArray() },
                    signing.signingCertificateHistory.orEmpty().map { it.toByteArray() },
                )
            }
            @Suppress("DEPRECATION")
            val signatures =
                packageManager.getPackageInfo(name, PackageManager.GET_SIGNATURES).signatures
            // Several signatures leave no single certificate to identify the application by.
            return signatures?.singleOrNull()?.toByteArray()
        }

        /**
         * The current certificate: the only APK signer when there are several signers, otherwise
         * the newest certificate of the rotation history, which lists the original one first.
         */
        internal fun currentCertificate(
            hasMultipleSigners: Boolean,
            apkContentsSigners: List<ByteArray>,
            signingCertificateHistory: List<ByteArray>,
        ): ByteArray? =
            if (hasMultipleSigners) apkContentsSigners.singleOrNull()
            else signingCertificateHistory.lastOrNull()

        internal fun sha256Hex(bytes: ByteArray): String {
            val digits = "0123456789abcdef"
            val text = StringBuilder(64)
            for (byte in MessageDigest.getInstance("SHA-256").digest(bytes)) {
                val value = byte.toInt()
                text.append(digits[(value shr 4) and 0xf]).append(digits[value and 0xf])
            }
            return text.toString()
        }

        internal fun resetForTesting() {
            detected = null
        }
    }
}
