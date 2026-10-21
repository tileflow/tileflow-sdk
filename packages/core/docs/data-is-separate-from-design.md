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
another; the only derived stacks are line-fitted text backgrounds on a `glyphs` provider, which keep
their source faces' shapes. Browser adapters load local faces before MapLibre. Native releases use a locked PBF
`glyphs` URL provider instead, which enumerates the exact comma-joined MapLibre request keys in
`fontStacks`.

Streets, Soundings, and Blueprint each declare
`https://api.tileflow.dev/base/33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3/glyphs/{fontstack}/{range}.pbf`
with the exact `Noto Sans Regular` and `Noto Sans Bold` stacks. The full hash identifies one
published, immutable glyph collection independent of World data. The older `/fonts/...` endpoint
remains a mutable compatibility URL and does not make a resolved map byte-reproducible. The global
glyph `assetSetSha256` is not the same-domain value as the per-map `assetSetSha256` in
`build-manifest.json`.
Baedeker, 1777, and Siegfried each own a packaged directory containing Cormorant Garamond Regular, SemiBold, and Italic.

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

Tileflow World V1 makes `bathymetry`, `globallandcover`, `circular_feature`, `sidewalk`,
`street_furniture`, and `transportation_outline` mandatory. Use `tileflowWorldV1Schema()` for that product instead of making raw
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
      buoys: {minZoom: 12},
      lights: {minZoom: 9},
      navigationAreas: {
        fill: {opacity: fixed(0.05, {reason: 'Chart navigation-area wash is invariant'})},
      },
      reefs: {fill: {opacity: fixed(0.3, {reason: 'Chart reef wash is invariant'})}},
      labels: {navigationAreas: {minZoom: 12}},
    }),
  },
});
```

`bathymetry` resolves to vector source `tileflow-bathymetry` and supplies the 13-stop
`bathymetry-v1` band contract to `water(...)`. `nautical` resolves to `tileflow-nautical` at
`/tiles/nautical/tiles.json`; the `nautical(...)` module draws its `nautical-v1` buoys, beacons,
lighthouses, lights, hazards, wrecks, reefs, navigation areas, routes, cables, harbours, ports, and
a restrained coverage indication. `chart` enables both. Every map that draws Nautical declares a
"Not for navigation" notice, which the browser runtimes render on the map. The
[Nautical marks guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/nautical-marks.md)
describes the schema, the semantic groups, the theme image tokens, and the notice.
Core does not hard-code a nautical provider or attribution: the selected TileJSON owns its actual
coverage and attribution, and derived vector tiles are not represented as a certified ENC for
navigation. Point symbols and polygon areas compile separately, without fabricated centroids.
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
Without an optional-layer declaration, contours and depth labels retain the legacy polygon-band
behavior. `marine` shorthands and existing maps keep that behavior.

### Declare contour and name layers

For a compatible source, `vectorLayers` explicitly declares optional layers. Core never fetches
TileJSON to detect them and never substitutes polygon edges for declared contour lines. A missing
declared layer therefore draws no features; validate the selected dataset before rendering.
`display: 'bands'` or `'hybrid'` loads the vector source.

| Declaration                             | Source layer         | Geometry and fields                                                                                                 |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `contours: true`                        | `bathymetry_contour` | Lines with numeric `depth`, negative metres below the source vertical datum. Zero and positive depths are excluded. |
| `landforms: true` or a range inventory  | `seafloor_landform`  | Named points, lines, or polygons with stable source `id`, provider `class`, and `name`.                             |
| `waterNames: true` or a range inventory | `water_name`         | Named points, lines, or polygons with the same name contract.                                                       |

Name geometry stays in its source representation. `placement: 'point'` (the default) lets the
renderer place names inside polygons or on points. Use `placement: 'line'` to label source lines.
Core creates no substitute point, centroid, or line feature.

Name layers preserve source properties; `id` is a source identifier, with no guarantee of a numeric
renderer feature ID. Optional `name:<language>` fields retain the source's language assignments.
`labels({language: 'es'})` selects a nonempty `name:es`, falling back to `name`; `auto` and `local`
use `name` directly. Core does not infer the language of an unqualified name or invent translations.
Optional `min_zoom` is inclusive and `max_zoom` exclusive, defaulting to 0 and 24. These nominal
ranges intersect the symbol style's range. With `true`, MapLibre evaluates feature zoom filters at
integer zooms: `min_zoom: 7.6` first becomes eligible at zoom 8. For exact fractional boundaries,
declare an exhaustive range inventory instead:

```ts
vectorLayers: {
  contours: true,
  landforms: {zoomRanges: [{minZoom: 0, maxZoom: 24}]},
  waterNames: {
    zoomRanges: [{minZoom: 1, maxZoom: 6.5}, {minZoom: 7.6, maxZoom: 10}],
  },
}
```

Each declared pair becomes a separate symbol layer with fractional renderer bounds and equality
filters on the source's original range. A `7.6–10` feature appears at 7.6 and disappears at 10.
Unlisted pairs are omitted. Core never discovers ranges from tiles: validate the source inventory
against this exhaustive declaration before rendering, and retain that inventory with reproducible
captures. Numeric pairs must match the source's encoded values exactly.

Each name layer accepts 1–128 unique pairs with `0 <= minZoom < maxZoom <= 24`;
`tileflowBathymetryNameLayerLimits.maxZoomRanges` exposes the limit. Input order does not affect
output. Different pairs can overlap in zoom because equality filters keep their feature sets
disjoint. A style may narrow a pair's visibility; an empty intersection emits no layer.
Missing or null source bounds default to 0/24. Nonnumeric values use the same numeric-conversion
fallbacks; numeric strings are converted. Such features draw only if their normalized pair is
declared. Core preserves the original source properties.

Optional numeric `sort_key` defaults to 0; smaller values enter collision placement first within
each cohort. Cohorts follow ascending minimum then maximum zoom and sit below ordinary map labels.
Names use normal collision placement without overlap by default.

This example declares a source whose regional detail supports zoom 14. Its extended ranges are
explicit design choices, not a promise of worldwide detail:

<!-- docs:check -->

```ts
import {bathymetry, defineMap, expr, field, fixed, labels, water} from '@tileflow/core';
import {soundings} from '@tileflow/maps';

