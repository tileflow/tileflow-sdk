# Annotations in the Swift and Kotlin map SDKs

The Swift (`Tileflow`, UIKit and SwiftUI) and Kotlin (`dev.tileflow:tileflow`, Views and Compose) map
SDKs offer two kinds of annotations, as the Mapbox Maps SDKs do:

- **Annotations drawn by the map**: points with an image, circles, polylines and polygons, grouped
  in annotation managers. People tap, hold and drag them, the map places them among its labels and
  hides overlapping ones, and they stay on the ground under any pitch.
- **View annotations**: the application's own native views pinned to a coordinate, such as a
  callout or a rich marker. They follow the map frame by frame.

Callouts and popups belong to the application: it builds them as views, and a view annotation
anchors them to the map. This guide describes the source in this repository; no native release has
been published yet.

Every name below exists on `TileflowMapView` (UIKit, Android View) and on `TileflowMapController`
(SwiftUI `TileflowMap`, Compose `TileflowMap`). A controller owns its annotations, so an
application can create them before the map appears; they move to the map the controller attaches
to.

## Annotation managers

Each manager draws one kind of annotation in one layer of the application's
[runtime style](native-style-data.md). The manager's identifier names both its source and its
layer, so other application layers can go above or below it, and `slot` and `position` place it
among the map's own layers. A manager without a slot lies above the whole map.

| Swift                                                          | Kotlin                                                                  | Draws                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| `annotations.makePointAnnotationManager(id:slot:position:)`    | `annotations.createPointAnnotationManager(TileflowAnnotationConfig(…))` | Images (symbol layer) |
| `annotations.makeCircleAnnotationManager(id:slot:position:)`   | `annotations.createCircleAnnotationManager(…)`                          | Circles               |
| `annotations.makePolylineAnnotationManager(id:slot:position:)` | `annotations.createPolylineAnnotationManager(…)`                        | Lines                 |
| `annotations.makePolygonAnnotationManager(id:slot:position:)`  | `annotations.createPolygonAnnotationManager(…)`                         | Filled polygons       |

`removeAnnotationManager` removes a manager with its layer, source and the images it added.

Swift annotations are values that the application assigns to the manager, as in the Mapbox Maps SDK
for iOS:

```swift
let pins = map.annotations.makePointAnnotationManager(slot: .aboveLabels)
var pin = TileflowPointAnnotation(
  coordinate: TileflowCoordinate(longitude: -3.7038, latitude: 40.4168),
  image: .init(image: UIImage(named: "pin")!, name: "pin"))
pin.iconAnchor = .bottom
pin.isDraggable = true
pin.accessibilityLabel = "Puerta del Sol"
pin.tapHandler = { context in
  showCallout(at: context.coordinate)
  return true  // The map's own tap event does not follow.
}
pins.annotations = [pin]
```

Kotlin annotations are created from options and changed in place, as in the Mapbox Maps SDK for
Android:

```kotlin
val pins = map.annotations.createPointAnnotationManager(
    TileflowAnnotationConfig(slot = TileflowLayerSlot.ABOVE_LABELS)
)
val pin = pins.create(
    TileflowPointAnnotationOptions()
        .withPoint(TileflowCoordinate(-3.7038, 40.4168))
        .withIconImage(pinBitmap)
        .withIconAnchor(TileflowIconAnchor.BOTTOM)
        .withDraggable(true)
        .withAccessibilityLabel("Puerta del Sol")
)
pins.addClickListener { annotation -> showCallout(annotation.point); true }
pin.iconSize = 1.5
pins.update(pin)
```

### Properties

Each property is the MapLibre property of the manager's layer, set per annotation. A value the
annotation leaves unset takes the manager's value, then the style specification's default.

