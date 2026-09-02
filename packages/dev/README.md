# @tileflow/dev

Node utilities used by the Tileflow CLI and build integrations.

Most apps should use `tileflow`, `@tileflow/vite`, or `@tileflow/next` directly. Use this
package when you are building a custom dev server, bundler plugin, or deployment adapter that needs
to load and compile the single map exported by `tileflow.config.ts`.

```ts
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

const artifacts = await createTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
});

try {
  // Serve, capture, or write this exact generation.
} finally {
  await artifacts.dispose?.();
}
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
point to content-addressed `generations/<sha256>/...` theme styles and sprites; those immutable files are
installed before the manifest pointer changes. Stable style paths are
`styles/<map>/<theme>.json`; every manifest lookup resolves a concrete theme. The disk writer also stages the complete plan,
records a managed-file inventory, rolls back caught filesystem failures, and removes only stale
files named by its previous valid inventory. Stable `styles/` and `icons/` paths remain available,
but generation-consistent consumers resolve maps through `manifest.json`.

A local `hostedTileset()` path remains user-owned input. Dev performs bounded header, root-directory,
and metadata checks, then creates an opaque immutable snapshot under
`.tileflow/cache/pmtiles-snapshots/v1/`, using copy-on-write cloning when available and a safe copy
otherwise. It does not hash the complete archive or traverse every leaf directory. Dev and Capture
read only that snapshot. The current generation and already-started acquisitions retain references;
a replaced generation accepts no new acquisitions and is collected after its last acquisition.
The Style-facing path remains `tilesets/<logical-id>.pmtiles` across generations; physical snapshot
identity stays out of Style JSON. Standalone Capture retains one generation for the complete render.
Application Capture delegates PMTiles reads to the application's development server, where each
range request retains its generation until that response is prepared; it does not lease one
generation for the complete capture. Strong generation ETags make a cached PMTiles read restart if
current changes between its ranges. Invalid edits keep the prior valid generation.

Production writers reject unresolved local PMTiles instead of copying, content-addressing,
deduplicating, retaining, or publishing them. Production data therefore requires an explicit
`tileset publish` operation or an application-owned PMTiles location. Managed publication owns its
separate exhaustive validation and version lifecycle. Startup removes snapshot generations owned
by dead processes, and symlinked snapshot-store boundaries are rejected.

Every plan also emits canonical `build-manifest.json` (schema version 1). For each map it records
the leaf `mapVersion`, resolved lineage, effective icon/font source identities, semantic compiler ABI, and
one entry per concrete theme with `colorScheme`, identity, inferred legacy `dataRequirements`,
multi-source `sourceRequirements`, and `styleSha256`. The multi-source contract records each
referenced vector source independently and records raster DEM source ID, encoding, and tile size;
it therefore distinguishes Bathymetry vector bands from optional relief without inventing vector
fields. `mapRevisionSha256` identifies the effective cartographic definition after `extends`;
`assetSetSha256` for that map's generated runtime resources. Data requirements are derived from the
final Style layers and fields rather than copied from a manually maintained allowlist, so disabled
or overridden modules do not claim data they no longer use. Maps use the single implicit semantic
compiler; its ABI remains a separate `semanticCompiler: {name, version}` build-manifest axis.

The map revision is versioned and domain-separated. It contains the resolved cartographic design,
semantic language version, effective public module/render-stack design, and effective icon/font
identities. Map `id`, `name`, editorial `mapVersion`, default `view`, capture `scenes`, package
SemVer, compiler ABI, local paths, timestamps, generated sprite/font output, and a
concrete resolution of a floating World selector are deliberately outside it. Changing a shadowed
ancestor does not change the revision; changing an effective cartographic override or source asset
does. Lineage and the leaf `mapVersion` remain beside the hash for traceability, and Style JSON owns
its compiled-output identity. Hosted browser policy is managed outside repository artifacts. The
top-level `provenance` block records the exact participating Tileflow package versions and the
nearest package-manager lockfile's format and content hash, without embedding its local path;
provenance remains outside every map revision. The same portable block is available to Hosted
adapters through
`createTileflowBuildProvenance(cwd)`. The dev server exposes the complete document at
`/build-manifest.json`.

`createTileflowStyle`, `createTileflowStyles`, and artifact construction all enforce the same
recursive JSON-value invariant and MapLibre style-spec semantics without fetching remote resources.
The family API returns `styles[map][theme]`; it never flattens a default theme into a map alias.
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

`getState()` and `getLastGoodArtifacts()` are borrowed synchronous views. Before starting async
work, call `session.acquireArtifacts(generation?)` and release the returned acquisition in `finally`.
A replacement stops new acquisitions of the old generation and deletes its snapshot after the last
release. `close()` waits for outstanding acquisitions.

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

// On server shutdown:
await Promise.all([fetch.close(), session.close()]);
```

The handler does not close a caller-owned session.

Map preview uses the exported map's `view` and accepts one concrete `theme`; scene preview uses its
committed concrete theme, camera, and CSS viewport metadata from that same map. A scene does not
repeat the map ID because its owner is implicit.
`resolveTileflowPreview()` exposes the validated selection for custom integrations.
Application-target scenes remain the responsibility of the application's development server. The
built-in preview records longitude, latitude, zoom, bearing, and pitch in the current URL, so browser
refreshes and config-triggered reloads return to the same view. Removing those query parameters
restores the configured camera.

## Local comparison workbench and compiler inspection

The CLI exposes the complete authoring surface through `tileflow preview --against-map ...` or
`--against-config ...`. Custom local servers can compose the same shell around two existing dev
handlers:

