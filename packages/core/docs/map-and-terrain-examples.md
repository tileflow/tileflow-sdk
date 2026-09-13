# Map and terrain examples

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

Typed Tileflow map contracts, semantic modules, and deterministic MapLibre style compilation.

Every public `tileflow.config.ts` exports one map. Most maps import an existing map and override only
the design fields they own:

```ts
import {
  defineMap,
  defineTheme,
  fixed,
  labels,
  poi,
  roads,
  token,
  water,
  zoom,
} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

const madridDark = defineTheme(streetsThemes.dark, {
  id: 'madrid-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {color: {'surface.land': '#0d1320', 'surface.water': '#081e2e'}},
});

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  themes: {light: streetsThemes.light, dark: madridDark},
  defaultTheme: 'light',
  systemThemes: {light: 'light', dark: 'dark'},
  projection: 'globe',
  modules: {
    water: water({
      bodies: {
        fill: {
          opacity: fixed(0.95, {reason: 'Madrid keeps this water density in every theme'}),
        },
      },
    }),
    roads: roads({
      detail: 'streets',
      hierarchy: 'strong',
      classes: {
        primary: {
          surface: {
            fill: {
              color: fixed('#E4A85B', {reason: 'Madrid brand roads stay warm in every theme'}),
              width: zoom.linear([
                [7, fixed(0.6, {reason: 'Madrid keeps its primary-road hierarchy across themes'})],
                [16, fixed(8, {reason: 'Madrid keeps its primary-road hierarchy across themes'})],
              ]),
            },
          },
        },
        secondary: {surface: {fill: {color: token.color('roads.secondary')}}},
      },
    }),
    labels: labels({
      language: 'local',
      places: 'all',
      roads: 'streets',
      styles: {
        places: {
          city: {
            text: {
              size: fixed(18, {reason: 'Madrid keeps its city-label scale across themes'}),
              haloWidth: fixed(1.5, {reason: 'Madrid keeps its city-label halo across themes'}),
            },
          },
        },
      },
    }),
    poi: poi({categories: ['food-drink', 'arts-entertainment', 'transport'], color: 'category'}),
  },
  view: {center: [-3.7038, 40.4168], pitch: 35, zoom: 12},
});
```

Map identity and scenes belong to the leaf and do not inherit. Hosted browser policy is configured
in Tileflow and does not enter cartographic authoring or compilation.

Set `projection: 'globe'` for MapLibre's adaptive globe preset. Global zooms render as a sphere,
then transition to Mercator between zoom 10 and 12 so detailed streets remain planar. Omit the
property, or set it to `'mercator'`, for a consistently flat map.

Terrain keeps the original `'none' | 'hillshade' | '3d'` shorthand. The object form can style every
MapLibre hillshade paint control, or generate vector contours in the browser from an explicit DEM
tile template. Contours require `demUrl`, `demMaxZoom`, and zoom-indexed `[minor, index]`
`thresholds`; the raster `url` remains the separate TileJSON endpoint. Set `mode: 'none'` to compile
contours without adding a raster source, hillshade, or 3D terrain:

```ts
terrain: {
  mode: 'none',
  encoding: 'terrarium',
  contours: {
    demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp',
    demMaxZoom: 13,
    maxZoom: 15,
    overzoom: 2,
    thresholds: {
      9: [100, 500],
      11: [50, 250],
      13: [20, 100],
      15: [10, 50],
    },
    minor: {
      color: token.color('terrain.contour.minor'),
      width: token.number('terrain.contour.minor-width'),
    },
    index: {
      color: token.color('terrain.contour.index'),
      width: token.number('terrain.contour.index-width'),
    },
    labels: {
      color: token.color('terrain.contour.label'),
      haloColor: token.color('terrain.contour.halo'),
    },
  },
}
```

Declare those `terrain.*` color and number roles with the same keys in every map theme. The
compiled source is ordinary MapLibre vector data with source layer `contours`; its tile URL
contains the safely encoded DEM template and complete generation parameters. Register the generic
protocol before MapLibre reads the style. It lazily initializes the pinned, locally bundled
`maplibre-contour@0.1.0` browser module on the first contour tile; no public CDN runtime is needed.
`overzoom` may not exceed the lowest threshold zoom, so generated DEM requests never use a negative
zoom. Every index interval must be a whole multiple of its minor interval. Contour labels emit the
scaled numeric elevation without assuming a display unit. Source and layer visibility cannot begin
before the first configured threshold zoom. To bound main-thread work, effective minor intervals
must be at least 250 units at z0–4, 100 at z5–7, 50 at z8–10, 20 at z11–12, and 10 from z13 onward.
Use a trusted, size-bounded DEM tile service; the protocol intentionally accepts author-supplied
HTTP(S) templates rather than proxying or republishing terrain data.

```ts
import maplibregl from 'maplibre-gl';
import {registerTileflowContourProtocol} from '@tileflow/core/browser';

registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
```
