package dev.tileflow.sdk.transport

import org.maplibre.android.LibraryLoaderProvider
import org.maplibre.android.ModuleProvider
import org.maplibre.android.http.HttpRequest

/**
 * MapLibre's module provider with Tileflow's requests answered by the SDK. It wraps the provider
 * that was in place, so MapLibre's own HTTP client, or one an application installed, keeps every
 * request that is not a Tileflow address, and its library loader is unchanged.
 */
internal class MapLibreModuleProvider(private val previous: ModuleProvider) : ModuleProvider {
    override fun createHttpRequest(): HttpRequest =
        MapLibreHttpRequest(previous.createHttpRequest())

    override fun createLibraryLoaderProvider(): LibraryLoaderProvider =
        previous.createLibraryLoaderProvider()
}
