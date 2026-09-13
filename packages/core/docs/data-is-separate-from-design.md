# Data is separate from design

Start with the [@tileflow/core guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) for installation and a complete first example.

Team data uses named logical sources and validated MapLibre overlays. The hosted identity never
contains a CDN URL; `local` is the explicit account-free PMTiles resolution for Dev and Capture:

```ts
import {defineMap, hostedTileset, maplibreOverlay} from '@tileflow/core';
import {streets} from '@tileflow/maps';

const stores = hostedTileset({
  tileset: 'stores',
  local: './data/stores.pmtiles',
  attribution: 'Store data © Example',
});

export default defineMap({
  id: 'store-locator',
  version: 1,
  extends: streets,
  sources: {stores},
  overlays: {
    stores: maplibreOverlay({
      source: 'stores',
      placement: 'above-roads',
      layers: [
        {
          id: 'stores-points',
          type: 'circle',
          'source-layer': 'store_locations',
          paint: {
            'circle-color': ['match', ['get', 'category'], 'restaurant', '#ef4444', '#64748b'],
          },
        },
      ],
    }),
  },
});
```

Tileflow automatically registers only protocols in namespaces that Tileflow owns.
`tileflow-pmtiles://` is reserved for PMTiles resources managed by Tileflow. Tileflow never
automatically registers, removes, or replaces the global `pmtiles://` handler. Explicit PMTiles
sources supplied by an application remain the application's responsibility.

For local resolution, the Style URL is based on the logical tileset ID and remains stable when Dev
creates a new immutable snapshot. Physical generation IDs and local content hashes never enter the
Style representation. Each Dev PMTiles request retains the snapshot it resolved until its response
is prepared, and strong generation ETags prevent one cached PMTiles read from silently combining
ranges from different generations. Standalone Capture retains one snapshot for its complete render.
Application Capture does not freeze every local dataset across the complete screenshot window; the
application's development server remains authoritative for its per-read generation.

`local` does not make build output own or publish the archive. Production builds reject unresolved
local PMTiles. Explicitly publish the tileset through Tileflow's managed upload, validation,
versioning, and hosting flow, or serve it from infrastructure owned by the application.

One overlay owns one ordered group of ordinary MapLibre Style Layers. Public layer IDs are retained
for `map.on(...)`, feature queries, and application state. Placement is one of `above-water`,
`below-roads`, `above-roads`, `above-buildings`, `below-labels`, or `above-labels`; overlays sharing
a placement sort by overlay ID. A map accepts up to 16 Team sources in addition to Tileflow World
and terrain. These semantic boundaries do not expose generated basemap layer IDs.
`sources` and `overlays` merge by key through `extends`, declarations replace atomically, and
`remove()` deletes one inherited key. Removing a still-used source fails validation. There is no
interaction DSL or parallel expression language.

Omitting `data` selects the compiler-owned Tileflow World `v1` compatibility generation:

```ts
import {streets} from '@tileflow/maps';

export default streets;
```

Theme typography can set `fallbacks`, `letterSpacing`, and `transform` globally or per label
domain, while the font token catalog gives module styles a stable semantic target. Text delivery is
explicit and atomic: a map may declare either ordered `fonts` directories
for browser font files or a `glyphs` provider for PBF glyphs, never both. Omitting both inherits the
parent's provider; declaring either replaces an inherited provider of either kind. After resolution,
a map that emits text must have exactly one provider. A text-free standalone map may omit both. On a derived
map, omission inherits the parent provider while `fonts: []` explicitly removes it; that empty array
is valid only when the resolved map emits no text.

```ts
import {defineMap, defineTheme} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

const brandLight = defineTheme(streetsThemes.light, {
  id: 'brand-light',
  version: 1,
  colorScheme: 'light',
  tokens: {font: {default: 'Brand Sans Regular', places: 'Brand Sans Regular'}},
});
const brandDark = defineTheme(streetsThemes.dark, {
  id: 'brand-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {font: {default: 'Brand Sans Regular', places: 'Brand Sans Regular'}},
});

export default defineMap({
  id: 'brand-map',
  version: 1,
  extends: streets,
  fonts: ['./fonts'],
  themes: {light: brandLight, dark: brandDark},
  defaultTheme: 'light',
  systemThemes: {light: 'light', dark: 'dark'},
});
```

