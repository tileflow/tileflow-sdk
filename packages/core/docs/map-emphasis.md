# Map emphasis

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

An application that draws its own content over a Tileflow map, such as a route, a selected place, or
search results, often needs the map to step back so that content reads first. Map emphasis does
that on the map's own MapLibre instance: chosen modules recede towards the map's ground colour, and
the map's labels and icons fade, except inside an area the application keeps at full strength. The
change eases in and out, stays when the theme changes, and follows a theme blend.

Emphasis needs a browser document and MapLibre GL JS. It changes only the layers a Tileflow map
compiled, so an application's own layers, such as the route it draws, keep their appearance.

## Show an emphasis

Create the theme controller for the map, then ask for an emphasis. This example assumes an existing
MapLibre map named `map` that shows the `dark` theme of a published Tileflow map, and a route the
application has already drawn:

```ts
import type {Map as MapLibreMap} from 'maplibre-gl';
import {createTileflowThemeController} from '@tileflow/core/browser';

export function focusOnRoute(map: MapLibreMap, styleUrl: string) {
  const controller = createTileflowThemeController({
    initial: {style: styleUrl, theme: 'dark'},
    map,
  });
  void controller.setEmphasis(
    {
      labels: 0.6,
      recede: {boundaries: 0.55, roads: 0.5, transit: 0.5},
    },
    {transition: {duration: 560}},
  );
  return () => controller.setEmphasis(undefined, {transition: {duration: 560}});
}
```

Roads, transit, and boundaries move halfway or a little more towards the ground colour, labels and
icons keep 60 % of their opacity, and the change eases in over 560 milliseconds. Calling
`setEmphasis(undefined)` eases the map back to its design. Each call supersedes the previous one;
the promise of a superseded call resolves with `status: 'superseded'`.

## Choose what steps back

- `recede` maps module names to an amount from 0 (as designed) to 1 (the ground colour itself). The
  modules are the semantic domains a map compiles, such as `roads`, `transit`, `boundaries`,
  `water`, `land`, `buildings`, and `vegetation`. Every colour of a receding layer moves towards the
  ground colour, including the colours inside zoom curves and data cases. Artwork that cannot be
  recoloured, such as a pattern, fades by the same amount instead.
- `labels` is the share of their opacity that the map's labels and icons keep, from 0 to 1.
- `keep` is a GeoJSON `Polygon` or `MultiPolygon`. Labels and icons whose features fall inside it
  keep their full strength. It can hold up to 4,096 positions. A corridor round a route is a
  typical keep area.

The ground colour is the map's background colour. During a blend it is the blended background, so
receding colours follow the hour as the blend moves.

## How it changes over time

Values that depend only on the camera, such as a colour or an opacity with a zoom curve, ease every
frame. A value that MapLibre evaluates per feature, such as a road colour chosen by class or any
label opacity once a keep area is given, would make MapLibre lay its source out again on every
change. Such values change once, at the start of the change, under a snapshot of the map that fades
out as the transition runs. When the browser asks for reduced motion, every change happens at once.

An emphasis stays through `setTheme` and `setBlend`: after a new style is applied, the emphasis is
written again under the same cross-fade, and each blend position recomputes the receded colours.

## How it finds modules

Every compiled layer names its semantic module in its metadata:

```json
{"id": "tileflow-road-major-fill", "metadata": {"tileflow:domain": "roads"}}
```

Layers that a theme blend splits or copies keep the same entry. Applications can read the key from
`tileflowLayerDomainMetadataKey` in `@tileflow/core/browser`. Physical layer IDs remain diagnostic;
use the module name instead. Styles compiled before this metadata existed have no module names, so
an emphasis leaves them unchanged.

## Cost

Each eased frame writes only the values that changed, with `setPaintProperty` and without
validation. For a detailed city map with roads, transit, and boundaries receding, that is about 150
values a frame on a desktop computer. Writing values directly is faster than reading a MapLibre
global state from every value, because a global state change re-evaluates every layer that reads it.
