# Tileflow map features on Swift and Kotlin

The Swift (`Tileflow`) and Kotlin (`dev.tileflow:tileflow`) map SDKs show Tileflow maps through an
embedded renderer that runs the same Core and MapLibre GL JS as the web SDKs. This guide lists the
map features of the web SDKs (`@tileflow/react`, `@tileflow/vue`, `@tileflow/svelte` and
`@tileflow/core/browser`) and how each is offered on iOS and Android. It describes the source in this
repository; no native release has been published yet.

Every call below exists on `TileflowMapView` (UIKit, Android View) and on `TileflowMapController`
(SwiftUI `TileflowMap`, Compose `TileflowMap`). Swift calls are `async throws`; Kotlin calls are
`suspend` functions. Durations are seconds (`TimeInterval`) in Swift and milliseconds in Kotlin. No
public type belongs to WebKit, Android WebView or MapLibre GL JS.

The view keeps what the application asked for, and a new renderer, for example after the system
ended the renderer's process, receives it again: content, theme, options, sun, emphasis, style
states, Boundaries values, images, depth markers, the application's runtime style, the latest
location and the follow mode. Animations end with their renderer.

## Always on

These features need no call. They follow the map's style, as on the web.

| Web                                                                                   | iOS and Android                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Style notices (`attachTileflowNotices`)                                               | Shown in the attribution corner, for example Nautical's "Not for navigation".  |
| Fair-use notice for World tiles                                                       | Shown when World tiles ask for it.                                             |
| Nautical lights flash in their rhythm                                                 | On.                                                                            |
| 3D label placement                                                                    | On.                                                                            |
| Atmosphere and sky                                                                    | On.                                                                            |
| The 3D scene a style declares (buildings, landmarks and models, trees, street lights) | Mounted only when the style declares it, through Core's `attachTileflowMap3D`. |
| Pitch up to 85°                                                                       | Up to 85°.                                                                     |

## Options and calls

| Web                                                 | Swift                                                        | Kotlin                                                      |
| --------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `viewMode` (`2d`, `3d`)                             | `TileflowMapOptions.viewMode`                                | `TileflowMapOptions.viewMode`                               |
| Buildings rising with a transition                  | `setViewMode(_:duration:)`                                   | `setViewMode(mode, durationMillis)`                         |
| `vegetation`                                        | `TileflowMapOptions.vegetation` (nil: as designed)           | `TileflowMapOptions.vegetation` (null: as designed)         |
| `mapOptions.canvasContextAttributes.antialias` (on) | `TileflowMapOptions.antialias` (on)                          | `TileflowMapOptions.antialias` (on)                         |
| `mapOptions.validateStyle` (off)                    | `TileflowMapOptions.validatesStyle` (off)                    | `TileflowMapOptions.validatesStyle` (off)                   |
| Themes, `system` and theme blends                   | `theme`, `setTheme`, `setBlend`                              | `theme`, `setTheme`, `setBlend`                             |
| `onThemeChange` phases                              | `TileflowMapEvent.themeTransition`                           | `TileflowMapEvent.ThemeTransition`                          |
| `setSun` by direction or date and place             | `setSun(.direction(…))`, `setSun(.date(…, location:))`       | `setSun(TileflowSun.Direction(…))`, `TileflowSun.AtDate`    |
| `setEmphasis` (recede, labels, keep area)           | `setEmphasis(TileflowEmphasis(…))`                           | `setEmphasis(TileflowEmphasis(…))`                          |
| `setState` (global style state)                     | `setStyleState(_:to:duration:)`                              | `setStyleState(name, value, durationMillis)`                |
| `getRouteInks`                                      | `routeInks()`; ready transitions carry them                  | `routeInks()`; ready transitions carry them                 |
| `useBoundaryFeatureState` / `boundaryFeatureState`  | `setBoundaryValues(TileflowBoundaryValues(ids:))`            | `setBoundaryValues(TileflowBoundaryValues.byIds(…))`        |
| `registerImage` (dynamic style images)              | `setImages`, `addImage`, `removeImage`; `sdf: true`          | `setImages`, `addImage`, `removeImage`; `sdf = true`        |
| `createTileflowDepthMarkers`                        | `setDepthMarkers([TileflowDepthMarker])`                     | `setDepthMarkers(listOf(TileflowDepthMarker))`              |
| `createTileflowGroundLayers`                        | `TileflowGeoJSONLayer(placement: .ground, occludedOpacity:)` | `TileflowGeoJSONLayer(placement = GROUND, occludedOpacity)` |
| Route layers in the theme's inks                    | `TileflowGeoJSONLayer(ink:)`                                 | `TileflowGeoJSONLayer(ink = …)`                             |
| `createTileflowLineProgress`                        | `TileflowGeoJSONLayer(progress:)`, `animateLineProgress`     | `TileflowGeoJSONLayer(progress = …)`, `animateLineProgress` |
| `playTileflowShot` with blends and cues             | `play(_:onCue:)`                                             | `play(shot, onCue)`                                         |
| `GeolocateControl` and the Geolocation API          | `TileflowMapOptions.location`, `followMode`                  | `TileflowMapOptions.location`, `followMode`                 |

## Runtime style and data

The web SDKs give the application MapLibre GL JS's own map for its sources, layers and queries. The
Swift and Kotlin SDKs offer the same through a typed runtime style, described in
[runtime style, data and queries](native-style-data.md).