Node preparation reads TTF, OTF, and WOFF2 files, uses each OpenType full name as its exact
`text-font` ID, and requires `LICENSE.txt` in every contributing directory. Directories apply left
to right; a later exact name replaces an earlier face and case-only collisions fail. Only primary
faces used by the final style become content-addressed assets and strict `tileflow:fontFaces`
metadata. `font` names an exact OpenType full name or glyph face; local `fallbacks` name exact faces
or explicit CSS generic families. Tileflow never appends a weight suffix or derives one face from
another. Browser adapters load local faces before MapLibre. Native releases use a locked PBF
`glyphs` URL provider instead, which enumerates the exact comma-joined MapLibre request keys in
`fontStacks`.

Streets, Ferraris, Härad, Soundings, Verdant, and San Francisto each declare
`https://api.tileflow.dev/fonts/{fontstack}/{range}.pbf` with the exact `Noto Sans Regular` and
`Noto Sans Bold` stacks. That compatibility URL is canonical but not content-addressed; responses revalidate and
do not make a resolved map byte-reproducible. Exact official glyph identity belongs to the
separately published `/base/<assetSetSha256>/glyphs/...` global base-asset contract. In that URL,
`assetSetSha256` identifies the standalone glyph collection; it is not the same-domain value as the
per-map `assetSetSha256` in `build-manifest.json`.
Cyberpunk and Matrix each replace the URL provider with their own packaged Oxanium directory and
reference the exact local faces `Oxanium Medium` and `Oxanium SemiBold`. Baedeker and Siegfried
each own a packaged directory containing Cormorant Garamond Regular, SemiBold, and Italic.

Name the official generation deliberately, or use another OpenMapTiles-compatible vector source:

```ts
import {openMapTiles, tileflowWorld, vectorTiles} from '@tileflow/core';

const official = tileflowWorld();
const external = vectorTiles({
  tiles: ['pmtiles://./test/fixtures/world.pmtiles'],
  revision: 'fixture-1',
  attribution: '© Example © OpenStreetMap contributors',
  schema: openMapTiles(),
});
```

The resolved map controls how data is drawn; `data` controls where compatible features come from.
For Tileflow World, the compiler emits the selector TileJSON URL
`https://api.tileflow.dev/tiles/world/tiles.json`. Omitted data or `tileflowWorld()` selects
`world-v1/current`; `tileflowWorld({release: {releaseId, descriptorSha256}})` binds an exact release
through query parameters. Runtime and capture resolve `current` once per session or job and then
use the immutable release described by that response. `openMapTiles({layers, fields})` can bind renamed
source-layers or properties while preserving the versioned semantic contract. External browser
credentials do not belong in public Style JSON; supply them through the framework's
`transformRequest` integration.

External exact-test sources may use one TileJSON `url` or a bounded direct `tiles` list with optional
`bounds`, `minzoom`, and `maxzoom`. `pmtiles://` is supported for a checked-in or bring-your-own
archive. Public vector URLs are HTTPS, root-relative, or HTTP only on loopback development hosts.
A PMTiles URL names one `.pmtiles` archive through an HTTPS, loopback HTTP, root-relative, or safe
repository-relative target; credentials, fragments, traversal, and other protocols are rejected at
both authoring validation and compilation. An external `revision` participates in capture identity,
so changing fixture bytes cannot silently reuse a baseline.

Tileflow's OpenMapTiles contract also recognizes the optional `globallandcover` extension. The
official Streets map maps its `barren`, `crop`, `grass`, `shrub`, `snow`, `trees`, and
`urban` classes beneath the OSM land layers. Tileflow World V1 supplies native generalized
geometry through z10; Streets fades it progressively while detailed `landcover`/`landuse` gains
opacity and removes it at z11. This is a macro bridge, not local semantic detail. Sources with a
different layer name can use `openMapTiles({layers: {globalLandcover: 'my_landcover'}})`; archives
without the extension remain compatible and simply render no features for that style layer. Use
`land({globalLandcover: {...}})` to customize its fill, opacity, visibility, and zoom range. `crop`
shares the theme's semantic `landcover.farmland` color with detailed farmland, while `barren` uses
`landcover.rock`; neither class borrows a road color.

The normalized schema also records the meaning of the OpenMapTiles `park` layer. Generic
`openMapTiles()` defaults to `semantics.parkLayer: 'mixed'` and compiles a private compatibility
branch for ordinary legacy parks. `tileflowWorldV1Schema()` fixes it to `'protected-only'`: that
layer is a protection tint, while urban parks and gardens come from
`landcover.class=grass/subclass=park|garden`. The ambiguous legacy `park` class is therefore not
a public land-cover target.

