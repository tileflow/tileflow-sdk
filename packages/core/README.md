# @tileflow/core

Define, validate, and compile Tileflow maps into MapLibre Style JSON. Core owns the map language;
it does not start a server, prepare files on disk, render a browser map, or deploy a hosted map.

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
- `icons` replaces the ordered directory list. Omission inherits it; `[]` disables it. Spread the
  parent's list explicitly when composing directories. Later directories win for an exact icon ID.
- `fonts` and `glyphs` are mutually exclusive text providers. Declaring either replaces the inherited
  provider. `data`, `projection`, `terrain`, and `marine` are also atomic.

Identity (`id`, `name`, `version`) and tooling `scenes` belong to the leaf map and do not inherit.
Module object order does not determine rendering order. See the
[map inheritance contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/map-inheritance.md)
for the complete merge rules.

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

`system` is a browser selection policy, not a stored theme. Builds, captures, static scenes, and
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
