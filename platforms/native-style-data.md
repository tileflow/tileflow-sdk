# Runtime style, data and queries on Swift and Kotlin

The Swift (`Tileflow`) and Kotlin (`dev.tileflow:tileflow`) map SDKs let an application add its own
sources and layers to a Tileflow map, update its data feature by feature, keep state per feature,
cluster points and query what the map draws. The API follows the runtime styling of the Mapbox Maps
SDKs: sources and layers are typed objects whose properties take a constant or an expression. Every
layer type of the MapLibre style specification is available, with all of its layout and paint
properties.

This guide describes the source in this repository; no native release has been published yet.

Every call exists on `TileflowMapView` (UIKit, Android View) and on `TileflowMapController` (SwiftUI
`TileflowMap`, Compose `TileflowMap`) with the same name. Swift calls are `async throws`; Kotlin calls
are `suspend` functions. No public type belongs to WebKit, Android WebView or MapLibre GL JS.

## Sources

| Type                      | MapLibre source | Data                                                                        |
| ------------------------- | --------------- | --------------------------------------------------------------------------- |
| `TileflowGeoJSONSource`   | `geojson`       | GeoJSON text, a list of `TileflowFeature`, an address, or empty; clustering |
| `TileflowVectorSource`    | `vector`        | TileJSON address or tile templates                                          |
| `TileflowRasterSource`    | `raster`        | TileJSON address or tile templates                                          |
| `TileflowRasterDEMSource` | `raster-dem`    | Elevation tiles for hillshade and colour relief layers                      |
| `TileflowImageSource`     | `image`         | An image laid on four corners                                               |

Inline GeoJSON travels to the renderer over the SDK's data channel, not in a message: up to 32 MiB
per source and 64 MiB in flight per map. The renderer checks it against RFC 7946 before the map
receives it. Addresses go through the SDK's own transport, so their origins must be listed in the
map source's `resourceOrigins`, or in `publicResourceOrigins` for a Hosted map.

```swift
try await map.addSource(
  TileflowGeoJSONSource(
    id: "places", data: .geoJSON(geoJSON), cluster: true, clusterRadius: 50,
    clusterProperties: ["visitors": .sum(.get("visitors"))]))
```

```kotlin
map.addSource(
    TileflowGeoJSONSource(
        "places",
        TileflowGeoJSONData.GeoJSON(geoJSON),
        cluster = true,
        clusterRadius = 50.0,
        clusterProperties =
            mapOf("visitors" to TileflowExpression.sum(TileflowExpression.get("visitors"))),
    )
)
```

### Updating features one by one

`addGeoJSONSourceFeatures`, `updateGeoJSONSourceFeatures` and `removeGeoJSONSourceFeatures` change
features by identifier without sending the rest of the source again. Each feature needs an
identifier, or the source needs a `promoteId`. An identifier that is a whole number, such as `"42"`,
travels as a number, which the map needs to keep feature state for it. `setGeoJSONSourceData`
replaces all of a source's data. A source loaded from an address cannot be updated feature by
feature; replace its data instead.

The SDK keeps each source's data and the updates since, so a new renderer receives the same
features. Once the updates outweigh the data they change, the SDK folds them into new data in the
background.

## Layers

The SDK generates one layer type per MapLibre layer type, with every layout and paint property of
the style specification that the embedded MapLibre GL JS implements:

| Swift and Kotlin             | MapLibre layer   |
| ---------------------------- | ---------------- |
| `TileflowFillLayer`          | `fill`           |
| `TileflowLineLayer`          | `line`           |
| `TileflowSymbolLayer`        | `symbol`         |
| `TileflowCircleLayer`        | `circle`         |
| `TileflowHeatmapLayer`       | `heatmap`        |
| `TileflowFillExtrusionLayer` | `fill-extrusion` |
| `TileflowRasterLayer`        | `raster`         |
| `TileflowHillshadeLayer`     | `hillshade`      |
| `TileflowColorReliefLayer`   | `color-relief`   |
| `TileflowBackgroundLayer`    | `background`     |

A property's name is its MapLibre name in camel case: `circle-radius` is `circleRadius`. Properties
that change smoothly also have a transition, such as `circleRadiusTransition`. Enumerated values are
generated types, such as `TileflowLineCap`.

```swift
var clusters = TileflowCircleLayer(id: "clusters", source: "places")
clusters.filter = .has("point_count")
clusters.circleRadius = .expression(.step(.get("point_count"), 16, 100, 22, 750, 30))
clusters.circleColor = "#51bbd6"
clusters.slot = .aboveLabels
try await map.addLayer(clusters)
```

```kotlin
val count = TileflowExpression.get("point_count")
map.addLayer(
    TileflowCircleLayer("clusters", "places")
        .filter(TileflowExpression.has("point_count"))
        .circleRadius(
            TileflowExpression.step(
                count,
                TileflowExpression.literal(16.0),
                TileflowExpression.literal(100.0),
                TileflowExpression.literal(22.0),
            )
        )
        .circleColor(TileflowColor.fromHex("#51bbd6"))
        .slot(TileflowLayerSlot.ABOVE_LABELS)
)
```

`updateLayer` replaces a layer's definition in place; only the properties that changed reach the
map. `moveLayer` and `removeLayer` take the layer's identifier; `layerExists` and `sourceExists`
answer without a call to the renderer.

### Expressions

