# @tileflow/dev

Node utilities used by the Tileflow CLI and build integrations.

Most apps should use `@tileflow/cli`, `@tileflow/vite`, or `@tileflow/next` directly. Use this
package when you are building a custom dev server, bundler plugin, or deployment adapter that needs
to load and compile the single map exported by `tileflow.config.ts`.

```ts
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

const artifacts = await createTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
});
```

The integration surfaces are deliberately split: use `@tileflow/dev/artifacts` for source
preparation and production outputs, `@tileflow/dev/server` for HTTP development handling,
`@tileflow/dev/icons` for icon compilation, `@tileflow/dev/inspect` for safe resolved-config and
bounded feature inspection, `@tileflow/dev/validation` for structured diagnostics, and
`@tileflow/dev/preview` only for the local preview contract. The root entry keeps compatibility
re-exports.

Artifact construction is an explicit `source map → resolved map → prepared map → ArtifactPlan`
pipeline. Map inheritance resolves before its ordered local/package icon and font directories are
prepared, and before the result reaches the core style compiler. The Node layer may normalize
the map into an internal build catalog, but that catalog is orchestration state rather than another
public authoring model. The plan exposes its complete files and observed input graph, so build
adapters emit and watch the same generation instead of reconstructing either list themselves. Production manifests
point to content-addressed `generations/<sha256>/...` styles and sprites; those immutable files are
installed before the manifest pointer changes. The disk writer also stages the complete plan,
records a managed-file inventory, rolls back caught filesystem failures, and removes only stale
files named by its previous valid inventory. It retains the immediately preceding immutable
generation during each replacement, so a client that already read the old manifest can finish its
style and sprite requests; the next replacement retires that older generation. Stable `styles/`
and `icons/` aliases remain for direct URL compatibility, but generation-consistent consumers
resolve maps through `manifest.json`.

Every plan also emits canonical `build-manifest.json` (schema version 1). For each map it records
the leaf `mapVersion`, resolved lineage, effective icon/font source identities, inferred
`dataRequirements`, Recipe ABI, and three separate SHA-256 values: `mapRevisionSha256` for the
effective cartographic definition after `extends`, `styleSha256` for the compiled Style JSON, and
`assetSetSha256` for that map's generated runtime resources. Data requirements are derived from the
final Style layers and fields rather than copied from a manually maintained allowlist, so disabled
or overridden modules do not claim data they no longer use. The Recipe ABI remains a separate
`recipe: {compiler, compilerVersion}` compatibility axis.

The map revision is versioned and domain-separated. It contains the resolved cartographic design,
the compiler family, private effective module contributions, and effective icon/font source
identities. Map `id`, `name`, editorial `mapVersion`, default `view`, capture `scenes`, delivery
policy, package SemVer, compiler ABI, local paths, timestamps, generated sprite/font output, and a
concrete resolution of a floating World selector are deliberately outside it. Changing a shadowed
ancestor does not change the revision; changing an effective cartographic override or source asset
does. Lineage and the leaf `mapVersion` remain beside the hash for traceability, Style JSON owns its
compiled-output identity, and Hosted delivery policy belongs to the deployment fingerprint. The
top-level `provenance` block records the exact participating Tileflow package versions and the
nearest package-manager lockfile's format and content hash, without embedding its local path;
provenance remains outside every map revision. The same portable block is available to Hosted
adapters through
`createTileflowBuildProvenance(cwd)`. The dev server exposes the complete document at
`/build-manifest.json`.

`createTileflowStyle`, `createTileflowStyles`, and artifact construction all enforce the same
recursive JSON-value invariant and MapLibre style-spec semantics without fetching remote resources.
Invalid output throws `TileflowStyleValidationError` with at most 32 deterministic
`map`/`path`/`message` issues; layer indexes are projected to stable layer IDs.

For a watched, last-known-good integration, use one artifact session rather than recompiling each
request independently:

```ts
import {createTileflowArtifactSession} from '@tileflow/dev/artifacts';

const session = await createTileflowArtifactSession({
  config: 'tileflow.config.ts',
  watch: true,
});

const unsubscribe = session.subscribe((state) => {
  // building -> ready, or invalid while getLastGoodArtifacts() remains available
  console.log(state.status, state.generation);
});

unsubscribe();
await session.close();
```

