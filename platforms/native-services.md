# Native Search, Routing, Elevation and GeoIP clients

Swift and Kotlin clients for Tileflow Search, Routing and Elevation, an anonymous GeoIP helper, and
helpers that draw their results on a Tileflow map. They follow the JavaScript packages
[`@tileflow/search`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/search/README.md),
[`@tileflow/routing`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/routing/README.md),
[`@tileflow/elevation`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/elevation/README.md)
and [`@tileflow/geoip`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/geoip/README.md):
the same operations, limits, error codes and answer checks. This guide describes the source in this
repository; no native release of these modules has been published yet.

## Modules

Every service module works without the map, and the map works without them.

| Swift product (`platforms/ios`) | Android artifact (`platforms/android`)  | Contents                                                       |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `TileflowConfiguration`         | `dev.tileflow:tileflow-configuration`   | Configuration, credentials, app identity, positions, errors    |
| `TileflowSearch`                | `dev.tileflow:tileflow-search`          | Geocoding, reverse geocoding, autocomplete, Nearby, categories |
| `TileflowRouting`               | `dev.tileflow:tileflow-routing`         | Routes, isochrones, matrices, map matching, nearest road       |
| `TileflowElevation`             | `dev.tileflow:tileflow-elevation`       | Point heights, batches, profiles, GPX reading                  |
| `TileflowGeoIP`                 | `dev.tileflow:tileflow-geoip`           | Approximate geography of the network connection                |
| `TileflowServiceContent`        | `dev.tileflow:tileflow-service-content` | Route, isochrone and profile content for the map               |

Requirements match the map: iOS 16 and Swift 6 tools; Android API 26 and Java 17. Swift calls are
`async throws` and stop when their task is cancelled. Kotlin calls are `suspend` functions, run their
network work off the main thread and stop when their coroutine is cancelled.

## Configure the application

Search, Routing and Elevation need a publishable credential (`tf_public_` followed by 48 lowercase
hexadecimal digits) with the permission for each service. Create it in Team → Credentials as
"Search, Routing and Elevation in websites and apps" and list the app on it: the iOS bundle ID, or
the Android package name with the SHA-256 fingerprint of its signing certificate. Never put a server
credential in an application; the clients refuse any value that is not publishable.

The Hosted map uses its own mobile credential. It never authorizes a service, and a services
credential never authorizes the map.

On iOS, add String keys to the application target's Info.plist:

```xml
<key>TileflowServicesCredential</key>
<string>YOUR_PUBLISHABLE_SERVICES_CREDENTIAL</string>
```

On Android, add meta-data to the application element of `AndroidManifest.xml`:

```xml
<meta-data
    android:name="dev.tileflow.SERVICES_CREDENTIAL"
    android:value="YOUR_PUBLISHABLE_SERVICES_CREDENTIAL" />
```

| Meaning                                           | Info.plist key                | Android meta-data                   |
| ------------------------------------------------- | ----------------------------- | ----------------------------------- |
| API origin (optional, `https://api.tileflow.dev`) | `TileflowAPIOrigin`           | `dev.tileflow.API_ORIGIN`           |
| Credential for Search, Routing and Elevation      | `TileflowServicesCredential`  | `dev.tileflow.SERVICES_CREDENTIAL`  |
| Search only, replacing the shared one             | `TileflowSearchCredential`    | `dev.tileflow.SEARCH_CREDENTIAL`    |
| Routing only, replacing the shared one            | `TileflowRoutingCredential`   | `dev.tileflow.ROUTING_CREDENTIAL`   |
| Elevation only, replacing the shared one          | `TileflowElevationCredential` | `dev.tileflow.ELEVATION_CREDENTIAL` |
| Hosted map credential (read for the map)          | `TileflowMapCredential`       | `dev.tileflow.MAP_CREDENTIAL`       |

The configuration is read once, on first use. A present but invalid value fails every call with a
configuration error rather than falling back. Applications that receive their configuration at
runtime set it explicitly before the first call; it then replaces the native configuration for the
rest of the process:

```swift
import TileflowSearch

Tileflow.configure(
  try TileflowConfiguration(servicesCredential: try TileflowCredential(credentialFromYourBackend)))
```

```kotlin
import dev.tileflow.configuration.Tileflow
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential

Tileflow.configure(
    TileflowConfiguration(servicesCredential = TileflowCredential(credentialFromYourBackend))
)
```

`credentialFromYourBackend` stands for a value your application obtains; it is not part of the SDK.

### App identity

Every Search, Routing and Elevation request carries the app identity a publishable credential
checks. iOS sends `X-Tileflow-App` with the bundle ID. Android sends `X-Tileflow-App` with the
package name and `X-Tileflow-App-Certificate` with the SHA-256 of the current signing certificate.
With Google Play app signing, list the app signing key's fingerprint from Play Console, and the
debug key's fingerprint for debug builds. An Android package with more than one current signer needs
an explicit `app` identity in its configuration.

These headers limit casual reuse of a copied credential; they are not authentication. The
credential's quotas and the Team's spending limit bound what a copied value can consume.

