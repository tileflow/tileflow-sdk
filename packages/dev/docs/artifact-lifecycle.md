# Artifact lifecycle

Start with the [@tileflow/dev guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/README.md) for installation and a complete first example.

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
  config: 'tileflow.config.ts',
  scene: 'madrid-mobile',
});

// On server shutdown:
await fetch.close();
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
