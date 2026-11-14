# Core reference

Detailed authoring and runtime contracts for `@tileflow/core`. Start with the
[README](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/README.md) to install the
package and preview your first map. For step-by-step guides, see the
[Tileflow documentation](https://tileflow.dev/docs).

This reference ships with the package. Use the copy included in your installed release for
version-specific behavior; the GitHub `main` branch can contain unreleased changes.

Core defines, validates, and compiles the map language. The CLI and build integrations prepare
assets; browser adapters render prepared maps. Loading a config executes its imports, so treat
it as trusted code.

- [Inheritance](#understand-inheritance)
- [Team Icon Sets](#team-icon-sets-foundations)
- [Themes and semantic modules](#style-with-themes-and-semantic-modules)
- [Compilation and inspection](#compile-and-inspect)
- [Prepared map sources](#select-a-prepared-map)
- [Data, terrain, and browser resources](#data-terrain-and-browser-resources)
- [Generated reference](#reference)
- [Native icon capabilities](#native-icon-capabilities)
- [Flat footprints under 3D buildings](#flat-footprints-under-3d-buildings)

## Understand inheritance

Omitted fields inherit, but declaring a field does not imply a recursive merge:

- `view` deep-merges; nested arrays replace.
- `modules` merges by domain. Declaring `roads(...)` replaces that domain's inherited request and
  render contributions. Use `refine(...)` to patch it, `disable()` to remove it, and `reset()` for
  an explicit reset inside a supported patch.
- `themes` replaces the complete collection and clears inherited `systemThemes` and `timeOfDay` mappings.
  `defaultTheme` can select an inherited concrete theme; `systemThemes` replaces its complete mapping.
- `icons` replaces the ordered contributor list. Omission inherits it; `[]` disables it. Local and
  package directories can be combined with explicit locked `iconSet('@team/set')` descriptors.
  Spread the parent's list explicitly when composing contributors. Later contributors win for an
  exact icon ID.
- `fonts` and `glyphs` are mutually exclusive text providers. Declaring either replaces the inherited
  provider and clears inherited `fontFallback`, unless that fallback is explicitly retained.
  `fontFallback: false` removes it; omission inherits it with the provider. `atmosphere`, `data`, `projection`, `sky`, `terrain`, and `marine` are also atomic.

Identity (`id`, `name`, `version`) and tooling `scenes` and `shots` belong to the leaf map and do not inherit.
Module object order does not determine rendering order.

## Team Icon Sets foundations

`iconSet('@team/set')` declares a contributor alongside local/package directories, without I/O.
Maps accept at most 32 contributors; set references must be unique. Explicit array order and
later-wins icon precedence apply to all contributors.

`tileflow.icons.lock.json` pins immutable set revisions and artifacts. Its parser rejects duplicate
keys, stale references, mixed Teams, invalid IDs, floating versions, unsafe URLs and manifest/hash
mismatches. Serialization is canonical; hashes are internal integrity details.

Delivery URLs require HTTPS, except canonical HTTP URLs on `localhost`, `127.0.0.1` or `[::1]`
for a local registry. A lock does not authorize downloads: the caller must explicitly trust that
exact origin through the development tooling's `deliveryOrigins` setting.

Shared identity follows published artwork, not source-only SVG edits yielding identical artifacts.
Git retains original artwork history. Shared packages contain no original-source hash, format or
filesystem path; local/package originals retain source identity. Shared winners use `rendered-icon`
identity. Ordered, versioned composition receipts record consumed revisions, including shadowed
sets and dependency changes preserving rendered pixels.

Maps without shared sets retain v1 revision hashing. Shared sets require complete receipts and the
domain-separated v2 contract, identified by `mapRevisionSchemaVersion: 2`; omission means v1.
Metadata-free RGBA packages retain `tileflow-icon-package-v1`. SDF appearance or text-fitting
metadata requires `tileflow-icon-package-v2` and v2 composition receipts, including defaults/layout.

`@tileflow/dev` prepares declared contributors; the CLI manages catalogs and exact locks.
Importing `iconSet` neither resolves revisions nor makes a Team catalog available to deployments.

## Style with themes and semantic modules

`roads.pathGround` optionally gives surface paths different colors on mapped green ground and
elsewhere. It accepts `greenColor`, `groundColor`, optional `widthScale`, and `opacity` (zero
disables the treatment). The compiler keeps a complete ground-colored path, adds clipped green
portions from the same HTTP(S) vector source, and places paths below vehicle casings. Grass,
woods, wetlands, orchards, nurseries, and green recreation polygons supply context; polygon
holes remain unpainted. Classification follows tile geometry, not imagery or inferred climate.

Tileflow's web maps (`@tileflow/dom` and the React, Vue and Svelte components), CLI preview,
capture, and the embedded mobile web runtime register the derived-source protocol automatically.
The `native-v1` build keeps the complete
ground-colored paths and disables the green overlay, since native renderers cannot run this
browser protocol. Its build record explicitly reports `pathGround: 'ground-fallback'`.

Themes are complete appearance documents, not loose color overrides. Every theme must supply the
same token schema. Use `token.color(...)`, `token.number(...)`, `token.image(...)`, and typed font
roles for theme-dependent values. Use `fixed(value, {reason})` for an intentionally invariant visual
value. Structural controls, such as visibility and zoom gates, remain ordinary literals.

Extend a theme without changing the inherited map structure:

<!-- docs:check -->

```ts
import {defineMap, defineTheme} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';

const dark = defineTheme(streetsThemes.dark, {
  id: 'madrid-dark',
  version: 1,
  colorScheme: 'dark',
  tokens: {color: {'surface.land': '#0d1320', 'surface.water': '#081e2e'}},
});

export default defineMap({
  id: 'madrid',
  version: 1,
  extends: streets,
  themes: {light: streetsThemes.light, dark},
  defaultTheme: 'light',
  systemThemes: {light: 'light', dark: 'dark'},
});
```

`system` is a runtime selection policy, not a stored theme. Builds, captures, static scenes, and
receipts must use a concrete theme such as `light` or `dark`.

Theme and `timeOfDay` changes animate over 450 ms, respecting reduced motion. Web manifests v3
add `familyUrl`, a bounded `tileflow-style-family` v1 document sharing structure and parameters;
flat `styleUrl` exports remain. `createTileflowStyleFamily` (`@tileflow/core/build`) factors styles;
`parseTileflowStyleFamily` and `materializeTileflowStyleFamily` (`@tileflow/core/runtime`) validate
and expand them. Parsing checks every theme without copying it and returns an already validated
family unchanged, so treat a parsed family as immutable. Controllers cache families. Compatible appearances preserve sources,
application layers and 3D palettes; structural variants swap styles. Feature-dependent branches
prepare once; discrete values and RGBA icons switch at the dominant theme without relayout.
Fades use premultiplied OKLab. Parameter columns are not semantic tokens.

`controller.setColors({'surface.water': '#008800'})` overrides named tokens; `{}` restores authored
colours. Values may be hex, `rgb()`, `hsl()`, `lab()`, `lch()`, `oklch()`, `oklab()` or `color-mix()` in `srgb`,
`srgb-linear`, `oklab` or `oklch`; they are converted to sRGB, with chroma reduced for a colour
outside the gamut. A value the SDK cannot read, such as `var(--x)` or a named colour, is an error
that names it. `createTileflowAppearanceBinding` (`@tileflow/core/browser`), which the React, Vue and
Svelte maps use for `colors` and `emphasis`, takes an `element` and resolves `var(--name, fallback)`,
also inside `color-mix()` and nested, against its computed style. It resolves again when the `class`,
`style` or `data-theme` attribute of `<html>` or `<body>`, or `prefers-color-scheme`, changes, and
shows colours again only if the result changed. A variable with no value and no fallback is reported
to `onError` with the `colors` part, by name. Fixed colours and application layers remain. A map may declare colour knobs with
`colorKnobs`: named colours with no dot that stand for many tokens, so `setColors({water: '#2563eb'})`
works without naming a token. A knob lists its tokens, each with an operation: `replace` gives the
token the colour; `shift` moves it by as much as the knob's `reference` token moves to reach the
colour, so tokens lighter or darker than the reference stay so; `mix` moves it `amount` of the way;
`tint` keeps its lightness and takes the colour's hue and chroma (`chroma` scales it). Any operation
may add a `lightness` offset, and a token's own alpha is kept. Knobs start from the colours of the
theme on screen, so each theme keeps its own offsets. A token has one knob; a token named in
`setColors` wins over its knob; an unknown knob is an error that lists the map's knobs. Derived
maps inherit knobs, entries replace by name, and `remove()` drops one. Streets' knobs are listed in [its reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/maps/REFERENCE.md#streets-colour-knobs). Web builds retain token bindings; direct
`createStyle` calls opt in with `runtimeColors: true`. `createTileflowAppearanceController().set()`
selects author-owned `fixed`, `system` or local `clock` behaviour without UI or location requests.
Profile performance on target devices.

Theme controllers also provide module/label emphasis, eased numeric `expr.globalState` values,
and fixed-size dynamic RGBA images with state refresh and restoration across theme changes.
`getRouteInks()` supplies route colours; `createTileflowLineProgress` animates drawing routes.
`createTileflowGroundLayers` places them under 3D buildings, optionally showing occluded stretches
faintly. Themes declare `lighting.sun` and `lighting.ambient`; `getSun()` returns the displayed
sun. `setSun()` accepts angles or a date and location. Transitions
mix 3D directions (angular fallback for opposite vectors) and OKLab light colours.

`createTileflowBuildings3D` enables worker-meshed buildings rising at zoom 15–15.3, scene sun,
cast/contact shadows and 0.8 m rounded corners; effects are independently overridable. Its
`tileflow-buildings-scene-3d` layer replaces `tileflow-buildings-native-extrusion` only after visible
building tiles draw. Until then the native extrusion leaves out the buildings that landmarks and
placed models stand in for (`standIns`). It draws once their footprints round the view are known, or
their downloads have taken 1.5 s, and after a change only once its tiles are read again. Failure
keeps the native fallback; 2D restores authored visibility.
Street lights default off, including in Streets: enable `roads.streetLights.enabled` and mount
`createTileflowStreetLights`. `createTileflowVegetation` follows the map's `3d`, `flat` or `auto` policy.

POI icons and names place together; `placement.coupleIconAndLabel: false` separates them.

The semantic domains are `land`, `water`, `nautical`, `roads`, `buildings`, `boundaries`, `labels`,
`poi`, `aeroways`, `transit`, `vegetation`, `addresses`, and `landforms`. Style stable geographic
targets rather than compiler-generated MapLibre layer IDs. Shared primitives cover fills, lines,
text, icons, circles, and extrusions. `zoom.*` supplies zoom curves; `expr.*` and `field(...)` supply
the closed data-expression language. `renderPass`, `refineRenderTarget`, and `withRenderStack` add
owner-local rendering behavior without bypassing the compiler. A pass, or a target its module moves,
is placed at a band edge such as `'above-relief'` or `'below-labels'`, or `{above}` / `{below}` one
semantic target.

## Compile and inspect

`validateTileflowMap(input)` returns `{valid, messages}`. `parseTileflowMap(map)` resolves and
validates the authoring input and throws on failure. `createStyle(map, options)` returns a style or
throws; `createStyleResult(map, options)` returns structured diagnostics and a compilation report.
Only a successful result contains `style`.

Compilation compacts redundant expressions and shares repeated predicates and values with
MapLibre `let` bindings. Themes still produce standalone Style JSON, with the same layer order,
appearance and assets. Inspect semantic targets rather than depending on the emitted expression
shape; it may change when the compiler removes repetition.

Maps with package/local icon or font directories need the CLI, a build plugin, or
[`@tileflow/dev/artifacts`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md)
to prepare assets. Browser components consume the resulting manifest.

Discover the language and inspect a prepared map:

```sh
npx tileflow describe themes --json
npx tileflow language manifest --json
npx tileflow language schema --json
npx tileflow inspect --json
npx tileflow explain --theme dark --json
npx tileflow semantic-diff --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
```

The language manifest is also exported as `tileflowAuthoringManifest`, with
`tileflowAuthoringManifestSchemaVersion`. The generated schema distinguishes authoring input from
resolved compiler input. `diffTileflowMaps(before, after)` returns deterministic semantic changes
at JSON Pointer paths. Physical inspection IDs and indexes are diagnostic observations, not stable
application targets.

## Select a prepared map

React, Vue and Svelte accept a required `source` object, `{map, manifestUrl?}`. `map` is the portable
name in the manifest, not a Hosted `map_...` identifier. An omitted web `manifestUrl` means exactly
`/tileflow/manifest.json`; custom paths and external hosts must be explicit. The native Core and
React Native type contracts use `{map, manifestUrl}` with an explicit absolute URL. They do not
infer an application origin, Metro host or manifest location.

<!-- docs:check -->

```ts
import type {TileflowNativeSource} from '@tileflow/core/native';
import type {TileflowRuntimeSource} from '@tileflow/core/runtime';

const webSource = {map: 'madrid'} satisfies TileflowRuntimeSource;
const nativeSource = {
  map: 'madrid',
  manifestUrl: 'https://maps.example.com/tileflow/native/manifest.json',
} satisfies TileflowNativeSource;
```

These objects select existing prepared maps; they do not compile or render one. Every Tileflow
framework Map is manifest-backed, without a renderer discriminator or direct-style mode. The
obsolete source fields `kind` and `style` are rejected. Omitted themes use the manifest default, concrete themes select exact names,
and `system` requires the manifest's explicit light/dark mapping and a supplied runtime color scheme.
The pre-release React Native
package uses this contract for its mounted Map; it is not yet published.

## Data, terrain, and browser resources

Tileflow World is the hosted primary source, with an open (CC0)
[schema](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/reference/tileflow-world-v1.json);
detail layers load only when drawn. `vectorTiles()` takes that schema or OpenMapTiles
(`openMapTiles()`). `hostedTileset()`, `geojsonSource()`, `boundaryAreas` and overlays add named
sources.

`geojsonSource()` declares GeoJSON in `sources`, and `clusterOverlay()` and `heatmapOverlay()` return
ordinary overlays that keep `placement`, `remove()`, and `tileflow validate`:

<!-- docs:check -->

```ts
import {clusterOverlay, defineMap, geojsonSource, heatmapOverlay} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'store-locator',
  version: 1,
  extends: streets,
  sources: {
    stores: geojsonSource({
      attribution: 'Stores © Example',
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    }),
  },
  overlays: {
    density: heatmapOverlay({
      id: 'density',
      maxZoom: 9,
      placement: 'below-labels',
      source: 'stores',
    }),
    stores: clusterOverlay({id: 'stores', placement: 'above-labels', source: 'stores'}),
  },
});
```

Omit `data` to fill the source at runtime through a framework adapter's `dataSources`. Inline `data`
is limited to 512,000 bytes; larger files use an absolute `https://` URL. Clustering options keep
their MapLibre and Mapbox names. A cluster overlay over a source without `cluster: true` fails
validation with `TF_OVERLAY_CLUSTER_SOURCE_INVALID`, and a map with no label font and no `font` option
fails with `TF_OVERLAY_FONT_UNAVAILABLE`. Web helpers are also exported from
`@tileflow/core/runtime`. `heatmapOverlay()` also accepts `sourceLayer` for hosted vector tilesets,
which cannot cluster. See the
[interactions reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/interactions/REFERENCE.md)
for runtime data, click-to-expand, and React Native support.

`bathymetry({vectorLayers: {...}})` declares contour/name layers. Bathymetry V1 bands use
negative `depth` values and cumulative deeper-than polygons; the compiler paints shallower
polygons first. Compatible older sources retain `min_depth` and `sort_key`. Native contour
lines use `depth`; declare `vectorLayers.contours: true` to avoid outlining polygon tile edges. `marine: 'nautical'` adds
navigation marks, flashing lights, and a "Not for navigation" notice.

`circular_feature` optionally retains `network` (a normalized road-network string; coverage is
partial) and `official` (a numeric path-status indicator). For paths, footways, cycleways and
bridleways, `official=0` means OSM marks the way `informal=yes`; `official=1` means `informal=no`
or a recorded operator, unless `informal=yes`. Absence means unknown or not applicable.
This indicator does not establish legal recognition or public access.

World attribution credits Tileflow and OpenStreetMap; other vector data keeps its owner's
attribution.

`projection` accepts `mercator` or `globe`. Terrain supports `none`, `hillshade`, `3d`, and an object
form for explicit hillshade and contour configuration. Browser-derived contours require zoom limits,
thresholds, and the Tileflow contour protocol. They read the terrain's DEM: `contours.demUrl` when
given, else the first `terrain.tiles` template, else the `terrain.url` TileJSON, which defaults to
hosted Tileflow Terrain. A TileJSON is read when the first contour tile is requested; its first tile
template is the DEM, so contours follow the same Terrain release and map binding as hillshade.
Tileflow's web maps register the contour protocol once per page and send each map's DEM TileJSON
(`Source`) and DEM tiles (`Tile`) through that map's own `transformRequest`, so contour requests
carry the map's current `session` and `grant`, as hillshade tiles do. Local tooling prepares the
same resources.

### Catalog branding

The React, Vue, Svelte, React Native and embedded mobile maps manage the Tileflow logo in the
lower-left corner automatically. Preview and capture include it too. The logo is the wordmark with
the symbol, in white with a soft dark halo and no background; browser maps 250 px wide or narrower
show the symbol alone. It links to https://tileflow.dev and follows the active catalog sources,
independently of data attribution.
Own and third-party tiles do not require the Tileflow mark. Public Tileflow catalog delivery shows
it; catalog delivery bound to a Map ID reads the owner's current branding entitlement. A paid map
never inserts a provisional mark. While a managed decision is unavailable, the surface remains
hidden instead of guessing Free; it retries and renews a short-lived decision while mounted.

The symbol stays when an application turns off MapLibre's other controls. Applications that
rewrite source URLs in `transformRequest` must keep their source identity. This presentation control cannot prevent a modified open-source client from removing DOM;
service branding requirements and third-party attribution obligations still apply.

### Create the map with Tileflow

Applications create a map with `@tileflow/dom` or the React, Vue or Svelte component, not with
`new maplibregl.Map(...)`. The map prepares its style before MapLibre sees it: flat styles or shared
families, with sprites, glyphs, fonts, sources and model/landmark URLs resolved against the
documents that declare them, and the fonts loaded. It registers Tileflow's protocols, sends hosted
requests with the map's session, and switches themes without replacing the MapLibre instance.
Style and TileJSON requests go through the application's `mapOptions.transformRequest` as
`Style` and `Source`; defaults use same-origin credentials and reject redirects, and invalid
documents, failed requests and size limits (style/family: 16 MiB; TileJSON: 1 MiB) stop the map with
a `runtime` error.

The MapLibre instance itself stays the application's to extend: `getMap()` (or the `onLoad`
argument) is the real `maplibregl.Map`, for layers, sources, controls, events and other libraries.
Tileflow owns the style it applied and the resources it added. A theme change may replace that
style, keeping the camera: add application layers and sources again on `style.load`, or declare
them as the map's `dataSources` and `dataOverlays`, which Tileflow puts back after every theme
change. Take the map down with the component or `destroy()`; `getMap().remove()` also stops the
controller.

`@tileflow/core/internal` holds the pieces Tileflow's own packages build the map from. It is not a
public API and changes in any release.

With `projection: 'globe'`, `atmosphere: true` adds a halo and stars; an object configures colors, star count and size.
`sky` follows the sun at street level. Tileflow's web maps and capture attach both.

Applications that need the map's data themselves, such as streets to route over or the place
under the camera, read chosen layers of a vector source for an area at a fixed zoom with
`createTileflowTileReader` from `@tileflow/core/browser`, which also runs in a module worker.

`buildings({mode: 'flat', extrusion: {visible: false}})` retains flat footprints without
declaring a 3D building scene or requesting building models. Camera pitch limits also apply to
flat maps through `attachTileflowMap3D`, without loading the 3D renderer.

Browser 3D scenes resolve `camera.adaptivePerspective` from caller override, map default, then
`false`; Streets enables it. Buildings occlude depth markers. `camera.pitchLimit: {maxZoom, maxPitch}`
caps inclination through `maxZoom`, respecting stricter application caps. Closer views and disposal
restore the application's maximum. A `jumpTo`, `easeTo`, `flyTo` or `fitBounds` whose target zoom is
above `maxZoom` keeps its requested pitch throughout, even when it starts at an overview; a movement
that stops at or below `maxZoom` is capped again.
3D layers prioritize visible ground from viewport bottom toward the horizon. Buildings fade across
the far boundary, followed by haze. Coverage follows resize and projection within each layer's
`maxTiles` budget (default 25), prioritizing nearest ground.
Model roles use `modelLighting` for colours/materials and `colorScale` (0–1, default 1) for darkening
recoloured assets. Ordinary facades use soft daylight and a gradient through their lower 85%, leaving
roofs and upper edges light. Map-shaded models retain a short base gradient; physical roles retain
their lighting. Model corners belong to the asset; ordinary buildings use `edgeRadius`.
`buildings.threeDimensional.entrance: false` shows buildings/models at full height and opacity at
entrance zooms, without zoom/arrival growth or fading. Equal endpoints such as
`entrance: {buildings: [14.25, 14.25], models: [14.25, 14.25]}` switch immediately at that zoom.

Text requires exactly one provider. Streets, Outdoors and Soundings use URL glyphs from Tileflow's
official glyph set, whose URL composites a comma-joined stack of its fonts per code point.
Community Blueprint also uses URL glyphs; Baedeker, 1777 and Siegfried package Cormorant. A map
that declares `fonts` replaces inherited glyphs: Hosted deploy uploads its used faces and licenses as a
font bundle before publishing the style. With `platforms: ['web', 'native']`, native styles use
the same TTF/OTF files through `font-faces`; WOFF2 is supported only for web. Tile and font URLs
do not grant redistribution rights.

To fill missing characters with shared official fonts, import `officialFontFallback` from
`@tileflow/core` and declare `{fonts: ['./fonts'], fontFallback: officialFontFallback}`.
Local faces come first; the fallback uses complete, immutable Noto files with verified character
coverage. No official font binary is embedded in the map's private bundle or the SDK package.
Existing maps keep their provider and renderer behavior until they opt in.

This mode requires MapLibre GL JS 6.16 or newer and uses the same font files on iOS and Android.
Native offline downloads include the shared files and licenses. The reviewed set uses Regular Noto
faces across scripts, including CJK with Japanese default glyph forms; it does not promise coverage
of every Unicode character. Its deployment requires the corresponding shared set to be available.

`labels.roadPlacement: 'readable'` draws complete street names above the 3D scene, below foreground
destinations. Tileflow's web maps, preview and capture add per-instance visibility to supported
MapLibre WebGL2 line-symbol buffers. Asynchronous depth queries hide whole names whose ground anchors are
occluded, without changing source filters or collision placement. Above 40° the distant view is
reduced, at 55° names beyond the centre yield, and at 60° only the near foreground remains.
Native renderers, terrain, globe and unsupported browser bucket layouts keep complete text above
buildings.
The adapter does not reproduce Mapbox's proprietary layout engine or its placement transitions.

`glyphs.fontStacks` lists the stacks the provider serves, exactly as MapLibre joins a `text-font`
array with commas. A Tileflow glyph set URL (`/base/<assetSetSha256>/glyphs/{fontstack}/{range}.pbf`)
combines fallback stacks, the first font holding a glyph winning, so there it is enough to declare
each font: a `text-font` list of at most 10 declared fonts is accepted without declaring the joined
stack. A declaration naming more than 10 fonts, or a font a known Tileflow glyph set does not
publish, is rejected. Other providers must declare every joined stack the styles use.

Labels use English by default. Set `labels({language: 'es'})` for Spanish, another BCP 47 code
such as `es-MX` for a regional preference, `auto` for the renderer's browser/device locale, or
`local` for each feature's source name. This policy is shared by geographic labels, roads,
POIs and landforms. A missing or empty translation falls back to the local name, then available
Latin/English names; it never translates a name that the source does not supply. `auto` resolves
at render time, so compiling on a server does not select that server's locale.

POI `minZoomByType` supplies display zoom floors by canonical World type, in addition to density
and `maxRankByType`. `labelMinZoomByType` delays names independently, allowing an eligible transit
pictogram to precede its localized name. `placement.prominentImportance` promotes admitted POIs at or above a World
importance tier to the prominent placement group, independently of their spatial density rank.
It can be combined with `prominentRank`; neither option bypasses the selection filters.
`placement.unnamedIconTypes` allows specific pictograms without a source name, while drawing their
name when available. `iconOnlyTypes` always suppresses the name instead.

## Reference

Use the [generated language schema](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/reference/modules-api-reference.json),
and [public exports](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/src/index.ts)
for exact options. Prefer the installed CLI's generated contracts when using a published release;
`main` can contain unreleased changes. Report defects in the
[issue tracker](https://github.com/tileflow/tileflow-sdk/issues).

## Native icon capabilities

Prepared icon metadata identifies SDF assets and their default fill and halo. Core rejects any
symbol layer that can select both SDF and RGBA, including fallbacks and effective local overrides,
with `TF_ICON_REPRESENTATION_MIXED`. It preserves layers, collisions and interaction IDs. Omitted
SDF paint follows the resolved image selection; supplied map paint stays independent from asset
defaults. See [Author recolorable and adaptable icons](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md).

Land may supply a georeferenced `globalLandcoverUnderlay` image with `url`, four
`coordinates` (northwest, northeast, southeast, southwest), `attribution`, zoom bounds
and themed `opacity`. It is drawn below global cover and omitted when land is disabled.
Tree forms may use `sizeAnchor` and `crownAnchor` (metres) with `sizeCompression`
from 0 to 1 to reduce size variation while preserving each tree’s proportions.
Decorative canopy clearance bounds the available space; it is not a measured crown diameter.
When canopy height is available, inferred crowns also follow the selected tree form's proportions.
Individually mapped trees retain their measured dimensions. Hedges use continuous, joined surfaces
with a 0.5 m footprint, a flat top, and clipped tile boundaries; tree size controls do not resize them.

## Flat footprints under 3D buildings

`modules.buildings.threeDimensional.flatFootprints` defaults to `true`. Set it to `false`
to suspend duplicate flat building fills, outlines and flat shadows in the shared 3D scene,
after its building entrance zoom. Roads then remain visible beneath open landmark structures.
Returning to 2D or disposing the scene restores their previous visibility; without WebGL2 the
flat fallback remains. Streets selects this option; other maps keep their authored treatment.

## Runtime sources and layers

The unreleased `@tileflow/core/browser` runtime controller backs `@tileflow/dom`, which owns the React, Vue and Svelte
component references. It accepts JSON style-spec definitions and owns only resources registered
through its methods. Existing raw MapLibre callbacks remain available; mutations through them are
outside the controller's restoration contract.

| Method                            | Behavior                                                                |
| --------------------------------- | ----------------------------------------------------------------------- |
| `addSource(id, definition)`       | Register a new application source; reject existing IDs.                 |
| `removeSource(id)`                | Remove an owned source after its dependent layers have been removed.    |
| `addLayer(definition, position?)` | Register an owned layer; non-background layers require an owned source. |
| `moveLayer(id, position?)`        | Reorder an owned layer, optionally changing its slot explicitly.        |
| `removeLayer(id)`                 | Remove an owned layer.                                                  |

Operations return promises. They wait for initial readiness and pending style transactions.
Disposal and initialization failure reject pending work. The controller composes registered
resources into theme/blend targets before applying them, including rollback; it never adopts base
resources or resources added outside that controller.

Slots use the map's published overlay-placement manifest: `above-water`, `below-roads`,
`above-roads`, `above-buildings`, `below-labels`, and `above-labels`. An omitted/null slot on insertion
places the layer above the map. On a move, omission preserves the slot; null removes it.
`slotIndex` is a zero-based index among owned layers in the target slot, excluding the moving layer.
The insertion range is zero through that count, inclusive. Omitting a position appends within the
slot. `aboveLayerId` and `belowLayerId` are alternative positions; combining them with another
position, using an unknown reference, or crossing slots rejects before mutation.

`TileflowRuntimeStyleError` exposes `code` and structured `context`. Position conflicts use
`invalidRequest` with reason `layerPositionConflict`, the affected IDs and slots, the field path,
and correction codes/messages. This rejection deliberately differs from Mapbox's cross-slot
reference behavior; `slotIndex` does not claim equivalence to Mapbox `layerIndex`.
