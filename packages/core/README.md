# @tileflow/core

Define, validate, and compile Tileflow maps into MapLibre Style JSON. Core owns the map language;
it does not start a server, prepare files on disk, render a browser map, or deploy a hosted map.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha
```

`@tileflow/maps` is needed for the official map used below, not for every Core application. Use
ES module imports. For config loading and asset preparation, use the Node.js 22+ CLI or a build
integration. Browser applications should use a framework adapter with prepared assets.

## Define a map

Create `tileflow.config.ts`. Every public config exports one map:

<!-- docs:check -->

```ts
import {defineMap, labels, roads} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  modules: {
    roads: roads({detail: 'streets', hierarchy: 'clear'}),
    labels: labels({roads: 'major'}),
  },
  view: {center: [-3.7038, 40.4168], zoom: 12},
});
```

Coordinates use `[longitude, latitude]`. This map inherits Streets' themes and assets.
A standalone map uses `defineMap()` without `extends`.

Validate and preview the file with the project-local CLI:

```sh
npm install --save-dev --save-exact tileflow@alpha
npx tileflow validate --json
npx tileflow preview
```

Loading a config executes its imports. Treat it as trusted code, not as sandboxed JSON.

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
  provider. `atmosphere`, `data`, `projection`, `sky`, `terrain`, and `marine` are also atomic.

Identity (`id`, `name`, `version`) and tooling `scenes` and `shots` belong to the leaf map and do not inherit.
Module object order does not determine rendering order.

## Team Icon Sets foundations

`iconSet('@team/set')` is an explicit icon contributor alongside local and package-owned directories.
It performs no I/O. A resolved map accepts at most 32 contributors, and the same set reference may
appear only once. Shared sets use the same explicit array order and later-wins semantics as ordinary
icon directories.

An exact `tileflow.icons.lock.json` identifies immutable set revisions and generated artifacts. The
lock parser rejects duplicate JSON keys, stale reference sets, mixed Teams, invalid IDs, floating
versions, unsafe URLs, and manifest/hash mismatches. Serialization is canonical. Hashes are internal
integrity machinery, not identifiers that application authors manage.

Shared-set content identifies the effective published artifact. Git owns original artwork history;
source-only SVG edits producing the same artifact are not shared content changes. No original-source
hash, source format, or filesystem path is added to a shared package. Local/package originals retain
their existing source identity. Shared winners use explicit `rendered-icon` identity, while an
ordered versioned icon-composition receipt records consumed revisions separately, including
fully shadowed sets and dependency changes that preserve rendered pixels.

Map revision hashing preserves the existing v1 result for maps without shared sets. Maps with sets
require a complete receipt and use the domain-separated v2 revision contract. Build-manifest map
entries identify that contract with `mapRevisionSchemaVersion: 2`; omission means legacy v1. The
Metadata-free RGBA icon packages retain `tileflow-icon-package-v1` identity. SDF appearance or text-fitting metadata uses
`tileflow-icon-package-v2` and v2 composition receipts; defaults and layout participate in identity.

These are portable contracts. `@tileflow/dev` composes declared contributors on its normal
preparation path, and the `tileflow` CLI owns catalog management and exact lock maintenance.
Importing `iconSet` adds a declaration; it resolves no revision and does not by itself make a
Team catalog available to your deployment.

## Style with themes and semantic modules

`roads.pathGround` optionally gives surface paths different colors on mapped green ground and
elsewhere. It accepts `greenColor`, `groundColor`, optional `widthScale`, and `opacity` (zero
disables the treatment). The compiler keeps a complete ground-colored path, adds clipped green
portions from the same HTTP(S) vector source, and places paths below vehicle casings. Grass,
woods, wetlands, orchards, nurseries, and green recreation polygons supply context; polygon
holes remain unpainted. Classification follows tile geometry, not imagery or inferred climate.

Framework web adapters, CLI preview, capture, and the embedded mobile web runtime register the
derived-source protocol automatically. Raw MapLibre integrations must call
`registerTileflowPathGroundProtocol({addProtocol: maplibregl.addProtocol})` from
`@tileflow/core/browser` before creating the map. The `native-v1` build keeps the complete
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

Theme and `timeOfDay` changes animate over 450 ms by default, respecting reduced motion.
The same controller can make chosen modules recede and the map's labels fade so an application's
own content reads first.
It also sets the style-wide states that themes read with `expr.globalState`, easing numbers so the
values a theme interpolates on them move smoothly.
For application-drawn RGBA symbols, it also manages fixed-size
dynamic style images,
including state refresh, theme changes and restoration without changing layer placement.
Applications draw their own routes in the theme's inks, read with `getRouteInks()`, and draw them
on with `createTileflowLineProgress`. `createTileflowGroundLayers` keeps them under 3D buildings,
which hide them where they stand in front, and can show the hidden stretches faintly.
A theme can describe its sun and sky light (`lighting.sun`, `lighting.ambient`); the controller
returns the sun the map shows with `getSun()`, mixed during a blend, for an application's own 3D
layers, and `setSun()` places it by direction or by the real sun of a date and place.
`createTileflowBuildings3D` enables worker-meshed buildings rising in at zoom 15–15.3, with scene
sun, cast/contact shadows and 0.8 m rounded corners. Each effect is independently overridable.
Street lights default to off, including in Streets. Set `roads.streetLights.enabled: true` and mount
`createTileflowStreetLights` to enable them.
`createTileflowVegetation` controls all trees using the map's `3d`, `flat` or `auto` policy.

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
obsolete source fields `kind` and `style` are rejected. Completely unmanaged maps use upstream
MapLibre directly. Omitted themes use the manifest default, concrete themes select exact names,
and `system` requires the manifest's explicit light/dark mapping and a supplied runtime color scheme.
The pre-release React Native
package uses this contract for its mounted Map; it is not yet published.

## Data, terrain, and browser resources

Tileflow World is the hosted primary source. `vectorTiles()` with `openMapTiles()` supports
external local/self-hosted data; hosted eligibility is separate. `hostedTileset()`, `boundaryAreas`
and semantic overlays add named sources. Local PMTiles inputs are tooling-only.

`bathymetry({vectorLayers: {...}})` declares contour/name layers. `marine: 'nautical'` adds
navigation marks, flashing lights, and a "Not for navigation" notice.

World attribution links to Tileflow's source notice, OpenMapTiles, and OpenStreetMap. External
vector data retains the attribution supplied by its owner.

`projection` accepts `mercator` or `globe`. Terrain supports `none`, `hillshade`, `3d`, and an object
form for explicit hillshade and contour configuration. Browser-derived contours require a DEM tile
template, zoom limits, thresholds, and the Tileflow contour protocol. Framework adapters and local
tooling prepare browser resources; direct MapLibre integrations must register required protocols
before loading a style.

With `projection: 'globe'`, `atmosphere: true` adds a halo and stars; an object configures colors, star count and size.
`sky` follows the sun at street level. Frameworks and capture attach both; direct
MapLibre consumers call `attachTileflowAtmosphere(map)` from `@tileflow/core/browser`.

Applications that need the map's data themselves, such as streets to route over or the place
under the camera, read chosen layers of a vector source for an area at a fixed zoom with
`createTileflowTileReader` from `@tileflow/core/browser`, which also runs in a module worker.

Browser 3D scenes support `camera.adaptivePerspective`: caller override,
map default, then `false`. Streets enables it. Depth markers let buildings
occlude application markers.
Model roles use `modelLighting` for independent colours and materials. `colorScale` (0–1,
default 1) subtly darkens a role after recolouring. Map-shaded models share the buildings’
vertical/contact gradient; physical roles keep their own lighting. Model corner geometry is
authored in the asset, while ordinary tile corners use `edgeRadius`.

Text requires exactly one provider. Soundings and Blueprint use URL glyphs; Streets packages DINish
and Noto Sans; Baedeker, 1777 and Siegfried package Cormorant; Cívica packages its lettering. Hosted
rejects packaged/local fonts: self-host or replace them with compatible public glyphs. Tile and font
URLs do not grant redistribution rights.

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

## Flat footprints under 3D buildings

`modules.buildings.threeDimensional.flatFootprints` defaults to `true`. Set it to `false`
to suspend duplicate flat building fills, outlines and flat shadows in the shared 3D scene,
after its building entrance zoom. Roads then remain visible beneath open landmark structures.
Returning to 2D or disposing the scene restores their previous visibility; without WebGL2 the
flat fallback remains. Streets selects this option; other maps keep their authored treatment.