| Annotation | Properties                                                                                                                                            | Manager                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Point      | image (`image` / `iconImageBitmap`) or `iconImage`, `iconAnchor`, `iconOffset`, `iconRotate`, `iconSize`, `iconColor`, `iconOpacity`, `symbolSortKey` | `iconAllowOverlap`, `iconIgnorePlacement` |
| Circle     | `circleRadius`, `circleColor`, `circleOpacity`, `circleStrokeColor`, `circleStrokeWidth`, `circleStrokeOpacity`, `circleBlur`, `circleSortKey`        |                                           |
| Polyline   | `lineColor`, `lineWidth`, `lineOpacity`, `lineBlur`, `lineSortKey`                                                                                    | `lineCap`                                 |
| Polygon    | `fillColor`, `fillOpacity`, `fillOutlineColor`, `fillSortKey`                                                                                         |                                           |
| All        | `isDraggable`, `accessibilityLabel`, and in Swift `tapHandler`, `longPressHandler`, `dragBeginHandler`, `dragChangeHandler`, `dragEndHandler`         |                                           |

Colours are `TileflowColor`, which Swift builds from a `UIColor` and Kotlin from a colour integer;
Kotlin options also take `@ColorInt` values. `iconColor` recolours signed distance field images.

A point annotation either carries its image, which the manager adds to the map's application
images under the given name and removes once no annotation uses it, or names an image the
application already added with `addImage`. Application images count towards the map's limit of 64.

### Collision and priority

Point annotations collide with each other and with the map's labels, as MapLibre places symbols:
when two overlap, the one placed first stays. `symbolSortKey` orders them, lowest first, so a lower
key wins. `iconAllowOverlap` shows every point of the manager regardless, and
`iconIgnorePlacement` lets the map's labels show over them.

### Taps, long presses and drags

A tap or long press on an annotation reaches the annotations under the touch, topmost first: each
annotation's handler in Swift, or the manager's click and long-click listeners in Kotlin. A handler
or listener that returns `true` handles the touch: the annotations below it and the map's own `tap`
or `longPress` event do not receive it.

A pan that starts on an annotation whose `isDraggable` is true moves the annotation instead of the
map. The map moves it under the finger in every frame, so the drag never waits for the
application. The application hears of the drag as it happens: `dragBeginHandler`,
`dragChangeHandler` and `dragEndHandler` in Swift, `TileflowAnnotationDragListener` in Kotlin. Each
receives the annotation at its new place, and the manager keeps that place when the drag ends.

## View annotations

A view annotation pins an application view to a coordinate:

```swift
let callout = TileflowViewAnnotation(coordinate: pin.coordinate, view: calloutView)
callout.variableAnchors = [.init(anchor: .bottom, offsetY: 40)]
callout.selected = true
map.viewAnnotations.add(callout)
// Later:
callout.remove()
```

```kotlin
map.viewAnnotationManager.addViewAnnotation(
    calloutView,
    TileflowViewAnnotationOptions(
        coordinate = pin.point,
        variableAnchors = listOf(
            TileflowViewAnnotationAnchorConfig(TileflowViewAnnotationAnchor.BOTTOM, offsetY = 40f)
        ),
        selected = true,
    ),
)
map.viewAnnotationManager.removeViewAnnotation(calloutView)
```

- **Anchor**: the point of the view placed on the coordinate. `bottom` puts the view's bottom centre
  there, so the view stands above it; the default is `center`. `offsetX` moves the view right and
  `offsetY` moves it up, as in the Mapbox SDKs.
- **Variable anchors**: the first anchor whose place does not collide with another view
  annotation wins; `anchorConfig` and the anchor callbacks report the chosen one.
- **Collision**: a view annotation hides rather than overlap another, unless `allowOverlap` is
  true. Selected annotations are placed first, then higher `priority`, then the order of addition.
- **Visibility**: `visible` hides a view annotation without removing it. A view annotation also
  hides while its coordinate lies behind the globe, under terrain or beyond the horizon at a steep
  pitch. Swift reports changes through `onVisibilityChanged` and `isHidden`; Kotlin through
  `TileflowViewAnnotationUpdatedListener`.