```ts
import {createTileflowComparisonRequestHandler} from '@tileflow/dev/server';

const fetch = createTileflowComparisonRequestHandler({
  left: {
    basePath: '/left',
    handler: leftHandler,
    label: 'candidate / light',
    previewUrl: '/left/',
    sidecarUrl: '/left/__inspection/candidate/light.json',
  },
  right: {
    basePath: '/right',
    handler: rightHandler,
    label: 'reference / light',
    previewUrl: '/right/',
    sidecarUrl: '/right/__inspection/reference/light.json',
  },
});
```

Each side handler retains ownership of its styles, fonts, sprites, events, diagnostics, and
last-known-good artifact generation. The comparison router only owns the root HTML and strict
dispatch to two disjoint same-origin route prefixes. Its synchronized camera, URL state,
side-by-side/split/overlay/blink modes, rendered-feature inspector, zoom-curve sampling, sprite
atlas, and scene/capture-command copying require no hosted service.

Set `inspection: true` on `createTileflowBuildArtifacts` or
`createTileflowArtifactSession` to compute `artifacts.styleInspections[map][theme]`. A dev handler
serves an available sidecar at `/__inspection/<map>/<theme>.json`; otherwise that route is 404. The
option is deliberately off by default. Sidecars remain in memory, do not alter Style bytes or
manifest hashes, and are excluded from `getTileflowArtifactFiles()` and every stable build output.

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
framework adapters load those definitions before constructing MapLibre. Hosted deploy rejects a
prepared local-font bundle before authentication until managed font storage is available. A derived
map that declares `glyphs` replaces the inherited local provider atomically; the URL-backed map is
complete as declared and independent of its World selection.

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
case-only collisions fail. Package maps export `streetsIcons`, `baedekerIcons`, `ferrarisIcons`,
`haradIcons`, `siegfriedIcons`, `soundingsIcons`, `cyberpunkIcons`, `matrixIcons`, and
`verdantIcons`, and `sanFrancistoIcons` directory descriptors from `@tileflow/maps`. Cyberpunk,
Matrix, Baedeker, and Siegfried also export `cyberpunkFonts`, `matrixFonts`, `baedekerFonts`, and
`siegfriedFonts`. Preparation
resolves package descriptors inside their owning package, checks real-path containment, and
compiles them through the same pipeline as a config-relative directory. There are no
built-in/source/sprite selectors, mappings, icon-specific inheritance, or compatibility aliases.

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
leaf-level merge provenance. Its `themeContract` exposes the default/system mapping, shared token
schema, concrete resolved token values, typography and lighting, differences from the default, and
stable `THEME_IMPLICIT_FIXED` diagnostics across modules, render stacks, and terrain. Each
diagnostic carries a semantic scope and, for module values, its owner, plus machine-readable
severity and remediation. Colors, fonts, and images are followed through
expression outputs; numeric diagnostics intentionally cover only direct visual scalars, excluding
expression operands, zoom stops, tuples, placement, priority, and other structural numbers.
Agents can therefore edit semantic roles without
reverse-engineering compiler layers or parsing prose. It never returns `inputFiles`, absolute filesystem paths, credentials,
URL queries, data URLs, or recognized secret formats. Structured summaries and diagnostics use the
same required schema-version-1 fields and bounded safe suggestions so consumers do not need to
parse human prose.

## Bounded PMTiles resource inspection

Node tooling can inspect one local PMTiles archive without reading it completely:

```ts
import {inspectTileflowPmtiles} from '@tileflow/dev/tilesets';

const inspection = await inspectTileflowPmtiles('./data/stores.pmtiles', {
  includeValues: ['category', 'status'],
});
```

Inspection schema 1 separates the authoritative PMTiles header and TileJSON `vector_layers` metadata
from deterministic bounded MVT observations. Each sampled field reports present/missing feature
counts, observed primitive types, capped distinct-value cardinality, numeric min/max, and explicit
truncation. Values are returned only for requested portable field names, with at most 32 requested
fields, 16 values per field, and 256 characters per string. Sampling reads at most eight tiles,
20,000 features, or 24 MB of tile data; `sample: false` returns only authoritative metadata and does
not accept `includeValues`.

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
  properties: ['name', 'category', 'type', 'icon', 'filter_rank', 'size_rank'],
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

Streets declares `[streetsIcons]` and keeps light/dark image-token targets in that one closure;
Cyberpunk and Matrix independently declare `[cyberpunkIcons]` and `[matrixIcons]`. Baedeker,
Ferraris, Härad, Siegfried, Soundings, Verdant, and San Francisto declare only `[baedekerIcons]`,
`[ferrarisIcons]`, `[haradIcons]`, `[siegfriedIcons]`, `[soundingsIcons]`, `[verdantIcons]`, and
`[sanFrancistoIcons]`, respectively. No official root composes another map's assets even though all
use the semantic compiler ABI. Baedeker's directory contains eight original travel-atlas patterns;
its browser-derived Mapterhorn contours use runtime terrain tiles and are not part of the icon
package. Härad's directory contains nine original Tileflow patterns inspired by Lantmäteriet's CC0
Häradsekonomiska kartan series from 1859–1934. Soundings owns ten original nautical symbols and
patterns. San Francisto owns four technical blueprint patterns and one schematic POI node; its
unbundled Mapterhorn contours remain runtime terrain, and its text uses the canonical Noto Sans
glyph provider. An application map may inherit a root's exact array, replace it, clear it with `[]`,
or compose it explicitly with a spread.
`modules.poi.icons: false` or a disabled POI module suppresses POI icon layers without moving asset
ownership into dev. POI density is the numeric producer threshold 1–5; it is not an asset-provider
preset.

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
