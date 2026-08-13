# @tileflow/core

Typed Tileflow config helpers and the MapLibre style compiler.

```ts
import {defineTileflow, labels, osm, poi, roads} from '@tileflow/core';

export default defineTileflow({
  icons: {
    brand: {
      sprite: 'https://cdn.example.com/tileflow/brand/sprite',
    },
  },
  themes: {
    light: {
      colors: {
        background: '#F8F7F7',
        land: '#F4F2ED',
        water: '#8ED6E8',
        park: '#C3F1D5',
        building: '#EEF0F2',
        road: '#FFFFFF',
        roadMajor: '#F5D58A',
        roadCasing: '#DDE0E3',
        boundary: '#C9CED3',
        text: '#566371',
        textMuted: '#8A98A8',
        textHalo: '#FFFFFF',
      },
      modules: {
        labels: {
          road: '#7A8794',
          water: '#4B8FA8',
        },
        poi: {
          food: '#D97706',
          transit: '#2563EB',
        },
        roads: {
          motorway: '#F7C56F',
        },
      },
      typography: {
        font: 'Inter',
        roads: {weight: 'bold'},
      },
    },
  },
  maps: {
    madrid: {
      basemap: osm({version: '2026-06-07'}),
      icons: 'brand',
      theme: 'light',
      modules: [
        labels({roads: 'major', roadClasses: ['motorway', 'trunk', 'primary']}),
        poi({
          categories: ['food', 'coffee', 'culture', 'transit'],
          color: 'category',
          density: 'balanced',
          icons: 'essential',
        }),
        roads({
          detail: 'streets',
          hierarchy: 'clear',
          oneWayMarkers: true,
          outline: 'subtle',
          weight: 'regular',
          widthScale: {motorway: 1.15, minor: 0.9},
        }),
      ],
      layers: {
        'highway-primary': {
          paint: {
            'line-opacity': 0.9,
          },
        },
      },
      view: {
        center: [-3.7038, 40.4168],
        zoom: 12,
      },
    },
  },
});
```

## Capture scenes

Commit named visual scenes beside the maps they exercise. Scenes are strict, bounded test inputs;
they do not change style or manifest identity.

```ts
export default defineTileflow({
  maps: {
    madrid: {basemap: osm(), theme: 'light'},
  },
  scenes: {
    'madrid-desktop': {
      map: 'madrid',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'madrid-product': {
      map: 'madrid',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 390, height: 844, dpr: 2},
      target: {
        kind: 'application',
        path: '/maps/madrid',
        captureId: 'product-map',
      },
    },
  },
});
```

The default target renders autonomously with no server. An application target uses the app's
normal loopback development server and selects exactly one wrapper by `captureId`, explicit
selector, or map name. Cameras accept `center` or `bounds`; viewports are 64–4096 CSS pixels at DPR
1 or 2 within the public physical-pixel budget. Standalone capture applies the camera; an
application route must render it itself because capture does not mutate application component
state. Use `tileflow capture <scene>` or the `@tileflow/capture` Node package to render them.

## Style contract

Tileflow keeps these levels separate:

- `basemap: osm()` chooses the source defaults, glyphs, sprites, and OSM Bright layer template.
- `theme.colors` contains human-scale base tokens such as `water`, `park`, `road`, `roadMajor`, `roadCasing`, `text`, and `textHalo`.
- `theme.modules.<name>` contains advanced, module-specific tokens. These are granular: setting `theme.modules.roads.rail` does not recolor primary roads.
- `maps.<name>.icons` can point at a reusable root icon set, a hosted MapLibre sprite URL, or a local icon folder for Vite/build output.
- `maps.<name>.modules` enables semantic behavior such as `labels()`, `poi()`, and `roads()`. Road colors remain in `theme.modules.roads`; `roads()` controls detail, hierarchy, weight, outline, and optional transport extras.
- `typography` sets a global font/weight and optional `places`, `roads`, `water`, and `poi` overrides. The hosted Noto Sans endpoint guarantees `regular` and `bold`; custom glyph endpoints may provide the other typed weights.
- `buildingStyle` controls generated building fill opacity, outline opacity/width, and a height threshold that selects the theme's low/high-rise colors. Generated landuse and landcover layers consume their corresponding module colors.
- `maps.<name>.renderer` can be `auto`, `osm-bright`, or `generated`. `auto` preserves the default template when compatible; `generated` always uses Tileflow's generated layers; `osm-bright` throws if the map config cannot be rendered with the template.
- `layers` is the raw MapLibre escape hatch for exact layer patches.