- **Size**: the view's own size, or the size it needs when it has none. Swift's
  `setNeedsUpdateSize()` measures it again; Kotlin options take an explicit `width` and `height`.
- **Units**: points in Swift. On Android, pixels for `TileflowMapView` and dp through
  `TileflowMapController`, as in the rest of each API.

### How views follow the map

The renderer reports the screen position of every view annotation's coordinate after each frame it
draws that moves one of them, in one message for all of them. The SDK applies the newest positions
at the next display refresh (`CADisplayLink` on iOS, `Choreographer` on Android) and places the
views there. It does not interpolate between renderer frames: the renderer draws the map at the
display's rate, and a view between two positions would be between where the map was and where it
is.

The budget is at most one display frame of lag behind the map on iOS and two on Android, from the
frame the renderer draws to the refresh that places the views. Measured with 200 view annotations
during repeated pans of one view width in 0.5 seconds:

| Platform                                  | p50                    | p95                           | Maximum            |
| ----------------------------------------- | ---------------------- | ----------------------------- | ------------------ |
| iOS, Mac Catalyst                         | 8.4–8.8 ms (0.5 frame) | 9.3–9.5 ms (0.6 frame)        | 9.8 ms (0.6 frame) |
| Android emulator, API 36, arm64, host GPU | 15.6–17.5 ms (1 frame) | 31.5–41.2 ms (1.9–2.5 frames) | 33–96 ms           |

The measure does not include the compositor's own latency, which the map and the views share.
Emulators and Mac Catalyst are not phones; physical devices are still to be measured.

## Accessibility

Annotations with an `accessibilityLabel` and view annotations are reachable with VoiceOver and
TalkBack, in reading order: top to bottom, then from the leading edge. View annotations bring the
accessibility of the application's own views.

- **iOS**: each labelled annotation is a button. Activating it runs its tap handler, and when it has
  a long press handler, the "Long press" action runs that. The map adds an "Annotations" rotor that
  moves between them in the same order.
- **Android**: each labelled annotation is a node that TalkBack clicks and long-clicks, which runs
  the manager's click and long-click listeners.

The SDK reads the positions of labelled annotations from the renderer only while VoiceOver, Switch
Control or a touch exploration service runs.

## Themes and new renderers

Annotation managers are part of the application's runtime style, so a theme change keeps them and a
new renderer receives them, with dragged annotations where they were dropped. View annotations stay
on screen and take their positions from the new renderer.

## Limits

| Limit                                                                                                     | Value                                               |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Tracked coordinates: shown view annotations, plus labelled annotations while an assistive technology runs | 2048                                                |
| Annotation managers                                                                                       | 256, sharing the runtime style's sources and layers |

## Differences from the Mapbox Maps SDKs

| Mapbox                                                                                        | Tileflow                                                         | Why                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A drag begin handler or listener can refuse the drag.                                         | It is told of the drag; `isDraggable` decides.                   | The renderer starts the drag in the same frame as the touch, before the application could answer.                     |
| On iOS a long press starts a drag.                                                            | A pan that starts on the annotation drags it, on both platforms. | One gesture on both platforms, and the long press stays free for `longPressHandler`.                                  |
| Point annotations carry text fields.                                                          | Not available yet.                                               | Labels need the map's fonts for each theme; a view annotation can show text meanwhile.                                |
| `layerPosition`                                                                               | `slot` and `position`                                            | The map's own layer identifiers are not part of the API; see [where layers go](native-style-data.md#where-layers-go). |
| No accessibility for annotations.                                                             | `accessibilityLabel`, reading order, rotor and actions.          | Annotations drawn by the map are otherwise invisible to VoiceOver and TalkBack.                                       |
| View annotations with `minZoom`, `maxZoom`, puck avoidance, feature anchors and a Kotlin DSL. | Coordinates only; a data class of options in Kotlin.             | Not offered yet.                                                                                                      |
