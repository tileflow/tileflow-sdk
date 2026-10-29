# Camera, gestures and controls in the Swift and Kotlin map SDKs

The Swift (`Tileflow`, UIKit and SwiftUI) and Kotlin (`dev.tileflow:tileflow-sdk`, Views and
Compose) map SDKs move the camera with animations that report how they ended, keep the current
camera available without a call, keep the camera and the map's controls clear of system bars and
of the application's own UI, and let the application choose which gestures move the map. This
guide describes the source in this repository; no native release of the map SDKs has been
published yet.

The examples assume a map that already shows: a `TileflowMapView` or `TileflowMap` with a source,
as in the example apps under `platforms/ios/Examples` and `platforms/android/example`.

## Units

| Surface                                    | Points and insets                                  |
| ------------------------------------------ | -------------------------------------------------- |
| iOS, UIKit and SwiftUI                     | Points, in the map view's coordinate system        |
| Android `TileflowMapView`                  | Physical pixels, relative to the view              |
| Compose (`TileflowMapController`, padding) | `Dp` and `DpOffset`                                |
| Android map events (`Tap`, `LongPress`)    | Physical pixels, on both Views and Compose screens |

The renderer works in CSS pixels. On iOS a CSS pixel is a point. On Android a CSS pixel is a
density-independent pixel: divide physical pixels by `resources.displayMetrics.density` to get
`Dp`, and multiply `Dp` by it to get pixels. In Compose, `LocalDensity.current` converts between
the two.

## Read the camera

`currentCamera` holds the camera the renderer last reported, without a call: it is updated each
time the camera settles, and while it moves when the application or a control follows it. Before
the map loads it holds the camera the map starts at, or nil for the map's authored view.
`isMoving` tells whether an animation or a gesture is moving the camera. `camera()` asks the
renderer.