`TileflowExpression` has a factory for every operator of the MapLibre style specification, named
after it in camel case: `get`, `match`, `step`, `interpolate`, `featureState` and so on. Operators
that are symbols or keywords use the names of the Mapbox Maps SDKs on both platforms: `sum` (`+`),
`product` (`*`), `subtract` (`-`), `division` (`/`), `mod` (`%`), `pow` (`^`), `eq` (`==`), `neq`
(`!=`), `gt`, `lt`, `gte`, `lte`, `not` (`!`), `switchCase` (`case`), `inExpression` (`in`),
`letExpression`, `varExpression`, `objectExpression` and `typeofExpression`. Interpolations are
`linear()`, `exponential(…)` and `cubicBezier(…)`.

Swift accepts literals as expressions: `.eq(.get("kind"), "cafe")`. Kotlin uses
`TileflowExpression.literal(…)`. Lists are literals of their own: `.literal(["a", "b"])`. Any
MapLibre expression in JSON form also works: `TileflowExpression(json:)` in Swift and
`TileflowExpression.fromJson` in Kotlin.

### Where layers go

A layer's `slot` places it among the map's own layers. Every Tileflow map resolves the slots to its
own layers in each theme, so a layer keeps its place when the theme changes:

| Swift            | Kotlin            | Lies                                             |
| ---------------- | ----------------- | ------------------------------------------------ |
| `aboveWater`     | `ABOVE_WATER`     | Above water, under roads                         |
| `belowRoads`     | `BELOW_ROADS`     | Under roads                                      |
| `aboveRoads`     | `ABOVE_ROADS`     | Above roads, under buildings                     |
| `aboveBuildings` | `ABOVE_BUILDINGS` | Above buildings, including 3D ones, under labels |
| `belowLabels`    | `BELOW_LABELS`    | Under labels                                     |
| `aboveLabels`    | `ABOVE_LABELS`    | Above labels                                     |
| none             | none              | Above the whole map                              |

Within a slot, layers keep the order the application gives them. `addLayer` and `moveLayer` take a
position relative to another application layer, above or below it; the layer then takes that layer's
slot. A style that does not declare Tileflow's placements puts every slot but `aboveLabels` under its
first label layer.

The map's own layers are not addressable by identifier, so their internal names never become part of
an application.

## Images

`addImage` and `removeImage` change the application's images one at a time; `setImages` replaces
them all. An image can have a variant per theme, and `sdf: true` marks a signed distance field, which
symbol layers recolour with `iconColor` and `iconHaloColor`. Symbol layers name images in
`iconImage`, and fill and line layers name patterns in `fillPattern` and `linePattern`.

## Clusters

A clustering GeoJSON source draws clusters as features with `point_count`, `point_count_abbreviated`
and `cluster_id`, plus the source's `clusterProperties`. `TileflowFeature.clusterId` reads the
identifier that cluster queries take:

- `clusterExpansionZoom`: the zoom at which a cluster splits;
- `clusterChildren`: the clusters and points one level below it;
- `clusterLeaves`: its points, with a limit and an offset.

```swift
let hits = try await map.queryRenderedFeatures(
  in: .point(touch.point), options: .init(layerIds: ["clusters"]))
if let cluster = hits.first?.feature.clusterId {
  let zoom = try await map.clusterExpansionZoom(sourceId: "places", clusterId: cluster)
  try await map.ease(to: TileflowCameraUpdate(zoom: zoom))
}
```

## Feature state

`setFeatureState` merges values into a feature's state, which layers read with `featureState`.
`featureState` returns what the application set, and `removeFeatureState` removes a key, a feature's
state or a whole source's. A vector source needs the feature's `sourceLayer`. Feature state survives
theme changes and a new renderer.

## Queries

`queryRenderedFeatures` returns the features the application's layers draw at a point, in a box, in
a polygon or in the whole view, topmost first, with a filter and a limit of up to 100 000 features.
`querySourceFeatures` returns a source's features in the tiles the map has loaded, drawn or not; a
feature that crosses tiles is returned once when it has an identifier. Each result is a
`TileflowQueriedFeature`: the feature with its identifier, typed geometry and properties
(`TileflowGeometry`, `TileflowJSON`), and its source, source layer, layer and state.

Geometries are in points of the view in Swift. On Android they are in pixels for `TileflowMapView`
and in dp for `TileflowMapController`, as in the rest of each API.

From a pitch of 60°, the renderer reads boxes, polygons and the whole view in bands of 64 CSS
pixels: MapLibre GL JS misses features near the horizon when one query reaches far into the
distance, and bands of the same area find them.

## Themes and new renderers

The application's sources, layers, images and feature state are kept apart from the map's own
style. When the theme changes, the renderer puts them back, in their slots, before the new style
draws. When the system ends the renderer's process, or the application calls `reload`, the view
gives the new renderer the same sources with their data and updates, the layers in order, the images
and the feature state.

## Limits

| Limit                           | Value                               |
| ------------------------------- | ----------------------------------- |
| GeoJSON of one source or update | 32 MiB                              |
| Data in flight per map          | 64 MiB                              |
| Application sources             | 256                                 |
| Application layers              | 1024                                |
| Application images              | 64                                  |
| Features in one query result    | 100 000, and at most 32 MiB of JSON |

A request whose description exceeds a protocol message, such as a filter that lists thousands of
identifiers, also travels over the data channel. A result larger than a message is read in parts.
Requests beyond a limit fail with `invalidRequest` and the reason `dataTooLarge`. A request MapLibre
refuses, such as a paint value of the wrong type, fails with `invalidRequest` and MapLibre's message,
which names the application's layer, and changes nothing.
