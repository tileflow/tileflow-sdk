# Interactions reference: clusters, heatmaps, and drawing

Public contracts for grouping application points and drawing on a mounted map. Option and layer
names follow the [MapLibre style specification](https://maplibre.org/maplibre-style-spec/) and match
Mapbox: `cluster`, `clusterRadius`, `clusterMaxZoom`, `clusterMinPoints`, `clusterProperties`,
`point_count`, `point_count_abbreviated`, and `cluster_id`.

## Choose a path

| Data                                     | Use                                                     | Limit                          |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| Up to 1,000 points with popups           | `annotations` with `annotationClusters`                 | 1,000 annotations              |
| Thousands of points, filtered at runtime | `dataSources` with `dataOverlays`                       | MapLibre's GeoJSON worker      |
| Fixed points or a design in config       | `geojsonSource()` and `clusterOverlay()` in `defineMap` | 512,000 bytes inline, or a URL |
| Density of points                        | `heatmapOverlay()` over GeoJSON or a vector tileset     | Vector tilesets cannot cluster |

## Runtime data

`dataSources` and `dataOverlays` take the same values as `sources` and `overlays` in `defineMap`, so
a map on an official style needs no config. Import the helpers from `@tileflow/core/runtime`.

<!-- docs:check -->

```ts
import {clusterOverlay, geojsonSource, heatmapOverlay} from '@tileflow/core/runtime';

const data = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'store-42',
      geometry: {type: 'Point', coordinates: [-3.7038, 40.4168]},
      properties: {name: 'Sol', revenue: 1200},
    },
  ],
} as const;

export const dataSources = {
  stores: geojsonSource({
    cluster: true,
    clusterProperties: {revenue: ['+', ['get', 'revenue']]},
    clusterRadius: 50,
    data,
  }),
};

export const dataOverlays = {
  demand: heatmapOverlay({id: 'demand', placement: 'below-labels', source: 'stores'}),
  stores: clusterOverlay({id: 'stores', placement: 'above-labels', source: 'stores'}),
};
```

Pass both to the map component of `@tileflow/react`, `@tileflow/vue`, or `@tileflow/svelte`:

- A key the compiled style already declares is filled with `setData` and keeps its compiled options.
  An overlay layer the style already draws keeps its compiled form.
- A key the style does not declare is added at the overlay's semantic `placement`. Sources and
  overlays return after a theme change.
- New `data` replaces the source's contents. Keep the value stable between renders, because each new
  reference is sent to the worker. Changing a cluster option rebuilds the source.
- Pass plain data. Svelte `$state` proxies cannot reach a worker, so use `$state.raw`.
- Remove a key to remove what it added.

A problem is reported through the interaction diagnostic callback with code `INVALID_DATA_LAYER`
and a JSON Pointer such as `/dataOverlays/stores/source`.

## Cluster overlays

`clusterOverlay({id, source, placement})` draws three layers: `<id>-clusters`, `<id>-cluster-count`,
and `<id>-points`. Options are `colors`, `radii`, `steps`, `pointColor`, `textColor`, `font`, and
`expandOnClick`. The count uses the map's label font unless `font` names another stack. For anything
else, write the layers with `maplibreOverlay()` and the same `point_count` expressions.

Web adapters find these layers through their metadata, in compiled and runtime styles alike:

- Clicking or tapping a bubble eases to `getClusterExpansionZoom()` unless `expandOnClick` is false.
- The interaction event callback receives `target:activate` with a `cluster` target: `clusterId`,
  `coordinate`, `pointCount`, `properties`, and `source`.
- A separate point arrives as a `style-feature` target with its `feature.id` and `properties`.
- A click a cluster takes does not also open a semantic POI below it.

Read a cluster's members from the map with `map.getSource(source).getClusterLeaves(clusterId)`.
Points at one coordinate separate only above `clusterMaxZoom`, so keep that below the map's maximum
zoom. Tileflow clusters are WebGL features and cannot take keyboard focus: use annotation clusters,
or a list beside the map, when each point must be reachable by keyboard.

## Annotation clusters

```tsx
<Map annotations={stores} annotationClusters={{clusterRadius: 60}} source={source} />
```

`annotationClusters` accepts `clusterRadius`, `clusterMaxZoom`, `clusterMinPoints`, `expandOnClick`,
and `formatAriaLabel(count)`. Each group is a real `button.tileflow-interaction-cluster`, so it takes
focus and Enter, and the map needs no glyphs or extra source. The default accessible name is
`12 places`; localize it with `formatAriaLabel`. Set the colour with
`--tileflow-interaction-cluster-color`, or restyle the class.

The `cluster` target also carries `annotationIds`. A marker hidden by a cluster keeps its annotation
and state. An open popup keeps its marker visible. Focus moves to the map when the button pressed
is replaced.

## Heatmaps

`heatmapOverlay({id, source, placement})` accepts `weight`, `radius`, `intensity`, `opacity`,
`colors`, `maxZoom`, and `sourceLayer`. `weight`, `radius`, `intensity`, and `opacity` also take
MapLibre expressions. Use `maxZoom` with a cluster overlay to hand over from density to points.
Put heatmaps at `below-labels` so that labels stay readable.

## Polygon drawing

Tileflow does not include a drawing tool. Use [Terra Draw](https://terradraw.io) (MIT): vertex
editing, snapping, touch, and self-intersection rules are a product of their own, and Terra Draw
keeps them maintained behind a MapLibre adapter. The map component already gives you the map.

```sh
npm install terra-draw terra-draw-maplibre-gl-adapter
```

```tsx
import {TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode} from 'terra-draw';
import {TerraDrawMapLibreGLAdapter} from 'terra-draw-maplibre-gl-adapter';

// A theme change replaces the style, so keep Terra Draw's own sources and layers.
const mapOptions = {
  transformStyle(previous, next) {
    if (!previous) return next;
    const keep = (id) => id.startsWith('td-');
    return {
      ...next,
      layers: [...next.layers, ...previous.layers.filter(({id}) => keep(id))],
      sources: {
        ...next.sources,
        ...Object.fromEntries(Object.entries(previous.sources).filter(([id]) => keep(id))),
      },
    };
  },
};

<Map
  mapOptions={mapOptions}
  onLoad={(map) => {
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({map}),
      modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()],
    });
    draw.start();
    draw.setMode('polygon');
    draw.on('finish', (id) => savePolygon(draw.getSnapshotFeature(id)));
  }}
  source={source}
/>;
```

The result is GeoJSON, which `geojsonSource()` can draw and an API can store. Create Terra Draw once
per map, in `onLoad` (Vue `@load`, Svelte `on:load`), and call `draw.stop()` before unmounting.

## Support by surface

| Capability                                | React, Vue, Svelte | `tileflow preview`, `capture` | React Native |
| ----------------------------------------- | ------------------ | ----------------------------- | ------------ |
| Compiled GeoJSON clusters and heatmaps    | Yes                | Yes                           | Yes          |
| Click or tap to expand a compiled cluster | Yes                | No                            | Yes          |
| `dataSources`, `dataOverlays`             | Yes                | No                            | Yes          |
| `annotationClusters`                      | Yes                | No                            | Yes          |
| Terra Draw                                | Yes                | No                            | No           |

`mode="image"` draws no runtime layers and reports `UNSUPPORTED_MODE`.

React Native takes the same three props and reports the same `cluster` and `style-feature` targets
through `onInteractionEvent`. It differs in four ways:

- Data reaches MapLibre React Native's own `GeoJSONSource`, which reuses a compiled source of the
  same ID and returns after a theme change. A reused source keeps its compiled cluster options.
- A tapped point reports the first point layer of its source as `layerId`.
- A map with a controlled `view` reports the cluster but does not move the camera, because the
  application owns the view. Use the target's coordinate to set it.
- Annotation clusters are native buttons with `accessibilityRole="button"`, grouped by the same
  `createTileflowAnnotationClusterIndex` as the web, so both platforms split at the same zooms.

Terra Draw is a GL JS library and has no native equivalent here.

Direct MapLibre consumers use `createTileflowMapLibreDataRuntime` from
`@tileflow/interactions/maplibre`.
