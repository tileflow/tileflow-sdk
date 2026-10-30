# @tileflow/dev

Node.js utilities for custom Tileflow build tools and development servers. Load a trusted
`tileflow.config.ts`, prepare its assets, and produce a validated artifact generation.

Most applications should use the [CLI](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md)
or the [Vite](https://github.com/tileflow/tileflow-sdk/blob/main/packages/vite/README.md),
[Next.js](https://github.com/tileflow/tileflow-sdk/blob/main/packages/next/README.md), or
[Webpack](https://github.com/tileflow/tileflow-sdk/blob/main/packages/webpack/README.md) integration.
This package is for implementing an integration, not for browser rendering.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use Node.js 22 or newer:

```sh
npm install --save-dev @tileflow/dev@alpha @tileflow/core@alpha @tileflow/maps@alpha
```

Create a trusted `tileflow.config.ts` in the working directory:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({id: 'madrid', version: 1, extends: streets});
```

Loading the config executes its imports. It is not a sandbox for untrusted code. Local preparation
needs no API key, but serving a map can still cause requests to its remote data or font providers.

The CLI's local Inspector provides a dockable layer inspector, loaded tiles, assets, scene
controls and frame timing. Its element picker selects a layer and evaluates its rules using the
feature clicked on the map.
Debug's Overdraw overlay uses a heatmap with a visible pass-count legend and explanation.

## Prepare a generation

<!-- docs:check -->

```ts
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

const artifacts = await createTileflowBuildArtifacts({config: 'tileflow.config.ts'});

try {
  console.log(artifacts.manifest);
  console.log(Object.keys(artifacts.styles.madrid));
} finally {
  await artifacts.dispose?.();
}
```

The artifact plan exposes files and observed inputs from the same generation. Styles are keyed as
`styles[map][theme]`, never as an implicit default-theme alias. Keep that generation alive for the
whole operation, then release it. Do not reconstruct its asset list from directory guesses.

Map-owned tree models are prepared alongside icons and embedded in the styles. Custom tools that
compile icons separately can use `prepareTileflowMapTreeModels` from `@tileflow/dev/icons` with
the map's model directories, base directory, working directory, target and diagnostic path. Pass
its `models` result as `preparedAssets.models` when compiling the style; retain its source
identities and watch paths when managing revisions. The artifact pipeline does this automatically.
A GLB whose materials name only `bark`, `leaves`, `fronds` or `stem` is a tree model; any other
is a building model, whose materials name its parts.

To write production output rather than manage it in memory:

<!-- docs:check -->

```ts
import {writeTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

await writeTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
  outDir: 'public/tileflow',
});
```

Serve the complete output. The writer installs immutable generation assets before changing the
manifest pointer, tracks its own files, and refuses to replace a hosted manifest by default.
Native builds retain embedded PNG image sources as hashed files beside the styles, so their
resource URLs remain portable without permitting data URLs in the native profile.
`overwriteHostedManifest: true` is an explicit migration option, not a normal build setting.
Production rejects unresolved local PMTiles; publish data explicitly or provide an application-owned
production source. Local development snapshots do not publish or redistribute the original dataset.

Maps whose labels use a line-fitted `text.background` draw text with derived glyph stacks. Local
previews and captures route such a map's glyph URL through `__glyphs/<map>/…`. Ordinary stacks pass
through from the declared provider; derived ranges are computed from their source ranges, which are
cached under `.tileflow/cache/glyphs/v1`. Production output keeps the declared provider, which must
serve derived stacks.

## Keep a watched request handler

Use one session for repeated work and close it when the owning server stops:

<!-- docs:check -->

```ts
import {createTileflowArtifactSession} from '@tileflow/dev/artifacts';
import {createTileflowDevRequestHandler} from '@tileflow/dev/server';

export async function createMapHandler() {
  const session = await createTileflowArtifactSession({
    config: 'tileflow.config.ts',
    watch: true,
  });
  const handler = createTileflowDevRequestHandler({session});

  return {
    fetch: handler,
    async close() {
      await handler.close();
      await session.close();
    },
  };
}
```

The caller mounts `fetch` in its server and calls `close()` on shutdown. This factory does not open
a listener. Sessions follow config imports and local asset inputs, retain the last good generation
after invalid edits, and publish structured state changes through `subscribe()`.
Session creation waits for the first valid generation or a settled invalid result, including
when a watched edit replaces the initial build before it finishes.
Watching follows aliased working directories, including newly created or removed icon metadata.
Package assets resolve from the config directory. Linked package assets inside the selected working
tree are watched too; installed assets in `node_modules` remain immutable.

A single startup consistency check complements ordinary watcher notifications; no recurring scan
is added.

`getState()` and `getLastGoodArtifacts()` return borrowed synchronous views. Before asynchronous
work, call `acquireArtifacts(generation?)` and release the acquisition in `finally`. A replaced
generation accepts no new acquisitions; closing a session waits for existing acquisitions.

## Choose an entry point

Use `/artifacts` for preparation and output, `/server` for HTTP handling, `/config` for trusted config
loading, `/icons` and `/fonts` for asset preparation, `/inspect` for bounded inspection, `/tilesets`
for local PMTiles inspection, and `/validation` for diagnostics. `/preview` is the local preview
contract, including experimental preview-only rendering; it does not promise hosted support.
The package has no root entry point. `/server` also exposes the reusable Inspector shell. The CLI
connects appearance controls and shared browser context through its optional local
workflow adapter.
The navigation contains **Map**, **Layers**, **Tiles**, **Assets**, **Debug** and **Diagnostics**.
Zoom, Pitch and Bearing appear as **Z**, **P** and **B** directly below it, with live Zoom and Pitch
sliders and **Copy for AI**. Pitch and Bearing each have an inline reset to 0° within the map's
camera limits. Camera resets preserve the current zoom and map position.
The active tab and selected layer remain in the URL across reloads. The menu provides left,
right and bottom docking, System/Light/Dark appearance, and **Reset all changes**.
Side docking has a minimum width of 640 CSS pixels, including restored layouts.

**Map** exposes time-of-day segments, theme cards with actual style swatches, 3D view,
Off/Grow/Fade building animation, and the map's module settings. The command selects the map.
Streets shows **Default**, **Faded** and **Monochrome**; Default keeps the compatible `light`
theme ID in configs, URLs and capture commands. Time of day is selected independently.
3D view defaults to on for every map. Buildings fade in between zoom 15 and 15.25.
Toggling 3D view preserves the camera, including pitch; an explicit off setting stays off.
Changes update the existing map after a 300 ms pause while the form remains editable. Superseded
compilations are discarded. Runtime controls do not recompile the style. Scene and layer edits
share the header Undo/Redo controls; source files stay unchanged.

**Layers** groups physical and runtime layers by module or draw order. Hover highlights geometry;
selection keeps it highlighted independently of the element picker. The picker opens the clicked
feature's layer in **Rules**. Rules expose live colors, numeric sliders, enums, expression curves,
defaults, and checkboxes for temporarily disabling paint, layout and filters. Diagnosis, Data and
Origin explain renderer state, sample features and available compiler provenance. **Visible**
filters to the current viewport. Context can be reviewed as Markdown or JSON before copying.

**Tiles** shows resident map tiles as a coordinate grid and source-grouped list. Source layers,
Features and Info expose raw payload sizes, consumer layers, paginated features, GeoJSON and bounds.
Inspection reads resident data without issuing tile requests. MLT and inaccessible renderer data
have explicit unavailable states.

**Assets** separates Icons, 3D models and Fonts. Icons lists real registered images and loads actual
sprite variants for the map's themes and times of day. Models previews bounded samples of loaded
controller meshes, with available counts, bytes and LODs. Fonts renders editable samples from actual
font files or glyphs and links back to consuming layers.

**Debug** contains overdraw, collision and tile-boundary overlays, explanations, and controls for
the map's actual pixel ratio. **Diagnostics** lists actionable findings under Readability, Style,
Assets and Performance. Problems identify confirmed failures; Review findings describe situations
that can be intentional. There are no quality scores or automatic camera tours. Style checks refresh
when the map changes; **Check view** collects bounded current-view evidence and briefly samples
drawing work. Findings open the affected layer and rule, show available evidence, and copy context
for an agent. Unavailable observations and stale results remain explicit. **Diagnosis** in
Layers describes the selected layer's zoom, visibility and feature-rule context without turning
empty viewport queries into errors. Legacy `tab=beacon` links open Diagnostics.

The preview's globe rim follows the rendered canvas silhouette, including camera and viewport
changes, and fades between zooms 3 and 6. Its colors follow the map's atmosphere when declared.

Invalid compiled styles throw `TileflowStyleValidationError` with bounded issues. Keep diagnostics
structured; do not return executable config, local paths, credentials, or complete generated byte
arrays from a public endpoint.

## Locked Icon Set composition

`composeTileflowIconSources(sources, {cwd, lock, cacheRoot, offline: true})` combines local/package
directories and `iconSet('@team/set')` contributors into one effective sprite. Without an explicit
lock object, it reads `tileflow.icons.lock.json` beside `baseDirectory` (default: `cwd`). It never
resolves latest or writes the lock. The result contains the generated `package`, ordered
`composition` receipt, effective `sourceIdentities`, declared `contributors`, effective `winners`,
replacement ordinals, local `watchPaths`, and the exact `watchFiles` that select the composition.
Pass both the source identities and receipt to Core map-revision hashing.

This is the one normal icon-preparation path. `compileTileflowIconPackages`,
`prepareTileflowCatalogIcons`, `inspectTileflowIconCatalogs` and `getTileflowIconWatchPaths` all use
it, so `createTileflowBuildArtifacts`, `createTileflowArtifactSession`, and every adapter that
enters them accept the same explicit `icons` resolution options: `cacheRoot`, `offline`,
`deliveryOrigins`, `fetch` and `signal`. An explicit `cacheRoot` takes precedence over
`TILEFLOW_ICON_CACHE_DIR`, then the OS cache default. Origins and transport use their documented
defaults unless supplied explicitly; no build or watch polls a catalog head. `prepareTileflowCatalogIcons`
returns `mapIconCompositions` alongside `mapIconSources`, and build-manifest entries carry the
receipt as `sourceAssets.iconComposition` with `mapRevisionSchemaVersion: 2`.

A map whose contributors are all local or package directories keeps its existing generated bytes,
manifest and content hash, and its build-manifest entry stays on the legacy v1 contract.

The reader verifies each file length/checksum, PNG/index geometry, names, density pairing, and both
per-icon pixel hashes. It copies decoded 1x and 2x cells independently, without resampling either.
The existing directory compiler and this port share the same sprite packer. A sole shared set reuses
its exact artifact; mixed inputs are packed deterministically. Later contributors win and all
dependencies remain in the receipt, even when entirely shadowed. Shared inputs never pretend to
contain original SVG/source identities. Existing local-only compilation remains unchanged.

`storeTileflowIconSetArtifact` seeds an exact verified cache entry. `loadTileflowIconSetArtifact`
uses the cache or hydrates only the selected artifact's four public files. Hydration defaults to the
trusted `https://api.tileflow.dev` origin, sends no credentials, and follows no redirects.
Applications may explicitly configure trusted `deliveryOrigins`; locks cannot add them. `offline`
forbids all fetches and fails on missing or corrupt entries. Complete-map offline rendering still
depends on unrelated tiles, glyphs, and other external resources.

The cache lives under the OS user cache with `tileflow/icons/v1/<contentHash>`. `cacheRoot`, then
`TILEFLOW_ICON_CACHE_DIR`, overrides its parent. Atomic directory installation and exact-entry
retirement support concurrent writers and corruption repair. Symlink entries are rejected. This is
a disposable cache, not a security sandbox against another process controlling the same user
account. Incomplete temporary entries are never accepted as published cache entries.

`readTileflowIconsLockfileText(directory)` returns the exact current lock bytes, or `null` when no
lock exists; those bytes are the only valid `expectedContents` for the next write.
`writeTileflowIconsLockfile(directory, lock, expectedContents)` uses a whole-file compare-and-swap
and atomic rename. A conflicting writer fails without overwriting pins. An interrupted writer leaves
the previous complete lock intact; remove a stale `.writing` guard only after confirming that its
writer has exited. Ordinary reads and Core validation never acquire write guards.

A package supports up to 1,000 effective icons, subject to a 2,048-pixel atlas dimension,
4 MiB per generated file, and 8 MiB per package. Paired densities share a logical layout capped
at 1,024 pixels per dimension at 1× and 2,048 at 2×. Mixed-size artwork retains matching placements
without resampling either density. Larger artwork can hit those limits before
1,000 icons. Several individually valid sets can exceed the effective map limit; composition
fails explicitly instead of clipping. Cache and composition do not create Team resources or
publish anything. Every normal entry point composes declared shared descriptors through this path;
catalog publication and lock maintenance stay in the `tileflow` CLI, which is the only writer of
`tileflow.icons.lock.json` and the only caller that resolves `latest`.

## Recolorable icons

Declare SDF defaults and optional stretch/content layout in `tileflow.icons.json` beside ordinary artwork. Preparation
verifies both densities and rejects mixed representations within one symbol layer, including
fallbacks and local overrides.