The `cameraChanged` event carries the camera, the phase (`started`, `moving`, `ended`) and who
moved it: `gesture` (a person, including the map's controls and the motion after a gesture),
`api` (the application) or `system` (the SDK, for example after the content insets change). Which
phases the application receives depends on its event level:

| Level        | Camera events the application receives                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `essential`  | The settled camera                                                            |
| `camera`     | Also the start of each movement, and the start and end of each gesture        |
| `continuous` | Also the camera while it moves, at most once per frame or per chosen interval |

```swift
let options = TileflowMapOptions(events: .init(level: .continuous, cameraUpdateInterval: 0.1))
```

```kotlin
val options = TileflowMapOptions(
    events = TileflowEventOptions(TileflowEventLevel.CONTINUOUS, cameraUpdateIntervalMillis = 100),
)
```

## Move the camera

`jump`, `ease` and `fly` move the camera and return once it settles. `move(to:animation:)` takes
the animation as a value. A `TileflowCameraUpdate` changes only the values it sets, so an update
can turn the map to north without moving it; every call also accepts a complete `TileflowCamera`.

Each call returns how the movement ended:

- `finished`: the camera reached its target;
- `cancelled`: the application stopped the movement with `stopCamera()` or started another one;
- `interrupted`: a person took over the map, or the map moved for another reason.

Cancelling the calling Swift task or Kotlin coroutine stops the movement in the renderer and
throws `CancellationError` or `CancellationException`. Animations last at most 20 seconds; a
flight longer than that jumps. When the device asks for reduced motion, the renderer may move at
once instead; the movement still ends as `finished`.

```swift
let result = try await map.fly(
  to: TileflowCamera(longitude: 2.3522, latitude: 48.8566, zoom: 12),
  options: .init(duration: 2))
if result == .interrupted { /* the person moved the map during the flight */ }
try await map.ease(to: TileflowCameraUpdate(bearing: 0, pitch: 60), duration: 0.4, easing: .easeOut)
```

```kotlin
val result = map.fly(
    TileflowCamera(longitude = 2.3522, latitude = 48.8566, zoom = 12.0),
    TileflowFlyOptions(durationMillis = 2000),
)
map.ease(TileflowCameraUpdate(bearing = 0.0, pitch = 60.0), durationMillis = 400)
```

Before the map loads, a complete camera becomes the camera it starts at and the call returns
`finished`; an update without a center and zoom fails with `notReady`.

## Frame places

`fit(_:padding:bearing:pitch:maxZoom:animation:)` (Kotlin: `fit(bounds, padding, …)`) frames
bounds with padding around them, inside the content insets. `camera(for:)` returns the camera
that would frame them without moving, and `camera(fitting:)` (Kotlin: `cameraFitting`) does the
same for a list of coordinates, such as a route's or a shape's. Bounds whose east edge lies west
of their west edge cross the antimeridian; `TileflowBounds(enclosing:)` (Kotlin:
`TileflowBounds.enclosing`) picks the narrower side of the world. `visibleBounds()` returns the
region the view shows; a view that shows the horizon ends at the horizon.

```swift
try await map.fit(
  TileflowBounds(west: -3.71, south: 40.41, east: -3.69, north: 40.43),
  padding: UIEdgeInsets(top: 24, left: 24, bottom: 24, right: 24), animation: .ease())
```

## Limit the camera

`TileflowMapOptions.cameraLimits` sets the minimum and maximum zoom (0 to 24), the minimum and
maximum pitch (0 to 85, the same as on the web) and bounds the view must stay within. A camera
outside new limits moves inside them.

```swift
var options = TileflowMapOptions()
options.cameraLimits = TileflowCameraLimits(
  minZoom: 10, maxPitch: 60, bounds: TileflowBounds(west: -3.9, south: 40.3, east: -3.5, north: 40.6))
try await map.setOptions(options)
```

## Keep the map clear of system bars and sheets

The camera centres on the part of the view that nothing covers, and the controls, the attribution
and the map's notices stay inside it. By default the SDK adds the safe area on iOS, and the
system bars and display cutout where they overlap the view on Android. Add the space your own UI
covers, such as a bottom sheet, as content insets; update them as the sheet moves.

```swift
map.contentInsets.bottom = sheetHeight  // UIKit, in points
TileflowMap(source: source, contentInsets: UIEdgeInsets(top: 0, left: 0, bottom: sheetHeight, right: 0))
```

```kotlin
map.setContentPadding(0f, 0f, 0f, sheetHeightPx)  // Views, in pixels
TileflowMap(source, contentPadding = PaddingValues(bottom = sheetHeight))  // Compose, in Dp
```

Turn the automatic part off with `automaticallyAdjustsContentInsets` (Kotlin:
`automaticallyAdjustsContentPadding`) when the map does not extend under the system bars and
something else already accounts for them. `effectiveContentInsets` (Kotlin:
`effectiveContentPadding`) holds the insets in use. Changes made while the camera moves apply
when it settles, so they never stop an animation.

## Control the camera from state

A controlled map reads its camera from the application's state and writes it back when the
application receives a camera event. Writing a different camera moves the map; the map's own
writes never move it again.

In SwiftUI, pass a binding. A write inside `withAnimation` eases there; any other write jumps.

```swift
@State private var camera = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 13)

var body: some View {
  TileflowMap(source: source, camera: $camera)
  Button("Zoom in") { withAnimation { camera.zoom += 1 } }
}
```

In Compose, hoist a `TileflowCameraState`. `rememberTileflowCameraState` keeps the camera across
rotation and process recreation; the state also moves the camera (`fly`, `ease`, `fit`, …).

```kotlin
val camera = rememberTileflowCameraState(TileflowCamera(-3.70, 40.42, 13.0))
TileflowMap(source, cameraState = camera)
Button(onClick = { scope.launch { camera.fly(TileflowCameraUpdate(zoom = 15.0)) } }) { Text("Closer") }
```

An Android `TileflowMapView` with an `android:id` saves its camera in the view's saved state and
restores it after rotation and process recreation. A UIKit or SwiftUI map keeps its camera across
rotation; to restore it after the system ends the app, save `currentCamera` (it is `Codable`) and
pass it back as the initial camera or binding value.

## Gestures

`TileflowGestures` turns panning, zooming, rotating and pitching on or off, as well as double-tap
zoom; `doubleTapZoomDelta` sets how many zoom levels a double tap adds (0.25 to 4). With
`cooperative`, one finger scrolls what surrounds the map and two fingers move it; the map shows a
hint when one finger tries to move it. `TileflowGestures.none` (Kotlin: `TileflowGestures.NONE`)
keeps a static map that still reports taps.

Inside a scroll view, a pager or a sheet, a drag that begins on the map moves the map rather than
its container. On iOS, the container's pan gestures wait for the map; on Android, the map asks its
parents not to intercept the touch. With cooperative gestures this happens only for two fingers.

To leave touches that begin at some points to the views behind and around the map, for example
over application content drawn on the map, return false from a touch filter: `shouldReceiveTouch`
on a UIKit `TileflowMapView`, `.receivesTouches(where:)` on a SwiftUI `TileflowMap`, `touchFilter`
on an Android `TileflowMapView` (pixels) and the `touchFilter` parameter of Compose `TileflowMap`
(`DpOffset`). The map's controls always receive their touches. The renderer runs in a separate
process, so there is no per-frame camera veto: limits, gestures and the touch filter decide what a
person can do.

Map events report what a person does:

- `tap` and `longPress` carry the coordinate and the point that was touched. A long press is a
  press that holds still for half a second; it is never also a tap.
- `gestureStarted` and `gestureEnded` report panning, zooming, rotating and pitching, at the
  `camera` event level and above.

## Controls

`TileflowMapOptions.controls` configures native controls drawn over the map:

- the compass, which shows where north is and turns the map to north when tapped. By default it
  appears only while the map is turned away from north;
- a scale bar, in kilometres and metres, or miles and feet where the region uses them;
- a recenter button, which reports `recenterRequested`. The application decides where the camera
  goes, for example back to a starting view or to the person's location.

Each control takes a corner (`topLeading`, `topTrailing`, `bottomLeading`, `bottomTrailing`;
Kotlin uses `START` and `END`), which follows the layout direction. The attribution is always
shown; only its corner can change, and controls in the same corner stack above it.

```swift
let options = TileflowMapOptions(
  controls: .init(scaleBar: true, recenterButton: true, attributionPosition: .bottomLeading))
```

```kotlin
val options = TileflowMapOptions(
    controls = TileflowMapControls(scaleBar = true, recenterButton = true),
)
```

## Feature queries at steep pitches

From about 72° with the default field of view, the top of the view shows the sky. MapLibre GL JS
6.13 then stops finding circles, lines and fills in feature queries
([maplibre/maplibre-gl-js#2994](https://github.com/maplibre/maplibre-gl-js/issues/2994)). The
renderer corrects this for every query and tap, so `query(at:)` and point-of-interest taps keep
working up to pitch 85.
