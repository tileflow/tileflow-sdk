# Prepare native map artifacts

Use the existing artifact pipeline with `renderer: 'native'` to prepare the `native-v1` static
profile. The same config loader, inheritance resolver, semantic compiler, icon composition and
font pipeline are used. There is no separate native map language.

Install the packages and create a trusted `tileflow.config.ts` as described in the
[package README](../README.md). The source version containing this option must be installed;
a source branch or a successful build does not establish npm availability.

## Prepare in memory

<!-- docs:check -->

```ts
import {createTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

const artifacts = await createTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
  renderer: 'native',
});

try {
  console.log(artifacts.manifest);
  console.log(artifacts.nativeBuild);
} finally {
  await artifacts.dispose?.();
}
```

The pipeline checks every concrete theme. A rejected theme fails the complete generation before
production output is written. No unsupported layers, fonts or protocols are silently removed.
Local PMTiles are rejected before creating archive snapshots. URL checks do not fetch remote
TileJSON, glyphs or tiles and do not prove their content or availability.

Font preparation verifies the same licensed source bytes as web preparation, then maps exact full
names into Native's `font-faces` root property. It does not retain browser `tileflow:fontFaces`
metadata or claim a system font is equivalent. Sprites keep the original independently generated
1x and 2x bytes; the native check verifies their pair, dimensions, IDs and existing size limits.

## Write a separate output

<!-- docs:check -->

```ts
import {writeTileflowBuildArtifacts} from '@tileflow/dev/artifacts';

await writeTileflowBuildArtifacts({
  config: 'tileflow.config.ts',
  renderer: 'native',
  outDir: 'public/tileflow',
});
```

This writes `public/tileflow/native/manifest.json`, `build-manifest.json`, `native-build.json` and
the complete style/asset generation beneath `public/tileflow/native`. The writer adds `native` once
beneath `outDir`; pass the output parent, not an already renderer-qualified directory. The native
subdirectory owns a separate inventory. A web build at the parent neither replaces its manifest nor
collects the native generation, and vice versa.

The runtime manifest remains strict version 1 with the same map/theme shape. No renderer/profile
field is added to it. Native font declarations live in the native styles, not a web font loader.
`native-build.json` is a separate strict build record that identifies the renderer, profile, selected
engines, `validation: 'static-artifacts'` and the canonical `build-manifest.json` SHA-256.

The existing logical map revision remains based on resolved cartography and source asset identity.
Representation changes, such as native font mapping, change the style hash rather than inventing
a second logical map. Transport credentials and device state never enter these artifacts.

File names in an in-memory plan remain relative to the renderer output root. Relative style/font
URLs remain relative to their owning documents. An explicit absolute or host-relative
`styleBaseUrl`/`assetBaseUrl`, such as `/tileflow`, receives the `/native` suffix. The pipeline uses
an inert `.invalid` document base only to check relative URL syntax; it does not publish that base
or infer the application's real delivery origin.

Omitting `renderer`, or specifying `renderer: 'web'`, preserves the existing web artifact bytes and
output layout. The native record is absent from web plans.

## Retain the last valid generation

`createTileflowArtifactSession({renderer: 'native', watch: true})` uses the existing session lifecycle.
An incompatible edit publishes an `invalid` state with native diagnostic context. It retains the
previous valid artifacts but does not publish them again as a new successful generation. Acquiring,
releasing and disposing a generation follow the existing [artifact lifecycle](artifact-lifecycle.md).

This is artifact watching, not a native preview server. Do not pass these artifacts to browser
preview/capture as evidence of a native render. Native inspection sidecars, React Native components,
Hermes execution, iOS/Android qualification, Hosted authorization and deployment are not supplied.

## Reproduce the official-map report

From an SDK source checkout after installing and building its pinned workspace:

```sh
pnpm exec tsx scripts/native-catalog-report.ts > native-catalog-report.json
```

The report evaluates all ten official maps and each of their themes through the shared pipeline.
Rows contain either a static-compatible style hash or exact incompatibility diagnostics, sorted by
map/theme with no timestamp or local path. Each row checks an individual theme; it is not a revision
receipt for a rewritten single-theme map. Unexpected compilation/tool failures stop report generation
rather than being relabeled as known incompatibilities. Retain the output together with the checkout
SHA and lockfile used to produce it. The test suite compares two independent evaluations and requires
Streets to pass. No unchecked catalog-wide compatibility assertion is implied by the presence of
this command, and this report is not a device-qualification result.

See the [Core profile contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md)
for the version intersection, diagnostic codes and unsupported representations.