The bounded watcher follows the config, transitive local TypeScript/JavaScript/JSON imports, and
effective local icon/font directory inputs. Generations are monotonic, overlapping refreshes are latest-wins, invalid
edits retain the last good snapshot, and caller-supplied output directories can be ignored to avoid
feedback loops. `tileflow preview` (`tileflow dev` compatibility alias), `capture --watch`, and
framework adapters use this shared status
vocabulary. The built-in preview reloads after its live event stream reconnects following a server
restart, even when the replacement process begins again at generation 1.

Custom preview servers use the exported map or one of its standalone scenes:

```ts
import {createTileflowDevRequestHandler} from '@tileflow/dev/server';

const fetch = createTileflowDevRequestHandler({
  session,
  scene: 'madrid-mobile',
});
```

Map preview uses the exported map's `view`; scene preview uses committed camera and CSS viewport
metadata from that same map. A scene does not repeat the map ID because its owner is implicit.
`resolveTileflowPreview()` exposes the validated selection for custom integrations.
Application-target scenes remain the responsibility of the application's development server. The
built-in preview records longitude, latitude, zoom, bearing, and pitch in the current URL, so browser
refreshes and config-triggered reloads return to the same view. Removing those query parameters
restores the configured camera.

When a resolved map declares `fonts`, preparation reads its ordered directories and uses OpenType
full names as the canonical IDs referenced by `text-font`. TTF, OTF, and WOFF2 inputs are supported;
every contributing directory must contain `LICENSE.txt`. Later directories replace earlier faces
with the same exact ID, case-only collisions fail, and every primary font in the final style must be
present. `font` is an exact face ID; local `fallbacks` entries are exact face names or explicit CSS
generic families such as `sans-serif`. Preparation never synthesizes a face name from a family and
weight. Only selected primary faces and licenses are emitted as
content-addressed managed artifacts.

`fonts` and `glyphs` are mutually exclusive map fields. Omission inherits the parent's current text
provider; declaring either one replaces an inherited provider of either kind atomically. The font
pipeline is driven only by directory metadata and final style usage—there are no hard-coded map or
family names, and a URL provider comes only from the resolved map instead of being invented by the
pipeline. After inheritance resolves, a map with any text layer must have exactly one provider. A
`glyphs: {kind: 'url', ...}` provider enumerates the exact comma-joined MapLibre request keys
produced by the style's `text-font` arrays.

The resulting style records strict `tileflow:fontFaces` metadata. Preview, capture, and browser
framework adapters load those generic definitions before constructing MapLibre. Hosted preparation
also emits one canonical `tileflow-font-bundle-v1` closure containing only selected faces and their
license bytes. Its manifest SHA-256 is the sole content identity; Hosted adds an opaque project-owned
storage ID. Deploy uploads that bundle before the Style and then replaces provisional sources with
the exact immutable ID URLs confirmed by Hosted. A derived map that declares `glyphs` replaces the
inherited local provider atomically; the URL-backed map is complete as declared and independent of
its World selection.

That upload and binding contract is implemented, but it is not by itself a production-availability
promise. The matching Hosted rollout candidate adds DB-backed project ownership, organization quota,
durable deployment references, grace-based garbage collection, and deletion receipts; availability
still requires that matching migration, API, and SDK pair to be promoted together.

For Streets styles whose vegetation layer declares `tileflow:vegetation-mode = 3d`, the built-in
preview uses the same portable circle fallback as capture and the published framework adapters by
default. This makes an ordinary `tileflow preview` session WYSIWYG with production and visual
baselines. Append `?treeRenderer=simple` or `?treeRenderer=complex` to opt into the experimental,
preview-only instanced renderer described below; that explicit mode is not capture evidence.