Missing colors preserve the basemap default. Legacy aliases such as `accent`, `canvas`, `greenspace`, `fontFamily`, and `fonts` are accepted for compatibility but are not the recommended API.

## Roads module

Control each independent road-network decision directly:

```ts
roads({
  detail: 'streets',
  hierarchy: 'strong',
  weight: 'regular',
  outline: 'strong',
  oneWayMarkers: true,
  widthScale: {motorway: 1.15, primary: 1.05, minor: 0.9},
  extras: {
    paths: false,
    rail: false,
    ferry: false,
  },
});
```

`detail` is progressive: `none` hides roads; `highways` shows motorway and trunk roads;
`major` adds primary, secondary, and tertiary roads; `streets` adds minor streets; and `all`
adds service roads and tracks. `hierarchy` accepts `subtle`, `clear`, or `strong`; `weight`
accepts `thin`, `regular`, or `bold`; and `outline` accepts `none`, `subtle`, or `strong`.
`extras.paths`, `extras.rail`, and `extras.ferry` are independent and default to `false`.
`widthScale` accepts bounded multipliers for selected road classes, and `oneWayMarkers` adds
direction markers to eligible one-way roads.

Without options, `roads()` uses `detail: 'streets'`, `hierarchy: 'clear'`,
`weight: 'regular'`, `outline: 'subtle'`, and all extras disabled. Named visual recipes belong
in examples rather than the runtime API, so the resolved behavior is always visible in config.

Colors never belong in `roads()`. Put common colors in `theme.colors` and granular road colors in `theme.modules.roads`. Road-label detail remains a `labels({roads: ...})` concern.

## Labels module

Control label families independently without a preset:

```ts
labels({
  language: 'auto',
  places: 'major',
  roads: 'major',
  roadClasses: ['motorway', 'trunk', 'primary', 'secondary'],
  water: 'major',
});
```

`places` and `water` accept `none`, `major`, or `all`. Road labels follow the road hierarchy and
accept `none`, `highways`, `major`, `streets`, or `all`: `highways` includes motorway and trunk
labels, `major` adds primary through tertiary, `streets` adds minor streets, and `all` adds service
roads and tracks. Path labels are eligible at `all` only when path geometry is visible; when
`roads()` is present, enable it with `roads({extras: {paths: true}})`.

Detail values select which feature classes may be labeled; they do not force every name onto the
map. Labels keep the template's natural zoom ranges and MapLibre collision handling. Road labels
are also clamped to the classes currently visible through `roads({detail})`, so the effective result
is the intersection of both modules. `language` accepts `auto`, `local`, or a language code such as
`en` or `es`.

`roadClasses` is an optional explicit eligibility list. It is intersected with both the label
detail and visible `roads()` classes, so it cannot label a road family that the map has hidden.

Without options, `labels()` uses `language: 'auto'` and `major` for all three label families.
Label colors remain in `theme.modules.labels`; font family and weight remain in `typography`.

## POI module

POI category policy is resolved once for filtering, icon selection, label color, and collision
priority:

```ts
poi({
  categories: ['food', 'culture', 'lodging'],
  classMapping: {culture: ['planetarium']},
  color: 'category',
  density: 'balanced',
  icons: 'full',
  labels: 'full',
  placement: {coupleIconAndLabel: true, iconPadding: 4, textPadding: 8},
});
```

Built-in mappings inspect both `class` and `subclass`; `classMapping` adds source-specific values
without removing the defaults. `color: 'category'` uses `theme.modules.poi` colors end to end.
Named density is opt-in and adds bounded category-aware rank gates plus stable sort priority;
omitting it preserves legacy layer behavior. Raw source rank expressions remain available through
`styleOverride` when a particular dataset needs a bespoke rule.

## Tile-source revision

Set `version` on `osm({...})`, `maps.<name>.tiles`, or a named project tileset to pin an immutable
archive identifier. Map-level `tiles.version` wins over basemap and named-tileset defaults. Tileflow
adds it as `archiveVersion` to the TileJSON URL and records it as
`metadata['tileflow:tilesetVersion']`; it never infers stability from an unversioned response.

## Public API

Use the package root only:

```ts
import {
  createStyle,
  defineTileflow,
  labels,
  osm,
  poi,
  roads,
  styleOverride,
  validateConfig,
} from '@tileflow/core';
```

Capture scene schemas, types, normalization, limits, and schema version are also exported from the
package root. See the [local visual capture contract](https://tileflow.dev/docs/agent-workflow) for
the CLI workflow and readiness boundary.

Subpaths under `src/`, `themes/`, `templates/`, and `modules/` are internal implementation details and can change during alpha releases.

Docs: https://tileflow.dev/docs
