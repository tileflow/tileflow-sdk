# The person's location in the Swift and Kotlin map SDKs

The Swift (`Tileflow`, UIKit and SwiftUI) and Kotlin (`dev.tileflow:tileflow-sdk`, Views and
Compose) map SDKs show the device's location on the map and can keep the camera on it. The map
draws the location itself, so it stays on the ground under any pitch and in the 3D scene, and the
camera follows it smoothly between positions. This guide describes the source in this repository;
no native release of the map SDKs has been published yet.

The SDK never turns location services on by itself. The location provider measures only while a
map shows the location, the map is visible and the application has access. The SDK never asks for
background location.

## Declare why the application needs the location

iOS reads the purpose strings from the application's Info.plist:

| Key                                             | When                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NSLocationWhenInUseUsageDescription`           | Always, to show the location.                                                                                  |
| `NSLocationTemporaryUsageDescriptionDictionary` | To ask once for the precise location when the person shared only an approximate one. Each key names a purpose. |

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Shows where you are on the map and keeps the map centred on you.</string>
<key>NSLocationTemporaryUsageDescriptionDictionary</key>
<dict>
  <key>FollowLocation</key>
  <string>The map follows you more closely with your precise location.</string>
</dict>
```

Android applications declare the permissions in their manifest. The SDK's manifest declares none,
so applications that never show the location do not ask for it.

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<!-- For the precise location. -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

## Ask for access

Ask in response to something the person does, such as tapping a location button. On iOS,
`TileflowLocationPermissions.requestWhenInUse()` shows the system prompt once and returns the
answer; `requestFullAccuracy(purposeKey:)` asks for the precise location for the rest of the
session when the person shared an approximate one.

```swift
guard await TileflowLocationPermissions.requestWhenInUse().allowsLocation else { return }
if TileflowLocationPermissions.accuracy == .reduced {
  await TileflowLocationPermissions.requestFullAccuracy(purposeKey: "FollowLocation")
}
```

On Android, `TileflowLocationPermissions.RequestWhenInUse` is an activity result contract. Launch it
with `TileflowLocationAccuracy.FULL` to ask for the precise location, which since Android 12 lets the
person choose the approximate one, or with `REDUCED` for the approximate location only. Launching it
again with `FULL` asks to upgrade an approximate grant. It answers at once, without a prompt, when
the access is already granted.

```kotlin
// In an activity or fragment.
private val locationRequest =
    registerForActivityResult(TileflowLocationPermissions.RequestWhenInUse()) { authorization ->
        if (authorization.allowsLocation) showLocation()
    }

locationRequest.launch(TileflowLocationAccuracy.FULL)

// In Compose.
val request = rememberLauncherForActivityResult(TileflowLocationPermissions.RequestWhenInUse()) { … }
```

`TileflowLocationPermissions.authorization` and `accuracy` read the current access on both
platforms. Android does not say whether it would still show its prompt, so a permission that is not
granted reads as `DENIED` there; iOS reports `notDetermined` until the person answers.

## Show the location

Turn it on with `TileflowMapOptions.location`:

```swift
var options = TileflowMapOptions()
options.location = TileflowLocationOptions(enabled: true, puckBearing: .heading)
try await map.setOptions(options)
```

```kotlin
map.setOptions(
    TileflowMapOptions(
        location = TileflowLocationOptions(enabled = true, puckBearing = TileflowPuckBearing.HEADING)
    )
)
```

The map draws a puck: a dot with a circle of the position's accuracy (`showsAccuracy`), and with
`puckBearing` a cone toward the device's heading (`.heading`) or the direction of travel
(`.course`). The puck glides from one position to the next, so it moves smoothly with a provider
that reports once a second. When the latest position is older than `staleAfter` (Kotlin:
`staleAfterMillis`), 30 seconds by default, the puck turns grey until a new one arrives.

`latestLocation` holds the latest position the map received.

## Follow the location

`followMode` keeps the camera on the location:

| Mode       | The camera                                                        |
| ---------- | ----------------------------------------------------------------- |
| `none`     | Does not follow.                                                  |
| `position` | Keeps the location at the centre of the content insets.           |
| `heading`  | Also turns with the device, so the map ahead of the person is up. |
| `course`   | Also turns with the direction of travel, so the way ahead is up.  |

When the camera starts to follow, it moves to the location and zooms in to at least
`TileflowLocationOptions.followZoom` (15 by default; nil or null keeps the zoom). It then moves with
the puck, frame by frame, and reports each movement with the camera change reason `location`. The
camera centres the location inside the content insets, so a sheet over the map never hides it.