export default defineMap({
  id: 'regional-depth',
  version: 1,
  extends: soundings,
  marine: {
    bathymetry: bathymetry({
      url: 'https://tiles.example.test/regional-depth/tiles.json',
      vectorLayers: {
        contours: true,
        landforms: {zoomRanges: [{minZoom: 0, maxZoom: 24}]},
        waterNames: {zoomRanges: [{minZoom: 7.6, maxZoom: 10}]},
      },
      contours: {},
      labels: {},
    }),
    nautical: false,
  },
  modules: {
    labels: labels({language: 'es'}),
    water: water({
      bathymetry: {
        maxZoom: 15,
        opacity: fixed(0.8, {reason: 'The selected regional source supplies detailed bands'}),
      },
      bathymetryContours: {maxZoom: 15},
      bathymetryLabels: {
        maxZoom: 15,
        text: {
          field: expr.concat(
            expr.toString(expr.abs(expr.get(field('bathymetryContourDepth')))),
            ' m',
          ),
        },
      },
      bathymetryLandforms: {maxZoom: 15},
      bathymetryWaterNames: {maxZoom: 15},
    }),
  },
});
```

`water.bathymetryContours` and `water.bathymetryLabels` now consume the declared lines and `depth`;
labels default to line placement. Band fills still consume `min_depth` and `sort_key`.
`water.bathymetryLandforms` and `water.bathymetryWaterNames` style the declared names; set
`visible: false` to hide either. Without their declaration, those styles emit no name layers.
Name styles may use `class` in expressions without changing the source classification.

Mixed geometry can opt into `placementByGeometry` on either name style. Its resolved policy must
include `point`, `line`, and `polygon`; `point` must be `'point'`, while the other two accept
`'point'`, `'line'`, or `'line-center'`. The policy overrides scalar `placement`, including an
inherited value. Without it, scalar placement and existing generated layers remain unchanged.

For example, this map labels point features at their coordinates and retains line placement for
lines and polygon boundaries:

<!-- docs:check -->

```ts
import {bathymetry, defineMap, labels, water} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'marine-names',
  version: 1,
  extends: streets,
  marine: {
    bathymetry: bathymetry({
      vectorLayers: {landforms: {zoomRanges: [{minZoom: 0, maxZoom: 24}]}},
    }),
    nautical: false,
  },
  modules: {
    labels: labels({language: 'es'}),
    water: water({
      bathymetryLandforms: {
        placementByGeometry: {point: 'point', line: 'line', polygon: 'line'},
      },
    }),
  },
});
```

This example declares source availability; the selected source must actually contain those
features. Equal placements share one geometry-filtered group per source range. A policy emits
at most three groups per range (384 layers for one name family at the 128-range limit). Groups
compile in `point`, `line`, `line-center` order below ordinary map labels; source priority orders
features within each group. Module refinements inherit the policy and style every group.
Render-stack refinements still address exact semantic targets; inspect each placement/range
target when applying a narrower refinement.
Normal collision still applies and can hide a name.

Placement uses the received geometry: `point` places a line label at its first rendered vertex;
it does not compute a stable line midpoint. Polygon `point` placement uses an interior position
of the rendered polygon, while `line` follows its boundary. Core does not generate source anchors,
merge identities or deduplicate names by text. A source can supply multiple stable point anchors
with shared identity properties and distinct anchor properties; their extent, visibility and
editorial policy belong to that source. Keep original source identities as properties rather than
assuming a universal numeric `feature.id`.

Water-module styles override product-level `bands`, `contours`, and `labels`. Existing custom
`text.field` expressions remain authoritative: when refining a map from legacy polygons to native
contours, use `expr.get(field('bathymetryContourDepth'))` for its depth. That auxiliary binding
resolves to `depth` independently of the primary World schema; `bathymetryMinDepth` keeps its
legacy band meaning. Raw `expr.get('depth')` is rejected by authoring validation.
Increasing only `maxZoom` does not remove an opacity curve that fades out earlier. Extend ranges
and opacity only where the selected source supports the intended detail.

The V1 schema also reserves `bathymetry_coverage`; Core adds no coverage rendering by default.
Derived contours and names provide geographic context, not certified navigation data.

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
metric circular road rings. A `transportationOutline` binding names lines that trace the outer
boundary of each road area; when bound, `roads.areas` outlines stroke those lines instead of the
area polygons, so the holes of a plaza (tree pits, planting beds) are not stroked. These bindings
are optional: a generic OpenMapTiles source remains
valid and the compiler omits unsupported detail instead of inventing geometry. Crossing icons are
explicit because the data contract cannot assume a sprite name. They require positive physical
`markings` evidence and reject `crossing=no`; both fields are semantic bindings, so custom schemas
can remap them without weakening that rule.

Metric road rings scale continuously with the map from zoom 15 through 24, including fractional
zooms. Their casing is below surface road fills so approaching streets cover the outline at each
junction. The ring fill stays below bridges and road markings.

Road treatment `widthScale` scales both the stroke and an authored `gapWidth`, keeping hollow
casings aligned with the carriageway at fractional zoom levels.
When every dash treatment is continuous (`[1, 0]`), road layers omit the dash pattern so thin
casings render as solid strokes. Actual construction and tunnel dashes remain patterned.

Datasets may also publish the optional, decorative `canopy` layer: points inside urban parks and
gardens, at most one per cell of a grid of about 20 m that measured tree canopy covers. Each point
tells how much room a drawn grove of tree crowns has and how dense the canopy around it is. The
points are not surveyed trees, are unrelated to the optional `tree` layer, and are not search or
interaction targets. `openMapTiles()` and `tileflowWorldV1Schema()` bind the layer as `canopy` and
its numeric fields as follows:

- `canopyRank` (`rank`): a stable integer from 0 through 15. Lower ranks appear at lower zooms, and
  the rank can vary artwork.
- `canopyClearanceAtZoom15` (`clearance_px_z15`): 4, 6, 8, 12, 16, or 24. This is the lower bound
  of the distance from the point to the nearest edge a crown must not cover, such as a park edge,
  water, a building, a plaza, a pitch, or a roadway, in pixels of a 512-pixel tile at zoom 15. A
  grove fits at zoom `z` when its drawn reach in screen pixels is at most
  `clearance_px_z15 × 2^(z − 15)`.
- `canopyCoverPercent` (`cover_pct`): 3, 30, or 60, the lower bound of the share, in percent, of
  canopy taller than 3 m within 10 m of the point. The field is absent where no measurement exists;
  treat absence as a middle density.

Features are MultiPoints, one per identical set of attributes. Native zoom 15 holds every point,
zoom 14 holds the points whose rank is below 8 at the same positions, and clients overzoom zoom 15.
`validateTileflowWorldV1Tilejson(...)` accepts a TileJSON without `canopy`; once declared, the layer
must occur exactly once, declare native z14–z15, and advertise Number `rank`, `clearance_px_z15`, and
`cover_pct`. No module draws the layer. A source without it remains valid, and render passes bound
to it draw nothing. `capabilities: {canopy: false}` removes the binding, after which a pass with
`feature: 'canopy'` fails with a missing-binding error.

Draw groves with symbol render passes, one grove of whole crowns per point, sized to its room:

<!-- docs:check -->

```ts
import {expr, field, fixed, renderPass, token, vegetation, withRenderStack} from '@tileflow/core';

