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
vocabulary.

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

If a map uses `icons: './icons/brand'`, build artifacts include the generated
MapLibre `sprite.json`, `sprite.png`, `sprite@2x.json`, and `sprite@2x.png`
assets alongside the styles.

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

The hosted target enforces repository containment, portable icon IDs, safe SVG
references, deterministic ordering, and the public package limits. It returns
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