A person's gesture that moves the map ends following, as does any camera movement the application
asks for (`move`, `ease`, `fly`, `fit`, `stopCamera` or a shot), and turning the location off. A
finger resting on the map holds the camera without ending following, so a tap does not end it. Each
change the application did not make itself arrives as the `followModeChanged` event with its reason:
`gesture` for a person, `api` for the application.

```swift
map.followMode = .position
map.onEvent = { event in
  if case .followModeChanged(let change) = event, change.mode == .none { /* show "Recenter" */ }
}
```

```kotlin
map.followMode = TileflowFollowMode.POSITION
```

While the map shows the location, the native controls take part:

- The recenter button follows the location again, with the mode followed last. While following, it
  turns between following the position and following the heading, as the platforms' own location
  buttons do. Its icon shows the current mode. Without the location shown, it reports
  `recenterRequested` as before.
- The compass turns the map to north. While the heading or course mode is on, it changes to the
  position mode, so the camera keeps following with north up.

```swift
let options = TileflowMapOptions(
  controls: .init(recenterButton: true),
  location: .init(enabled: true, puckBearing: .heading))
```

## SwiftUI and Compose

In SwiftUI, bind the follow mode with `.followMode(_:)`. The map writes the binding when a person or
a camera movement changes the mode, and follows what the application writes.

```swift
@State private var followMode = TileflowFollowMode.none

var body: some View {
  TileflowMap(
    source: source,
    options: .init(controls: .init(recenterButton: true), location: .init(enabled: true))
  )
  .followMode($followMode)
  Button("My location") { followMode = .position }
}
```

In Compose, hoist a `TileflowLocationState`, as the camera state is hoisted.
`rememberTileflowLocationState` keeps the follow mode across rotation and process recreation; its
`location` holds the latest position.

```kotlin
val location = rememberTileflowLocationState()
TileflowMap(
    source,
    options = TileflowMapOptions(location = TileflowLocationOptions(enabled = true)),
    locationState = location,
)
Button(onClick = { location.followMode = TileflowFollowMode.POSITION }) { Text("My location") }
```

`TileflowMapController` also offers `followMode` and `latestLocation`.

## Where positions come from

By default each map creates a `TileflowDefaultLocationProvider` when it first shows the location.

- On iOS it uses Core Location, with the best accuracy the application may have, and the device's
  heading where the device has a compass. The heading follows the top of the screen in any
  orientation.
- On Android it uses Google Play services' Fused Location Provider when the application includes
  `com.google.android.gms:play-services-location` and the device has Google Play services. Otherwise
  it uses the platform's `LocationManager`: its fused provider from Android 12, or satellite and
  network positions together on earlier versions. The SDK does not depend on Google Play services;
  add the dependency to use it. The heading comes from the rotation vector sensor, corrected to true
  north.

```kotlin
dependencies {
    // Optional: the Fused Location Provider on devices with Google Play services.
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
```

Pass any `TileflowLocationProvider` instead, for example positions from the application's own
location service or from a recorded trip. A provider delivers `TileflowLocation` and
`TileflowHeading` values on the main thread to the consumers it holds, and should measure only while
it has consumers. A new consumer should receive the latest known position at once.

```swift
map.locationProvider = myProvider               // UIKit
TileflowMap(source: source).locationProvider(myProvider)  // SwiftUI
```

```kotlin
map.locationProvider = myProvider                         // Views
TileflowMap(source, locationProvider = myProvider)        // Compose
```

`TileflowSimulatedLocationProvider` replays a route at a constant speed, with the direction of travel
as the course and the heading. It plays in real time while it has consumers; with
`playsAutomatically` off, `advance(by:)` (Kotlin: `advance(millis)`) moves it by hand, which makes
tests deterministic. It is also useful in the simulator and emulator.

```swift
let walk = TileflowSimulatedLocationProvider(
  route: [.init(longitude: -3.7038, latitude: 40.4168), .init(longitude: -3.6996, latitude: 40.4180)],
  speed: 1.4)
```

## Example apps

The four example apps under `platforms/ios/Examples` and `platforms/android/example` have a
"My location" button that asks for access with the system prompts, then shows and follows the
location. The iOS examples declare their purpose strings in `Examples/Shared/Info.plist`; the
Android example declares its permissions in its manifest and includes `play-services-location`.
Launch them with `--simulate-location` (iOS) or the `simulateLocation` boolean extra (Android) to
replay a walk instead of the device's location.

## Differences from the web

The web SDKs leave the location to the application, through the browser's Geolocation API and
MapLibre GL JS's `GeolocateControl`. The Swift and Kotlin SDKs include a provider, permission
helpers, a puck and follow modes because native applications expect them from a map SDK, and
because the camera and the puck move together only when both are driven inside the renderer.