## Search, route and draw

Swift, with a map controller attached to a `TileflowMap` or `TileflowMapView`:

```swift
import Tileflow
import TileflowServiceContent

@MainActor
func walk(to query: String, on controller: TileflowMapController) async throws {
  let camera = try await controller.camera()
  let found = try await TileflowSearch().geocode(
    TileflowGeocodeRequest(query: query, limit: 1, proximity: camera.searchProximity))
  guard let place = found.results.first else { return }
  let answer = try await TileflowRouting().route(
    TileflowRouteRequest(
      locations: [TileflowPosition(longitude: camera.longitude, latitude: camera.latitude), place.position],
      mode: .walking))
  try await controller.setContent(
    annotations: [TileflowAnnotation(place: place, id: "destination")],
    layers: try TileflowGeoJSONLayer.route(answer, inks: .light))
  try await controller.fit(TileflowBounds(answer.routes[0].bounds), padding: 48)
}
```

Kotlin, in a coroutine with a map controller:

```kotlin
import android.content.Context
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.routing.TileflowRouteRequest
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.routing.TileflowRoutingMode
import dev.tileflow.sdk.TileflowMapController
import dev.tileflow.search.TileflowGeocodeRequest
import dev.tileflow.search.TileflowSearch
import dev.tileflow.servicecontent.TileflowBounds
import dev.tileflow.servicecontent.TileflowRouteInks
import dev.tileflow.servicecontent.TileflowRouteLayers
import dev.tileflow.servicecontent.searchProximity

suspend fun walk(context: Context, query: String, controller: TileflowMapController) {
    val camera = controller.camera()
    val place =
        TileflowSearch(context)
            .geocode(
                TileflowGeocodeRequest(query = query, limit = 1, proximity = camera.searchProximity)
            )
            .results
            .firstOrNull() ?: return
    val answer =
        TileflowRouting(context)
            .route(
                TileflowRouteRequest(
                    locations = listOf(TileflowPosition(camera.longitude, camera.latitude), place.position),
                    mode = TileflowRoutingMode.WALKING,
                )
            )
    controller.setContent(layers = TileflowRouteLayers.build(answer, inks = TileflowRouteInks.LIGHT))
    controller.fit(TileflowBounds(answer.routes[0].bounds), padding = 48f)
}
```

The map helpers build ordinary map content:

- Route layers draw alternatives, glow, casing, line and core in a theme's route inks. Until the map
  publishes the inks of the theme on screen, pass `light`, `dark` or your own colours.
- Isochrone layers draw one translucent fill per time, the longest first.
- An elevation-profile annotation marks a distance along a profile, for example the point a person
  touches on its chart.
- `searchProximity` turns the camera into a Search proximity at city scale or closer, and a GeoIP
  location can choose an initial camera.

Lines and rings are simplified until the layers fit the map's content limits, so a long route and a
marker fit in one `setContent` call.

## Errors

Each service has its own error type (`TileflowSearchError`, `TileflowRoutingError`,
`TileflowElevationError`, `TileflowGeoIPError`; Kotlin exceptions with the same names ending in
`Exception`) with a shared `kind`:

| Kind              | Meaning                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `configuration`   | No usable credential or app identity for the service, or invalid configuration.   |
| `invalidRequest`  | The request breaks the service's documented limits. Nothing was sent.             |
| `network`         | No HTTP answer: connection, TLS, timeout, or a redirect, which is never followed. |
| `rejected`        | An HTTP error status, with `status`, `code`, `requestID` and `retryAfter`.        |
| `invalidResponse` | A successful answer outside the documented contract.                              |

`code` is set only when the answer carries a documented code with its documented status, as in the
JavaScript clients. The clients never retry on their own; honour `retryAfter` before trying again.

## What differs from the JavaScript clients

- Answers may gain fields: the native clients ignore object keys they do not know, because installed
  applications outlive API revisions. Every field they read is still checked, together with each
  operation's invariants (units, counts, shapes and ranges).
- Values the service may add to over time, such as maneuvers, road classes and result kinds, decode
  as open values instead of failing.
- GeoIP is anonymous only. Managed GeoIP is bound to website origins.
- Elevation has no local profile summaries or `elevateLineString` yet; `batch` covers bulk heights.

## Test without the network

The shared contract fixture
[`service-contract.json`](https://github.com/tileflow/tileflow-sdk/blob/main/platforms/ios/Tests/TileflowServiceTests/Fixtures/service-contract.json)
holds each operation's request body and a recorded answer, plus error cases. The JavaScript packages
check it against their own clients; the Swift and Kotlin tests serve it from local stubs.

```sh
cd platforms/ios
xcodebuild test -scheme Tileflow-Package -only-testing:TileflowServiceTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

```sh
cd platforms/android
./gradlew :tileflow-configuration:testDebugUnitTest :tileflow-search:testDebugUnitTest :tileflow-routing:testDebugUnitTest :tileflow-elevation:testDebugUnitTest :tileflow-geoip:testDebugUnitTest :tileflow-service-content:testDebugUnitTest
```

Replace the simulator name with one installed on your Mac.
