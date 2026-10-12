# Route drawing

An application that draws a route on a Tileflow map can take the route's colours from the theme and
draw the line on with a moving head. Themes set route inks; the theme controller returns them for
the theme on screen; `createTileflowLineProgress` animates a group of line layers along their
length.

## Set route inks in a theme

Route inks are optional theme tokens. A theme that sets none uses defaults for its colour scheme:
a blue line on a dark edge for light themes, a lighter blue with a glow and a bright core for dark
themes.

| Token                | Kind   | Use                                                   |
| -------------------- | ------ | ----------------------------------------------------- |
| `route.line`         | colour | The chosen route.                                     |
| `route.casing`       | colour | The edge each side of the line, apart from the roads. |
| `route.core`         | colour | A thin line along the middle.                         |
| `route.glow`         | colour | A soft halo around the route.                         |
| `route.alternative`  | colour | Other routes offered beside the chosen one.           |
| `route.glow.opacity` | number | The halo's opacity, from 0 (none) to 1.               |
| `route.core.opacity` | number | The core's opacity, from 0 (none) to 1.               |

Every theme of a map carries the same tokens, so a map that sets route inks sets them in each of
its themes:

<!-- docs:check -->

```ts
import {defineTheme, type TileflowTheme} from '@tileflow/core';

export function withNeonRoute(base: TileflowTheme, id: string): TileflowTheme {
  return defineTheme(base, {
    id,
    version: 1,
    colorScheme: base.colorScheme,
    tokens: {
      color: {
        'route.line': '#ff4fae',
        'route.casing': '#0b0f12',
        'route.core': '#ffe0f0',
        'route.glow': '#ff4fae',
      },
      number: {'route.glow.opacity': 0.55, 'route.core.opacity': 0.9},
    },
  });
}
```

The compiler publishes the resolved inks in the style's `tileflow:route` metadata.
`readTileflowRouteInks(style.metadata)` reads them from a style document;
`tileflowStyleRouteInks(style)` also falls back on the defaults for a style compiled without them.

## Draw a route in the theme's inks

The theme controller's `getRouteInks()` returns the inks of the theme on screen. During a blend it
mixes them between the neighbouring themes at the blend's position, in the same colour space as
the map's own colours. Read them again after `setTheme` or `setBlend`.

`createTileflowLineProgress(map, {layers})` owns the `line-gradient` and `line-opacity` of a group of
line layers. Their source must be GeoJSON with `lineMetrics: true`. The controller shows the line
from `start` to `end` (shares of its length), a highlight at the head while the line is being drawn,
and an optional light at `light`. It writes only what changed, paints a layer again when a style
change re-creates it, and skips layers that are not on the map.

This example assumes an existing MapLibre map named `map` whose style already holds four line
layers over a GeoJSON source with `lineMetrics: true`:

<!-- docs:check -->

```ts
import {
  createTileflowLineProgress,
  type TileflowLineProgressMap,
  type TileflowRouteInks,
} from '@tileflow/core/browser';

const layers = (inks: TileflowRouteInks) => [
  {id: 'route-glow', color: inks.glow, highlight: '#ffffff', opacity: inks.glowOpacity},
  {id: 'route-casing', color: inks.casing},
  {id: 'route-line', color: inks.line, highlight: inks.core},
  {id: 'route-core', color: inks.core, highlight: '#ffffff', opacity: inks.coreOpacity},
];

export async function drawRoute(
  map: TileflowLineProgressMap,
  inks: TileflowRouteInks,
  lengthInMetres: number,
) {
  const route = createTileflowLineProgress(map, {
    layers: layers(inks),
    // A 90 m highlight, whatever the route's length.
    headLength: Math.min(0.2, 90 / lengthInMetres),
    initial: {end: 0},
  });
  await route.animate({to: {end: 1}, duration: 2500});
  // A light runs along the drawn route.
  await route.animate({to: {light: 1}, duration: 1500});
  route.set({light: undefined});
  return {
    recolour: (next: TileflowRouteInks) => route.configure({layers: layers(next)}),
    fadeOut: () => route.animate({to: {opacity: 0}, duration: 400}),
    dispose: () => route.dispose(),
  };
}
```

`animate` resolves `true` when the line gets where it was sent, and `false` when `set`, another
animation, or `dispose` stops it first; the line stays where it was stopped. A browser preference
for reduced motion shows the target at once. `tileflowLineProgressGradient(state, options)` returns
the same gradient for a single state, for styles built ahead of time.

## Cost

Each frame of an animation writes one `line-gradient` per layer, and MapLibre rebuilds that layer's
gradient texture. A route of a few layers costs little; avoid animating dozens of long lines at
once.