Tileflow World V1 makes `bathymetry`, `globallandcover`, `circular_feature`, `sidewalk`, and
`street_furniture` mandatory. Use `tileflowWorldV1Schema()` for that product instead of making raw
layer names part of a style. Publication tooling calls `validateTileflowWorldV1Tilejson(...)` and
fails closed unless each layer occurs exactly once, declares its contracted native zooms, and
advertises the typed fields consumed by the maps. This includes bathymetry z0–z9, global land cover
z0–z10, the three detailed-city layers at native z15, and numeric
`transportation.clearance_extra_px_z15` for butt-capping procedural-roundabout approaches. Generic
OpenMapTiles sources keep the detailed extensions optional and the compiler omits unsupported
detail. Resolving omitted data or
`tileflowWorld(...)` uses the strict V1 schema directly, and `water({bathymetry: {...}})` styles the
emitted depth bands without raw layer IDs. Use `water({bathymetryContours: {...}})` to customize the
opt-in companion line layer; an empty style selects subtle defaults, and the zero-depth band is
excluded so the ordinary coastline remains authoritative. The lines follow discrete band polygon
edges and are therefore approximate rather than surveyed depth contours. Use
`water({bathymetryLabels: {...}})` to customize the separate opt-in symbol layer; an empty style
selects the defaults, whose text is the absolute band-minimum number in metres with no unit suffix.
It remains a band-floor annotation, not a survey sounding.

For independent ocean products, `marine` composes stable auxiliary vector sources without changing
the primary World source:

```ts
import {bathymetry, defineMap, fixed, nautical} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'chart',
  version: 1,
  extends: streets,
  marine: 'chart', // 'none' | 'bathymetry' | 'nautical' | 'chart'
  modules: {
    nautical: nautical({
      soundings: {minZoom: 13},
      aids: {minZoom: 11},
      lights: {minZoom: 12},
      hazards: {minZoom: 12},
      hazardAreas: {
        fill: {opacity: fixed(0.1, {reason: 'Chart hazard wash is invariant'})},
      },
      wrecks: {minZoom: 12},
      wreckAreas: {
        outline: {opacity: fixed(0.6, {reason: 'Chart wreck outline is invariant'})},
      },
      reefs: {fill: {opacity: fixed(0.3, {reason: 'Chart reef wash is invariant'})}},
      navigationAreas: {
        fill: {opacity: fixed(0.05, {reason: 'Chart navigation-area wash is invariant'})},
      },
      coverage: {outline: {visible: false}},
      labels: {
        navigationAreas: {minZoom: 11},
        reefs: {minZoom: 13},
      },
    }),
  },
});
```

`bathymetry` resolves to vector source `tileflow-bathymetry` and supplies the 13-stop
`bathymetry-v1` band contract to `water(...)`. `nautical` resolves to `tileflow-nautical`; the
`nautical(...)` module
styles its `sounding`, `aid`, `light`, `hazard`, `wreck`, `reef`, `navigation_area`, and `coverage`
layers. The schema also names the product's provider-neutral provenance fields (`provenance`,
`provider`, `cell`, `edition`, `update`, `scale`, `coverage`, and `licence`). `chart` enables both.
Point features label depth, name, or light character as applicable. The `lighthouses` symbol style
targets `aid` points whose canonical `class` is `lighthouse`, leaving other aids under `aids`.
Polygon reefs, navigation
areas, hazards, wrecks, and named/provider coverage have separate collision-aware labels under
`nautical({labels: {...}})`; unnamed coverage does not emit empty text.
Core does not hard-code a nautical provider or attribution: the selected TileJSON owns its actual
coverage and attribution, and derived vector tiles are not represented as a certified ENC for
navigation. The V1 geometry contract preserves `sounding`, `aid`, and `light` as points;
`reef`, `navigation_area`, and `coverage` as polygons; and both point and polygon geometries for
`hazard` and `wreck`. Point symbols and polygon areas compile separately, without fabricated
centroids.
Advanced callers can override either TileJSON URL, attribution, or source ID and can set the other
member to `false`:

```ts
marine: {
  bathymetry: {url: 'https://tiles.example.test/depth/tiles.json'},
  nautical: false,
}
```

Use the `bathymetry(...)` helper when the map needs relief or product-level styling. Bathymetry is
one logical product with two independently loaded physical sources:

