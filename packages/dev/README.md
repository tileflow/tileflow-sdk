# @tileflow/dev

Node utilities used by the Tileflow CLI and build integrations.

Most apps should use `@tileflow/cli`, `@tileflow/vite`, or `@tileflow/next` directly. Use this
package when you are building a custom dev server, bundler plugin, or deployment adapter that needs
to load and compile a `tileflow.config.ts`.

```ts
import {createTileflowBuildArtifacts} from '@tileflow/dev';

const artifacts = await createTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
});
```

`createTileflowStyle`, `createTileflowStyles`, and artifact construction all enforce the same
recursive JSON-value invariant and MapLibre style-spec semantics without fetching remote resources.
Invalid output throws `TileflowStyleValidationError` with at most 32 deterministic
`map`/`path`/`message` issues; layer indexes are projected to stable layer IDs.

For a watched, last-known-good integration, use one artifact session rather than recompiling each
request independently:

```ts
import {createTileflowArtifactSession} from '@tileflow/dev';

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
effective icon inputs. Generations are monotonic, overlapping refreshes are latest-wins, invalid
edits retain the last good snapshot, and caller-supplied output directories can be ignored to avoid
feedback loops. `tileflow dev`, `capture --watch`, and framework adapters use this shared status
vocabulary. The built-in preview reloads after its live event stream reconnects following a server
restart, even when the replacement process begins again at generation 1.

Custom preview servers can select the same map or standalone scene semantics as the CLI:

```ts
import {createTileflowDevRequestHandler} from '@tileflow/dev';

const fetch = createTileflowDevRequestHandler({
  session,
  scene: 'madrid-mobile',
});
```

`map` and `scene` are mutually exclusive. Map preview uses the configured `view`; scene preview
uses its committed camera and CSS viewport. `resolveTileflowPreview()` exposes the validated
selection for custom integrations. Application-target scenes remain the responsibility of the
application's development server. The built-in preview records longitude, latitude, zoom, bearing,
and pitch in the current URL after the camera moves, so browser refreshes and config-triggered
reloads return to the same view. Removing those query parameters restores the configured camera.

For Streets styles whose vegetation layer declares `tileflow:vegetation-mode = 3d`, the built-in
preview uses the same portable circle fallback as capture and the published framework adapters by
default. This makes an ordinary `tileflow dev` session WYSIWYG with production and visual
baselines. Append `?treeRenderer=simple` or `?treeRenderer=complex` to opt into the experimental,
preview-only instanced renderer described below; that explicit mode is not capture evidence.

The experimental renderer uses source height and crown diameter when present, distinguishes
conifer and broadleaf crowns from the bound
botanical fields, and falls back to deterministic dimensions when tags are missing. During camera
gestures the existing 3D batch remains visible while native circles cover newly arriving tiles; the
batch refreshes when movement ends without waiting for the whole map to become idle. Source-tile
events are rate-limited and unchanged instance selections do not upload new GPU buffers. The
preview caps one view at 3,000 trees and uses zoom-dependent density. Its `simple` renderer uses a
thicker, tapered olive-sage trunk and four broadleaf branches.
Broadleaf variant 0 carries nine open, faceted lens-shaped foliage forms, while variant 1 groups
five icosahedral foliage masses. The optional `complex` renderer increases those silhouettes to ten
lenses or six masses; conifers use two tiers in `simple` and three in `complex`. Each variant remains
fused into one reusable geometry and every complete tree remains
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
`tileflow:landmark-manifest-url` in its metadata. The version-1 manifest is fetched only when the
3D building control is enabled at the landmark runtime zoom. Model URLs may be absolute or relative
to the manifest URL.

```json
{
  "schemaVersion": 1,
  "id": "madrid-landmarks-2026-08-19",
  "minzoom": 16,
  "maximumVisibleModels": 8,
  "maximumCachedModels": 16,
  "landmarks": [
    {
      "id": "palacio-cibeles",
      "center": [-3.6921, 40.4193],
      "bounds": [-3.693, 40.4186, -3.6912, 40.42],
      "priority": 100,
      "model": "./palacio-cibeles-lod1.glb",
      "lods": [{"minzoom": 18, "model": "./palacio-cibeles-lod2.glb"}]
    }
  ]
}
```

`maximumVisibleModels` is bounded to 1–64. `maximumCachedModels` defaults to twice that value,
must be at least the visible limit, and is bounded to 128. Higher `priority` values win when more
landmarks intersect the viewport than can be shown. `model` is the base LOD; optional `lods` replace
it at their `minzoom`. A manifest may omit `model` only when its first LOD starts exactly at the
manifest `minzoom`.

GLB base colors, textures, emissive values, metalness, and roughness are authoritative and are not
rewritten by the preview. Models outside the active selection remain hidden in a least-recently-used
cache; leaving the cache disposes their geometry, materials, and textures.

The vector building represented by a detailed model must carry `hide_3d = true`. The ordinary
building extrusion and both screen-space shadow passes filter on that field, preventing the coarse
volume from intersecting the GLB while retaining the flat footprint below it. This flag belongs in
the vector-tile dataset; the landmark endpoint cannot substitute for it. Version model and GLB URLs
so they can be served with immutable caching. Cross-origin endpoints must allow credentialed GETs
because the development renderer requests the manifest and models with credentials.

If a map uses `icons: './icons/brand'`, build artifacts include the generated
MapLibre `sprite.json`, `sprite.png`, `sprite@2x.json`, and `sprite@2x.png`
assets alongside the styles. Ordinary sources are normalized into 24 px icon cells. A source named
`<id>.pattern.svg` (or another supported raster format with the same marker) instead keeps its
intrinsic dimensions and is published as `<id>`. This provides calibrated, non-square textures for
line and fill patterns while the runtime still consumes only the generated PNG sprite. Pattern
widths must be a power of two from 2 through 512 pixels, matching MapLibre's seamless line-pattern
contract.

## Bounded vector-feature inspection

Custom Node tooling can inspect only the features visible near a configured camera without opening
a browser:

```ts
import {inspectTileflowFeatures} from '@tileflow/dev';