The experimental renderer uses source height and crown diameter when present, distinguishes palms,
columnar cypresses, conifers, and three broadleaf silhouettes from the bound botanical fields, and
falls back to deterministic broadleaf variety and dimensions when tags are missing. Bark color,
crown palettes, height scale, and crown scale come from `vegetation.threeDimensional`; the preview
does not maintain a second hard-coded appearance contract. During camera
gestures the existing 3D batch remains visible while native circles cover newly arriving tiles; the
batch refreshes when movement ends without waiting for the whole map to become idle. Source-tile
events are rate-limited and unchanged instance selections do not upload new GPU buffers. The
preview caps one view at 3,000 trees and uses zoom-dependent density. Both detailed modes use thin,
tapered trunks, branches that enter the crown, softly shaded overlapping ellipsoids, and stable
per-tree scale and rotation. `simple` reduces lobe and segment counts; `complex` keeps the complete
round, open, avenue, pine, cypress, and palm silhouettes. Each archetype remains fused into one
reusable geometry and every complete tree remains
one GPU instance, so the additional detail introduces no extra draw calls. The experimental
renderer defaults to its WebGL2 backend, which
draws those instances directly without a Three.js scene traversal; append `&treeBackend=three` for
the compatibility backend. Use `?treeRenderer=circle`, `?treeRenderer=simple`, or
`?treeRenderer=complex&treeBenchmark=1` to compare identical scenes; the benchmark reports frame
p95, query, selection, build and render time, draw calls, and triangle count in the tree status badge.
Visible candidates come from MapLibre's worker-built tile index instead of a second copy of the
vector source. Terrain height is sampled on a fixed 5-by-5 viewport grid and interpolated per tree,
avoiding hundreds of synchronous terrain queries when a new batch first appears.
The separate `TREES ON/OFF` control sits below the building `3D ON/OFF` control and pauses tree
refresh work while disabled. Both choices survive reloads and shared links through the
`buildings3d=on|off` and `trees3d=on|off` URL parameters.

Detailed trees retain the compiler's scene order: they render above road and pedestrian surfaces,
ordinary building geometry, and detailed landmark models. Map labels and other annotations remain
above the physical scene, while road names and route references stay attached to the carriageway
below buildings and trees.

The same control toggles any compiled layer whose metadata contains
`tileflow:3d-toggle = building`. It switches the building volumes independently from the camera,
so enabling 3D never changes the pitch and users remain free to tilt the map with pointer controls.

### Detailed landmark models

A hidden style layer can opt the Streets preview into detailed GLB landmarks by setting
`tileflow:landmark-manifest-url` in its metadata. The bounded version-2 manifest indexes GLB entries
inside one or more PMTiles archives and is fetched only when the 3D building control is enabled near
the landmark runtime zoom. Archive URLs may be absolute or relative to the manifest URL.

```json
{
  "schemaVersion": 2,
  "id": "madrid-landmarks-2026-08-19",
  "minzoom": 16,
  "maximumVisibleModels": 8,
  "maximumCachedModels": 16,
  "archives": [
    {
      "id": "madrid-v1",
      "url": "./madrid-landmarks-v1.pmtiles",
      "bytes": 14832912,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "landmarks": [
    {
      "id": "palacio-cibeles",
      "center": [-3.6921, 40.4193],
      "bounds": [-3.693, 40.4186, -3.6912, 40.42],
      "priority": 100,
      "models": [
        {
          "minzoom": 16,
          "archiveId": "madrid-v1",
          "z": 0,
          "x": 0,
          "y": 0,
          "bytes": 481024,
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "axisConvention": "EUN_Y_UP"
        },
        {
          "minzoom": 18,
          "archiveId": "madrid-v1",
          "z": 1,
          "x": 0,
          "y": 0,
          "bytes": 1276416,
          "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          "axisConvention": "EUN_Y_UP"
        }
      ]
    }
  ]
}
```

`maximumVisibleModels` is bounded to 1–64. `maximumCachedModels` defaults to twice that value,
must be at least the visible limit, and is bounded to 128. Higher `priority` values win when more
landmarks intersect the viewport than can be shown. `models[0]` is the base LOD and must start at the
manifest `minzoom`; later entries replace it at their distinct `minzoom`. The parser bounds manifest,
archive, landmark, model and GLB-entry sizes, rejects credential-bearing or non-HTTP archive URLs,
and verifies each extracted entry's declared byte length and SHA-256 before parsing it.

The preview starts the Three.js runtime and manifest request together one zoom before the landmark
layer becomes visible. A landmark entering directly at a close zoom always displays its base LOD
first and upgrades in place. Nearby base LODs are warmed in the parsed-model cache. Style layers
marked with `tileflow:landmark-fallback = true` remain visible until the corresponding active GLB is
ready, so a cold request never leaves an empty building volume.

Embedded Streets previews also accept a same-origin parent command without reloading the document:

```js
iframe.contentWindow.postMessage(
  {
    type: 'tileflow:set-map-state',
    schemaVersion: 1,
    state: {
      center: [-3.688344, 40.453053],
      zoom: 17.75,
      bearing: -24,
      pitch: 58,
      buildings3d: true,
      trees3d: false,
      visibleLayerGroups: ['labels', 'roads', 'buildings', 'landuse', 'water'],
    },
  },
  location.origin,
);
```