// The grove artwork reaches 32 pixels from its center at icon size 1.
const clearance = expr.get(field('canopyClearanceAtZoom15'));
// The size that fills the room at one zoom, never larger than the artwork itself.
const fit = (divisor: number) => expr.min(expr.divide(clearance, divisor), 1);

const groves = (minZoom: number, fromRank: number, toRank: number) =>
  renderPass({
    placement: 'above-vegetation',
    feature: 'canopy',
    renderer: 'symbol',
    selector: {
      kind: 'all',
      selectors: [
        {field: 'canopyRank', kind: 'compare', operator: 'gte', value: fromRank},
        {field: 'canopyRank', kind: 'compare', operator: 'lt', value: toRank},
      ],
    },
    style: {
      minZoom,
      icon: {
        ignorePlacement: true,
        image: token.image('vegetation.canopy.grove'),
        overlap: 'always',
        size: expr.interpolate({base: 2, kind: 'exponential'}, expr.zoom(), [
          [14, fit(64)],
          [15, fit(32)],
          [16, fit(16)],
          [17, fit(8)],
          [18, fit(4)],
        ]),
      },
      text: {
        field: 'o',
        font: token.font('default'),
        opacity: fixed(0, {reason: 'The core text only decides placement'}),
        overlap: 'cooperative',
        size: fixed(8, {reason: 'Matches the solid core of the grove artwork'}),
      },
    },
  });

