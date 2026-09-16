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

Coordinates use `[longitude, latitude]`. The map inherits Streets' themes and asset providers.
A complete root map uses the same `defineMap()` call without `extends`; most applications should
extend an existing map instead of rebuilding its complete visual contract.

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
- `themes` replaces the complete collection and clears an inherited `systemThemes` mapping.
  `defaultTheme` can select an inherited concrete theme; `systemThemes` replaces its complete mapping.
- `icons` replaces the ordered contributor list. Omission inherits it; `[]` disables it. Local and
  package directories can be combined with explicit locked `iconSet('@team/set')` descriptors.
  Spread the parent's list explicitly when composing contributors. Later contributors win for an
  exact icon ID.
- `fonts` and `glyphs` are mutually exclusive text providers. Declaring either replaces the inherited
  provider. `data`, `projection`, `terrain`, and `marine` are also atomic.

Identity (`id`, `name`, `version`) and tooling `scenes` belong to the leaf map and do not inherit.
Module object order does not determine rendering order. See the
[map inheritance contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/map-inheritance.md)
for the complete merge rules.

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
ordered `tileflow-icon-composition-v1` receipt records consumed revisions separately, including
fully shadowed sets and dependency changes that preserve rendered pixels.

Map revision hashing preserves the existing v1 result for maps without shared sets. Maps with sets
require a complete receipt and use the domain-separated v2 revision contract. Build-manifest map
entries identify that contract with `mapRevisionSchemaVersion: 2`; omission means legacy v1. The
generated icon package remains `tileflow-icon-package-v1` and the asset-set hash is unchanged.

These are portable contracts. `@tileflow/dev` composes declared contributors on its normal
preparation path, and the `tileflow` CLI owns catalog management and exact lock maintenance.
Importing `iconSet` adds a declaration; it performs no I/O, resolves no revision, and does not by
itself make a Team catalog available to your deployment.

## Style with themes and semantic modules

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

The semantic domains are `land`, `water`, `nautical`, `roads`, `buildings`, `boundaries`, `labels`,
`poi`, `aeroways`, `transit`, `vegetation`, `addresses`, and `landforms`. Style stable geographic
targets rather than compiler-generated MapLibre layer IDs. Shared primitives cover fills, lines,
text, icons, circles, and extrusions. `zoom.*` supplies zoom curves; `expr.*` and `field(...)` supply
the closed data-expression language. `renderPass`, `refineRenderTarget`, and `withRenderStack` add
owner-local rendering behavior without bypassing the compiler.

## Compile and inspect

`validateTileflowMap(input)` returns `{valid, messages}`. `parseTileflowMap(map)` resolves and
validates the authoring input and throws on failure. `createStyle(map, options)` returns a style or
throws; `createStyleResult(map, options)` returns structured diagnostics and a compilation report.
Only a successful result contains `style`.

Core compilation is not asset preparation. A map that references package or local icon/font
directories needs the CLI, a build plugin, or
[`@tileflow/dev/artifacts`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md)
to produce deployable sprites and font files. Browser components consume the resulting manifest;
they do not import executable configs.

Use these commands to discover the installed language and inspect a prepared map:

```sh
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
See the [native source guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-resource-urls.md)
for source coordination, bounded acquisition and safe diagnostics. The private React Native package
currently exports type contracts, not a mounted Map component.

## Data, terrain, and browser resources

Tileflow World is the hosted primary-data path. `vectorTiles()` with `openMapTiles()` supports
compatible externally supplied vector data for local/self-hosted use; it does not make that source
eligible for hosted deployment. `hostedTileset()` and semantic overlay placement add named data
sources. Local PMTiles inputs are for local tooling, not implicit production data publication.

`projection` accepts `mercator` or `globe`. Terrain supports `none`, `hillshade`, `3d`, and an object
form for explicit hillshade and contour configuration. Browser-derived contours require a DEM tile
template, zoom limits, thresholds, and the Tileflow contour protocol. Framework adapters and local
tooling prepare browser resources; direct MapLibre integrations must register required protocols
before loading a style. See the
[browser runtime contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/framework-browser-runtime.md).

A map with text must declare exactly one text provider. Streets, Ferraris, Härad, Soundings,
Verdant, and San Francisto use URL glyph providers. Baedeker and Siegfried use packaged Cormorant
fonts; Cyberpunk and Matrix use packaged Oxanium fonts. Hosted deployment currently rejects
package/local font bundles; use self-hosted output or explicitly replace the provider with compatible
public glyphs. Tile URLs and font providers do not establish redistribution rights.

## Reference

Use the [generated language schema](https://github.com/tileflow/tileflow-sdk/blob/main/docs/modules-api-reference.json),
[cartographic authoring contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/cartographic-authoring.md),
and [public exports](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/src/index.ts)
for exact options. Prefer the installed CLI's generated contracts when using a published release;
`main` can contain unreleased changes. Report defects in the
[issue tracker](https://github.com/tileflow/tileflow-sdk/issues).

## Detailed guides

These guides are also included in the installed package under `docs/`. They describe this source
revision; prefer the installed copy when working with an older release.

- [Map and terrain examples](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/map-and-terrain-examples.md)
- [Authoring model](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/authoring-model.md)
- [Shared visual primitives](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/shared-visual-primitives.md)
- [Compiled-style performance](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/compiled-style-performance.md)
- [Themes and module styles](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/themes-and-module-styles.md)
- [Data is separate from design](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/data-is-separate-from-design.md)
- [Capture scenes](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/capture-scenes.md)
- [Public API and browser subpath](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/public-api-and-browser-subpath.md)
- [Hosted session authorization](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/hosted-session-authorization.md)
- [Native resource URLs](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-resource-urls.md)
- [Native artifact profile](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md)
