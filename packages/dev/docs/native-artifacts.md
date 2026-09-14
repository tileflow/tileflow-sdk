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
production output is written. Native preparation applies the versioned transformations below;
other unsupported layers, fonts or protocols are not silently removed.
Local PMTiles are rejected before creating archive snapshots. URL checks do not fetch remote
TileJSON, glyphs or tiles and do not prove their content or availability.

Font preparation verifies the same licensed source bytes as web preparation, then maps exact full
names into Native's `font-faces` root property. It does not retain browser `tileflow:fontFaces`
metadata or claim a system font is equivalent. Sprites keep the original independently generated
1x and 2x bytes; the native check verifies their pair, dimensions, IDs and existing size limits.

## Versioned native lowering

Selecting `renderer: 'native'` applies `native-lowering-v1` after shared semantic compilation and
before final native validation. It never edits the authored map, the official map definitions or
the shared compiler. Web output is not lowered.

A fixed `projection: {type: 'globe'}` is explicitly normalized to Native's implicit Mercator. This
is a renderer-specific projection change, not equivalent globe rendering. An explicit fixed
Mercator declaration is also omitted. Adaptive/expression projections and unknown projection
options remain errors. Every style receipt states which normalization, if any, occurred.

For line layers, finite `line-cap` and `line-dasharray` decisions become contiguous physical layers
with constant values. Supported trees use constant leaves, `literal`, first-match `case`, disjoint
`match` labels and `step`. Predicates may combine boolean operations, scalar equality, membership,
`has`, geometry type and typed numeric comparisons/steps. Unchecked feature values are restricted
to vector sources, whose properties are scalar. Numeric coercion requires an explicit finite
fallback. Arbitrary feature-valued leaves, continuous interpolation, feature state, unsupported
operators and any unprovable decision fail with the original property pointer.

The partition preserves first-match priority. Each feature accepted by the original filter is
accepted by exactly one active replacement with the same cap and dash values; all other features
remain excluded. Existing legacy filters are converted with the pinned Style Spec converter before
intersection. Source, source-layer, metadata and other layout/paint values are preserved. Existing
`minzoom`/`maxzoom` are intersected with the decision intervals. Both target properties use integer
camera-zoom evaluation, so a step at 8.5 changes its value at zoom 9, while an original fractional
layer visibility bound remains fractional. New branch filters contain no camera-zoom expression.

Grouped outcomes use compact boolean decision trees rather than repeated lists of every earlier
arm's negated guard. Multi-arm cases remain flat to avoid trading size for excessive depth.
Identical outcomes and adjacent identical intervals are coalesced. IDs derive from the original
layer ID, the lowering version and deterministic branch order, with collision checks against the
whole input style. The original layer's replacements stay together; surrounding layers are not
reordered. Existing sort-key expressions are retained, not simplified or replaced.

Work is bounded per property by depth 16, 512 decision visits, 64 decision paths, 16 distinct
outcomes and 64 dash elements; the product is limited to 32 physical layers and 32 zoom intervals
per logical layer. The entire lowered style must still fit 4,096 layers, 160,000 visited JSON values,
depth 64 and 8 MiB. Limits are checked before writing outputs; preparation does not raise them to
make a particular map pass. A failure leaves the previous valid generation intact.

The equivalence checks cover per-feature selection, cap/dash values and zoom ranges, **not draw
order across features**. Copying `line-sort-key` preserves ordering only inside each physical
layer. If a feature with sort key 1 enters the first branch and a feature with sort key 0 enters
the second, the physical layers draw them as 1 then 0 instead of 0 then 1. Both features can satisfy
mutually exclusive filters yet have overlapping geometry. The resulting composition can differ,
not merely its antialiasing. Even without a sort key, partitioning can change source feature order.

Applications requiring exact overlapping-feature order must not treat a feature-partitioned
artifact as order-equivalent to its web style. A static-compatible result does not establish
complete cartographic or pixel equivalence. Native visual qualification remains a separate pending
gate on the pinned iOS/Android renderers, including overlaps between branches, sort keys, dash
transitions, camera movement and projection differences. Browser capture cannot satisfy this gate,
and visual samples alone cannot prove preservation of arbitrary feature order.

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
engines, `validation: 'static-artifacts'` and the canonical `build-manifest.json` SHA-256. Its
schema version is 2 and its `preparationVersion` is `native-lowering-v1`.

The `transformations` array is sorted uniquely by map/theme. Each entry records input and lowered
style SHA-256 values, input/output layer counts, projection normalization, and the input ordinal,
output start/count and affected properties of each changed layer. Ordinals refer to the complete
style layer arrays, including unchanged layers. These spans make the deterministic physical IDs
traceable without duplicating layer definitions in the receipt. The input hash binds shared
compiler output; the lowered hash precedes native font preparation and generation URL retargeting.
The build-manifest hash separately binds the final prepared styles and assets. All styles receive
an entry, including styles for which no lowering was needed. Schema v1 build records do not imply
this preparation policy and are not parsed as v2.

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

## Audit lowering size and feature order

From the SDK source root after installing and building the pinned workspace:

```sh
pnpm exec tsx scripts/native-lowering-audit.ts > native-lowering-audit.json
```

This diagnostic report compiles the unchanged full Streets family through the web preparation
path, then measures the native representation for **both** dark and light before applying output
budget assertions. It writes no native artifact generation and is not a compatibility verdict.
Each theme includes layer counts, visited JSON nodes, UTF-8 bytes and maximum depth before/after;
every transformed layer is listed with its ID, physical span, branch count and zoom intervals,
sort-key expression and paint indicators. Simultaneously active branches are marked as an
unproven feature-order boundary, not as a claim that their geometry is disjoint.

Subtree accounts separate copied unchanged layer payload from generated filters and input
cap/dash decisions. They identify whether predicate expansion or repetition of other properties
dominates; they are not an additive byte decomposition. The counters include array keys, matching
the profile's existing node convention. Retain the report with the checkout SHA. An over-budget
result must not be treated as a successful native build or fixed by dropping layers or weakening
validation. The test suite prints the two-theme size summary even when a budget assertion fails.

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
