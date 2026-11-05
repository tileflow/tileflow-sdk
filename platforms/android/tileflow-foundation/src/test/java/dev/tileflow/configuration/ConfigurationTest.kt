package dev.tileflow.configuration

import dev.tileflow.testing.Contract
import dev.tileflow.testing.failure
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ConfigurationTest {
    private val credential = TileflowCredential(Contract.credential)
    private val other = TileflowCredential("tf_public_" + "a".repeat(48))
    private val map = TileflowCredential("tf_public_" + "b".repeat(48))

    @Test
    fun credentialsArePublishableOnlyAndNeverPrinted() {
        assertEquals(credential, TileflowCredential(Contract.credential))
        for (value in
            listOf(
                "",
                "tf_public_" + "0".repeat(47),
                "tf_public_" + "0".repeat(49),
                "tf_public_" + "A".repeat(48),
                "tf_secret_" + "0".repeat(48),
                " " + Contract.credential,
                Contract.credential + "\n",
            )) {
            failure<TileflowConfigurationException> { TileflowCredential(value) }
        }
        val configuration =
            TileflowConfiguration(servicesCredential = credential, mapCredential = map)
        for (text in listOf(credential.toString(), configuration.toString())) {
            assertFalse(text.contains(Contract.credential.removePrefix("tf_public_")))
            assertFalse(text.contains("b".repeat(48)))
        }
    }

    @Test
    fun originsAreNormalizedHttpsOrigins() {
        fun origin(value: String) = TileflowConfiguration(URI(value)).apiOrigin.toString()
        assertEquals("https://api.tileflow.dev", origin("https://api.tileflow.dev"))
        assertEquals("https://api.tileflow.dev", origin("HTTPS://API.Tileflow.dev/"))
        assertEquals("https://api.tileflow.dev", origin("https://api.tileflow.dev:443"))
        assertEquals("https://api.example.com:8443", origin("https://api.example.com:8443/"))
        assertEquals("http://localhost:8787", origin("http://localhost:8787"))
        assertEquals("http://127.0.0.1:8787", origin("http://127.0.0.1:8787/"))
        assertEquals("http://[::1]:8787", origin("http://[::1]:8787"))
        assertEquals(URI("https://api.tileflow.dev"), TileflowConfiguration().apiOrigin)
        for (value in
            listOf(
                "http://api.tileflow.dev",
                "ftp://api.tileflow.dev",
                "https://api.tileflow.dev/v1",
                "https://api.tileflow.dev/?key=value",
                "https://api.tileflow.dev/#fragment",
                "https://user:password@api.tileflow.dev",
                "https:///path",
                "mailto:team@tileflow.dev",
                "api.tileflow.dev",
            )) {
            failure<TileflowConfigurationException> { TileflowConfiguration(URI(value)) }
        }
    }

    @Test
    fun servicesUseTheirOwnCredentialAndNeverTheMapCredential() {
        val shared =
            TileflowConfiguration(servicesCredential = credential, searchCredential = other)
        assertSame(other, shared.credential(TileflowService.SEARCH))
        assertSame(credential, shared.credential(TileflowService.ROUTING))
        assertSame(credential, shared.credential(TileflowService.ELEVATION))
        assertNull(shared.credential(TileflowService.GEOIP))
        val mapOnly = TileflowConfiguration(mapCredential = map)
        for (service in TileflowService.entries) assertNull(mapOnly.credential(service))
        val routing = TileflowConfiguration(routingCredential = other, elevationCredential = map)
        assertNull(routing.credential(TileflowService.SEARCH))
        assertSame(other, routing.credential(TileflowService.ROUTING))
        assertSame(map, routing.credential(TileflowService.ELEVATION))
    }

    @Test
    fun resourceValuesBuildTheConfiguration() {
        val values =
            mapOf(
                "tileflow_api_origin" to "https://api.example.com/",
                "tileflow_services_credential" to Contract.credential,
                "tileflow_elevation_credential" to "tf_public_" + "a".repeat(48),
                "tileflow_map_credential" to "tf_public_" + "b".repeat(48),
                "tileflow_search_credential" to " ",
            )
        val configuration = TileflowConfiguration.fromValues(values::get)
        assertEquals(URI("https://api.example.com"), configuration.apiOrigin)
        assertEquals(credential, configuration.servicesCredential)
        assertEquals(credential, configuration.credential(TileflowService.SEARCH))
        assertEquals(other, configuration.credential(TileflowService.ELEVATION))
        assertEquals(map, configuration.mapCredential)
        assertNull(configuration.app)
        assertEquals(TileflowConfiguration(), TileflowConfiguration.fromValues { null })
        for (invalid in
            listOf(
                "tileflow_api_origin" to "http://api.example.com",
                "tileflow_api_origin" to "not a url",
                "tileflow_services_credential" to "tf_secret_" + "0".repeat(48),
                "tileflow_routing_credential" to "credential",
                "tileflow_map_credential" to "tf_public_short",
            )) {
            failure<TileflowConfigurationException> {
                TileflowConfiguration.fromValues(mapOf(invalid)::get)
            }
        }
    }

    @Test
    fun theResourcesAreReadOnceAndAnExplicitConfigurationReplacesIt() {
        Tileflow.resetForTesting()
        try {
            var reads = 0
            val manifest = TileflowConfiguration(servicesCredential = credential)
            repeat(2) { assertSame(manifest, Tileflow.configuration { reads += 1; manifest }) }
            assertEquals(1, reads)
            val explicit = TileflowConfiguration(searchCredential = other)
            Tileflow.configure(explicit)
            assertSame(explicit, Tileflow.configuration { error("The resources are not read.") })

            Tileflow.resetForTesting()
            repeat(2) {
                failure<TileflowConfigurationException> {
                    Tileflow.configuration {
                        reads += 1
                        throw TileflowConfigurationException("Invalid manifest value.")
                    }
                }
            }
            // A failure is cached too.
            assertEquals(2, reads)
        } finally {
            Tileflow.resetForTesting()
        }
    }

    @Test
    fun appIdentitiesAreNormalized() {
        val colons =
            Contract.androidApp.certificateSha256!!.uppercase().chunked(2).joinToString(":")
        val identity = TileflowAppIdentity("dev.tileflow.example", colons)
        assertEquals(Contract.androidApp, identity)
        assertEquals(Contract.androidApp.certificateSha256, identity.certificateSha256)
        assertNull(TileflowAppIdentity("dev.tileflow.example").certificateSha256)
        for ((id, certificate) in
            listOf(
                "example" to null,
                "1dev.tileflow" to null,
                "dev..tileflow" to null,
                "dev.tileflow." to null,
                "dev." + "a".repeat(252) to null,
                "dev.tileflow.example" to "0".repeat(63),
                "dev.tileflow.example" to "g".repeat(64),
            )) {
            failure<TileflowConfigurationException> { TileflowAppIdentity(id, certificate) }
        }
    }

    @Test
    fun theCurrentCertificateIsTheSingleSignerOrTheNewestInTheHistory() {
        val original = byteArrayOf(1)
        val rotated = byteArrayOf(2)
        val signer = byteArrayOf(3)
        fun current(multiple: Boolean, signers: List<ByteArray>, history: List<ByteArray>) =
            TileflowAppIdentity.currentCertificate(multiple, signers, history)
        assertSame(rotated, current(false, listOf(signer), listOf(original, rotated)))
        assertSame(signer, current(true, listOf(signer), emptyList()))
        assertNull(current(true, listOf(signer, rotated), emptyList()))
        assertNull(current(false, emptyList(), emptyList()))
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            TileflowAppIdentity.sha256Hex("abc".toByteArray()),
        )
    }
}