| Web (MapLibre GL JS map)                                              | Swift and Kotlin                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `addSource` with `geojson`, `vector`, `raster`, `raster-dem`, `image` | `addSource` with `TileflowGeoJSONSource`, `TileflowVectorSource`, `TileflowRasterSource`, `TileflowRasterDEMSource`, `TileflowImageSource` |
| `GeoJSONSource.setData`, `updateData`                                 | `setGeoJSONSourceData`, `addGeoJSONSourceFeatures`, `updateGeoJSONSourceFeatures`, `removeGeoJSONSourceFeatures`                           |
| `addLayer` of any layer type, `setPaintProperty`, `setFilter`         | `addLayer` of a generated layer type, `updateLayer`, `moveLayer`, `removeLayer`                                                            |
| `addLayer(layer, beforeId)` with the map's layer identifiers          | `slot` among the map's layers, and `above` or `below` another application layer                                                            |
| Expressions as JSON                                                   | `TileflowExpression` factories for every operator, or `TileflowExpression(json:)` / `fromJson`                                             |
| `setFeatureState`, `getFeatureState`, `removeFeatureState`            | `setFeatureState`, `featureState`, `removeFeatureState`                                                                                    |
| `queryRenderedFeatures`, `querySourceFeatures`                        | `queryRenderedFeatures` (point, box, polygon, view), `querySourceFeatures`                                                                 |
| `getClusterChildren`, `getClusterLeaves`, `getClusterExpansionZoom`   | `clusterChildren`, `clusterLeaves`, `clusterExpansionZoom`                                                                                 |
| `addImage` with `sdf`                                                 | `addImage(TileflowMapImage(…, sdf: true))`                                                                                                 |

A layer drawn with a route ink follows theme changes and blends; the glow and core inks also take
the theme's opacity for them, so a theme without a glow hides that layer. The Routing helpers in
`TileflowServiceContent` / `dev.tileflow:tileflow-service-content` build route and isochrone layers
this way (see [native services](native-services.md)).

`animateLineProgress` and `play` return whether the animation got where it was going (`true`) or was
stopped first (`false`), and they may last longer than other calls: up to 60 seconds for line
progress and an hour for a shot. Cancelling the calling task or coroutine stops them where they are.
A person's gesture or a new shot stops a playing shot. A shot reports the camera's movement once,
with the reason `api`, rather than once per frame.

## Differences and why

| Web                                                                                                   | iOS and Android                                                                                                                               | Why                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dynamic image's `render` callback draws pixels each time the theme, blend or a style state changes. | An image with a variant per theme, replaced with `setImages`.                                                                                 | The callback is application code that would run on every change, across the bridge to native code. Per-theme variants cover the common case without a round trip per frame.                     |
| `joinBoundaryRows` joins rows by ISO codes, NUTS or Wikidata with the release's lookup table.         | Rows keyed by the polygons' `id`, or `ref` where the map promotes it.                                                                         | The lookup table belongs to a Boundaries release and is large. Join rows where the data is prepared, for example on a server, then pass IDs.                                                    |
| Line progress accepts any line layer, head and light lengths and an easing function.                  | Line progress on the application's GeoJSON line layers, with Core's default head and light (4% of the line) and its smooth easing.            | Authored style layers are not addressable by the application, and easing functions are application code. Head and light lengths are not offered yet.                                            |
| Ground layers accept any MapLibre layer, including custom ones.                                       | GeoJSON circle, line and fill layers; the runtime style places any layer type in a slot.                                                      | Ground layers keep their own place under the 3D scene. The runtime style's slots, such as `aboveBuildings`, cover the other placements for every layer type.                                    |
| Layers go before any layer of the map, by its identifier.                                             | Layers go in a slot of the map, or above or below another application layer.                                                                  | The map's layer identifiers are internal and change between releases; slots keep the same meaning in every theme and map.                                                                       |
| Queries can read the map's own layers.                                                                | Queries of the runtime style read the application's layers; `query(at:)` reads the map's.                                                     | The map's own layers are not part of the application's API. Points of interest are reported as activations instead.                                                                             |
| Custom layers draw with the page's WebGL context.                                                     | Not available.                                                                                                                                | Custom layers are application JavaScript; the SDKs run no application code in the renderer.                                                                                                     |
| Depth markers take any texture source.                                                                | A named application image; markers keep its default variant across themes.                                                                    | Images cross the bridge once by name and are shared by every marker that shows them.                                                                                                            |
| Shot cues run inside the frame that reaches them.                                                     | `onCue` runs on the main thread just after the renderer reaches the cue.                                                                      | Cues are application code; they run on the native side, one message after the frame.                                                                                                            |
| The 3D renderers load with a dynamic import when a style first declares 3D.                           | The renderers are part of the embedded renderer, read from the application, and mount only when a style declares 3D.                          | Nothing is downloaded at run time; the renderer's code ships with the SDK. Loading its 3D part separately is a size and start-up optimisation of the embedded bundle, not a feature difference. |
| `onLoad(map)` and `mapOptions` give the MapLibre GL JS map.                                           | Not available.                                                                                                                                | The SDKs expose no WebView or MapLibre GL JS types, so a native renderer can replace the embedded one without breaking applications.                                                            |
| `GeolocateControl` draws the browser's position and follows it; the application asks for it.          | A puck drawn by the renderer, follow modes, a default location provider and permission helpers; see [the location guide](native-location.md). | Native applications expect a map SDK to show and follow the location, and the camera and the puck move together only when the renderer drives both.                                             |
| `mode: 'image'` shows a static image of the map.                                                      | Not available yet.                                                                                                                            | A native snapshot of the map is planned.                                                                                                                                                        |