const inspection = await inspectTileflowFeatures(project, 'madrid', {
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
import {compileTileflowIconPackages} from '@tileflow/dev';

const result = await compileTileflowIconPackages(project, {
  cwd: process.cwd(),
  target: 'hosted',
});
```

When a Streets map does not select a local or external icon set, the pipeline compiles the built-in
`tileflow-streets` POI catalog and merges any mapping-only overrides on top of its semantic mapping.
`modules.poi.icons: false`, a disabled POI module, or the `none` POI preset suppresses that implicit
package. An explicit local source or hosted sprite always replaces it.

The hosted target enforces repository containment, portable icon IDs, safe SVG
references, deterministic ordering, and the public package limits. The package-owned Streets
catalog is trusted input and is the only source exempt from project-root containment. It returns
deduplicated generated files plus a canonical manifest/content hash. Upload only
those generated files: source icons and absolute paths remain local. External
sprite URLs are preserved as references and are not downloaded.

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
import {inspectTileflowIconCatalogs} from '@tileflow/dev';

const inspection = await inspectTileflowIconCatalogs(project, {
  cwd: process.cwd(),
  mapNames: ['madrid'],
});
```

The result keeps one catalog per resolved source directory, map-specific resolved mappings,
cwd-relative source metadata, exact atlas rectangles, both manifest pixel digests, and the shared
compiled package. It classifies remote and absent catalogs without fetching them. This is a
local-authoring integration surface: use the hosted compilation target separately for deployment
compatibility, and project only the metadata needed by an external protocol rather than serializing
generated byte arrays accidentally.

This package is public, but it is an integration layer. Map styling primitives live in
`@tileflow/core`; React rendering lives in `@tileflow/react`.

Docs: https://tileflow.dev/docs