The command is applied atomically only for the embedding parent, with exact same-origin and numeric
range checks. `visibleLayerGroups` is optional and accepts only `labels`, `pois`, `roads`, `transit`,
`buildings`, `landuse`, and `water`; omitted groups are hidden while base background and attribution
remain. Camera and toggle state continue to be written to the preview URL after application.

GLB base colors, textures, emissive values, metalness, and roughness are authoritative and are not
rewritten by the preview. Models outside the active selection remain hidden in a least-recently-used
cache; leaving the cache disposes their geometry, materials, and textures.

The vector building represented by a detailed model must carry `hide_3d = true`. The ordinary
building extrusion and both screen-space shadow passes filter on that field, preventing the coarse
volume from intersecting the GLB while retaining the flat footprint below it. This flag belongs in
the vector-tile dataset; the landmark endpoint cannot substitute for it. Version model and GLB URLs
so they can be served with immutable caching. Cross-origin endpoints must allow credentialed GETs
because the development renderer requests the manifest and models with credentials.

If a map uses `icons: ['./icons/brand']`, build artifacts include the generated MapLibre
`sprite.json`, `sprite.png`, `sprite@2x.json`, and `sprite@2x.png` beside its style. Ordinary sources
are normalized into 24 px icon cells. A source named `<id>.pattern.svg` (or another supported raster
format with the same marker) instead keeps its intrinsic dimensions and is published as `<id>`.
This provides calibrated, non-square textures for line and fill patterns while the runtime still
consumes only the generated PNG sprite. Pattern widths must be a power of two from 2 through 512
pixels, matching MapLibre's seamless line-pattern contract.

`icons` is one ordered array. Omitting it inherits the parent's exact array, declaring it replaces
the array atomically, and `[]` means no icons. Use a spread to preserve imported directories while
adding or replacing files:

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'brand-map',
  version: 1,
  extends: streets,
  icons: [...streets.icons, './icons/brand'],
});
```

Directories apply left to right. `<id>.<ext>` publishes an icon as `<id>`;
`<id>.pattern.<ext>` publishes the intrinsic-size pattern as `<id>`. The published ID must already
be canonical lower-kebab-case. A later file replaces an earlier file only for the same exact ID;
case-only collisions fail. Package maps export `streetsIcons`, `streetsDarkIcons`, `ferrarisIcons`,
`haradIcons`, `siegfriedIcons`, `soundingsIcons`, `cyberpunkIcons`, `matrixIcons`, and `verdantIcons`
directory descriptors from `@tileflow/maps`. Cyberpunk and Siegfried also export
`cyberpunkFonts` and `siegfriedFonts`. Preparation resolves package descriptors inside their owning
package, checks real-path containment, and compiles them through the same pipeline as a
config-relative directory. There are no built-in/source/sprite selectors, mappings, icon-specific
inheritance, or compatibility aliases.

Local directories resolve from the directory containing the selected `tileflow.config.ts`, while
the workspace `cwd` remains their containment boundary. Canonical local syntax starts with `./` or
one or more leading `../` segments and then uses only non-empty segments other than `.` or `..`;
trailing or repeated slashes, backslashes, controls, and paths longer than 512 characters fail.

## Structured config inspection and diagnostics

Custom Node tooling can use the same deterministic documents as `tileflow validate --json` and
`tileflow inspect --json`:

```ts
import {inspectTileflowConfig} from '@tileflow/dev/inspect';
import {
  createTileflowCommandFailureDocument,
  serializeTileflowCommandDocument,
} from '@tileflow/dev/validation';

try {
  const inspection = await inspectTileflowConfig({config: 'tileflow.config.ts'});
  process.stdout.write(serializeTileflowCommandDocument(inspection));
} catch (error) {
  const failure = createTileflowCommandFailureDocument('inspect', error, process.cwd(), {
    code: 'INSPECTION_FAILED',
    phase: 'config-inspection',
  });
  process.stderr.write(serializeTileflowCommandDocument(failure));
}
```

The inspection resolves one config load into sorted maps, root-to-leaf lineage, declared paths, and
leaf-level merge provenance. It never returns `inputFiles`, absolute filesystem paths, credentials,
URL queries, data URLs, or recognized secret formats. Structured summaries and diagnostics use the
same required schema-version-1 fields and bounded safe suggestions so consumers do not need to
parse human prose.

## Bounded vector-feature inspection

Custom Node tooling can inspect only the features visible near a configured camera without opening
a browser:

```ts
import {inspectTileflowFeatures} from '@tileflow/dev/inspect';