```ts
marine: {
  bathymetry: bathymetry({
    display: 'hybrid',
    bands: {
      opacity: fixed(0.72, {reason: 'Keep chart symbols above the depth wash'}),
    },
    contours: {visible: true},
    relief: {
      multidirectional: true,
      opacity: fixed(0.18, {reason: 'Relief stays legible beneath bands and labels'}),
    },
  }),
  nautical: false,
}
```

`display: 'bands'` loads only vector TileJSON `/tiles/bathymetry/tiles.json` as
`tileflow-bathymetry`. `display: 'relief'` loads only `/tiles/bathymetry/dem/tiles.json` as
`tileflow-bathymetry-dem` and emits continuous `color-relief` plus hillshade. `display: 'hybrid'`
loads both. The hosted DEM contract is 512 px, Terrarium-encoded, lossless WebP; advanced compatible
sources may override `url`, `sourceId`, `encoding`, or `tileSize` inside `relief`.
Multidirectional illumination uses directions 270°, 315°, 0°, and 45°. The simple
`marine: 'chart'` shorthand deliberately stays vector-only; DEM relief is an explicit advanced
opt-in.

The vector palette uses thresholds −11 000, −8 000, −6 000, −4 000, −2 000, −1 000, −500, −200,
−100, −50, −20, −10, and 0 metres. `bands`, `contours`, and `labels` remain separate controls.
Until native contour fields are contracted, contours are a visual fallback drawn from band polygon
edges, not surveyed isolines. The V1 schema exposes optional source-layer names
`bathymetry_contour`, `seafloor_landform`, `water_name`, and `bathymetry_coverage`, but promises
fields only for required `bathymetry.min_depth` and `bathymetry.sort_key`.

The DEM enables future client-side sampling and depth profiles, but Core intentionally exposes no
profile or remote sampling API yet. Rendered relief must not be interpreted as navigation-safe
depth data.

Omitting `marine` preserves the transitional Tileflow World V1 bathymetry fallback. Declaring
`marine: 'none'` suppresses that fallback, while a selected bathymetry sidecar always takes
precedence. Compiled styles retain the singular `tileflow:data` metadata for existing consumers and
add `tileflow:sources` plus `tileflow:sourceRequirements` for independent product validation.

Detailed city datasets can bind `sidewalk`, `streetFurniture`, and `circularFeature` source layers
through `openMapTiles({layers, fields})`. When present, `roads.sidewalks` owns source-backed
pedestrian polygons, `roads.crossings` owns oriented crossing icons, and `roads.roundabouts` owns
metric circular road rings. These bindings are optional: a generic OpenMapTiles source remains
valid and the compiler omits unsupported detail instead of inventing geometry. Crossing icons are
explicit because the data contract cannot assume a sprite name. They require positive physical
`markings` evidence and reject `crossing=no`; both fields are semantic bindings, so custom schemas
can remap them without weakening that rule.

The optional `business_corridor` extension contains activity-selected source footprints below
buildings. Its `activity_score`, `rank`, `min_zoom`, and `confidence` fields control a quiet local
warm tint without drawing POI-radius circles. Current building footprints may carry sparse
`building_tone=commercial|destination|active`; absence means the neutral base building. The three
values preserve why the warm tone was selected even when a theme maps them to the same color.
Building visibility is fixed by the layer zoom contract and never by optional semantics. Immutable
V8.9 archives carrying `building_kind` or `has_business` remain readable as a defensive
compatibility path, but new candidates do not emit those fields. The land module also exposes
`medical`, `education`, and `government` independently instead of collapsing their already distinct
source classes into one civic color.

World and text assets are independent contracts. `tileflowWorld()` selects `world-v1/current` or an
exact `releaseId + descriptorSha256`; a `glyphs` declaration contains its own complete URL. Ordinary
imports of Streets, Ferraris, Härad, Siegfried, Soundings, Cyberpunk, Matrix, Verdant,
and San Francisto
remain usable because each official map owns or inherits a URL or packaged-font provider.
URL-backed maps become exact-byte reproducible
when the immutable global base-asset set is published and their explicit URL is updated to its
`assetSetSha256` path; no World or compiler fallback participates in that rollout. The global
base-asset manifest's hash and a map build manifest's identically named `assetSetSha256` use
different contracts and must never be substituted for one another.

Upstream data attribution remains in the MapLibre source. `Map by Tileflow` is a separate product
credit/trademark surface and must not replace, obscure, or be presented as upstream attribution.