export const canopyGroves = withRenderStack(vegetation(), {
  groves14: groves(14, 0, 4),
  groves15: groves(15, 4, 8),
  groves16: groves(16, 8, 16),
});
```

- Give each rank range its own pass with `minZoom`, so its points appear whole at their entry zoom.
  MapLibre evaluates expressions that combine zoom and feature data at whole zoom levels and
  interpolates between them, so a fade per feature would leave symbols half transparent. Zoom 14
  tiles carry the ranks below 8, so the first pass may cover ranks 0–7.
- Size each grove from `canopyClearanceAtZoom15`. Here the size is `clearance / 32` at zoom 15 and
  doubles with each zoom until the grove reaches the artwork's size, which keeps the reach within
  the room.
- Collision tests an icon's whole image, including the transparent margin around the crowns. A small
  invisible text the size of the grove's core therefore decides placement with
  `overlap: 'cooperative'`, while the icon draws with `overlap: 'always'` and `ignorePlacement: true`.
  Groves may overlap each other but give way to labels, which draw above the vegetation band and are
  therefore placed first, with the default `never`.

Every theme of the map must define the image token, and the map's icon directories must provide the
artwork. Native artifacts replace `cooperative` with `allowOverlap: true`, so there groves can cover
labels; see [symbol overlap modes](shared-visual-primitives.md#symbol-overlap-modes).

The optional `business_corridor` extension contains activity-selected source footprints below
buildings. Its `activity_score`, `rank`, `min_zoom`, and `confidence` fields control a quiet local
warm tint without drawing POI-radius circles. Current building footprints may carry sparse
`building_tone=commercial|destination|active`; absence means the neutral base building. The three
values preserve why the warm tone was selected even when a theme maps them to the same color.
Buildings may also carry World's `class`, their use in Overture's building subtype values; without
a tone, the buildings module colours `residential`, `commercial`, public buildings (`civic`,
`education`, `medical`, `religious` and the like) and works (`industrial`, `agricultural`,
`service`) with the theme's `residential`, `commercial`, `civic` and `industrial` building colours,
and every other building with `generic`. Building visibility is fixed by the layer zoom contract and never by optional semantics. The land
module also exposes
`medical`, `education`, and `government` independently instead of collapsing their already distinct
source classes into one civic color.

World and text assets are independent contracts. `tileflowWorld()` selects `world-v1/current` or an
exact `releaseId + descriptorSha256`; a `glyphs` declaration contains its own complete URL. Every
official map compiles as imported because it owns or inherits a URL or packaged-font provider.
URL-backed maps become exact-byte reproducible
when the immutable global base-asset set is published and their explicit URL is updated to its
`assetSetSha256` path; no World or compiler fallback participates in that rollout. The global
base-asset manifest's hash and a map build manifest's identically named `assetSetSha256` use
different contracts and must never be substituted for one another.

Upstream data attribution remains in the MapLibre source. `Map by Tileflow` is a separate product
credit/trademark surface and must not replace, obscure, or be presented as upstream attribution.