const internalCatalog = artifacts.project;
const inspection = await inspectTileflowFeatures(internalCatalog, 'madrid', {
  center: [-3.6927512, 40.4086555],
  zoom: 16,
  sourceLayers: ['poi'],
  properties: ['name', 'class', 'subclass', 'rank'],
  width: 512,
  height: 512,
  limit: 100,
});
```

The inspector supports ordinary HTTP(S) vector sources and TileJSON. It bounds viewport, tile
count, individual/total bytes, scanned and returned features, property count/string lengths, and
request time; results are deduplicated and sorted deterministically. Output contains projected
properties, geometry summaries, safe origin/path metadata, and the configured source revision or
`null`. It never emits URL queries, credentials, hidden properties, response bodies, or absolute
paths. PMTiles and authenticated provider adapters are not currently supported by this primitive.

Deployment adapters can compile the same sources without writing them to disk:

```ts
import {compileTileflowIconPackages} from '@tileflow/dev/icons';

const internalCatalog = artifacts.project;
const result = await compileTileflowIconPackages(internalCatalog, {
  cwd: process.cwd(),
  target: 'hosted',
});
```

Streets declares `[streetsIcons]`; Streets Dark composes `[streetsIcons, streetsDarkIcons]`;
Cyberpunk extends Streets and appends `cyberpunkIcons`; Matrix replaces Cyberpunk's icons with
`[streetsIcons, matrixIcons]`. Ferraris, Härad, Siegfried, Soundings, and Verdant are separate
first-party roots that declare only `[ferrarisIcons]`, `[haradIcons]`, `[siegfriedIcons]`,
`[soundingsIcons]`, and `[verdantIcons]`, respectively; none composes Streets assets even though all
roots use the semantic Streets compiler ABI. Härad's directory contains nine original Tileflow
patterns inspired by Lantmäteriet's CC0 Häradsekonomiska kartan series from 1859–1934. Soundings owns ten
original nautical symbols and patterns. None of the five independent roots imports or extends
Streets. An application map may inherit a root's exact array, replace it, clear it with `[]`, or
compose it explicitly with a spread.
`modules.poi.icons: false`, a disabled POI module, or the internal POI `none` preset suppresses POI
icon layers without moving asset ownership into dev. Module presets remain semantic module options;
they are not maps or asset-provider presets.

The hosted target enforces repository containment, portable icon IDs, safe SVG
references, deterministic ordering, and the public package limits. Package-owned directories are
trusted only inside their declared owning package and are exempt from config working-tree
containment. It returns deduplicated generated files plus a canonical manifest/content hash. Upload
only those generated files: source icons and absolute paths remain local.

The version-1 manifest includes `renderedIcons` in the exact sorted `iconNames` order. Each entry
contains SHA-256 digests for the normalized 1x and 2x RGBA cell. The digest framing includes its
density and dimensions, zeroes RGB only where alpha is zero, and excludes filenames/source bytes.
The package content hash still covers the complete canonical manifest, including all four encoded
file hashes. Consumers can therefore distinguish a visible per-icon change from an atlas-layout or
encoding-only package change without receiving the original SVG/raster file.

`compileTileflowIconPackages` retains the exact RGBA cells used to assemble each atlas, so its
pixel digests describe delivered pixels rather than a second render. Hosted upload services must
decode the submitted PNGs and reconstruct those digests independently; client-authored manifest
analysis is not authoritative.

Custom Node tooling can inspect the same local pipeline without walking or decoding source files a
second time:

```ts
import {inspectTileflowIconCatalogs} from '@tileflow/dev/icons';

const internalCatalog = artifacts.project;
const inspection = await inspectTileflowIconCatalogs(internalCatalog, {
  cwd: process.cwd(),
  mapNames: ['madrid'],
});
```

The result keeps one catalog per distinct ordered directory composition, the exact winning source
for every final ID, explicit same-ID replacements, config-relative source metadata, exact atlas rectangles,
both manifest pixel digests, and the shared compiled package. `icons: []` is represented as an
absent catalog. This is a local-authoring integration surface: use the hosted compilation target
separately for deployment compatibility, and project only the metadata needed by an external
protocol rather than serializing generated byte arrays accidentally.

This package is public, but it is an integration layer. Styling primitives live in
`@tileflow/core`, official maps and their source assets live in `@tileflow/maps`, and React
rendering lives in `@tileflow/react`.

Docs: https://tileflow.dev/docs
