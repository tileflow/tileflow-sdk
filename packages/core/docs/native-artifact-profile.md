# Validate native artifacts

`@tileflow/core/native-profile` checks a resolved MapLibre style against the static `native-v1`
artifact profile. It is a build-time entry point, separate from the dependency-free URL helpers in
`@tileflow/core/native`. Install Core as described in the [package README](../README.md).

This is not a mobile SDK. It does not fetch a manifest, execute a renderer, start a commercial
session, or qualify Hermes, iOS or Android. A passing result establishes static artifact checks,
not native pixels, data availability, Hosted access, publication or mobile product availability.

## Check a style

<!-- docs:check -->

```ts
import {validateTileflowNativeStyle} from '@tileflow/core/native-profile';

const diagnostics = validateTileflowNativeStyle({
  version: 8,
  sources: {},
  layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}],
});

console.log(diagnostics);
```

The result is an empty array for a style that passes this profile, or bounded structured errors.
`assertTileflowNativeStyle()` throws `TileflowNativeCompatibilityError` for the same errors.
Neither function modifies the input. Both enforce the raw input budget, even when given a style
that was already prepared. Relative resources require the explicit `documentUrl` option
and resolve against that declaring style; it is not inferred from a browser or Metro address.

Use the [Dev artifact pipeline](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md)
for authored maps. It resolves inheritance and semantic modules once, prepares icons and fonts,
checks every theme and returns a complete generation. Do not call a style validator instead of
preparing the referenced resources.

## Profile and metadata

The exported `tileflowNativeProfile` targets MapLibre Native Android 13.7.1 and iOS 7.0.0, the
engines the Swift and Kotlin SDKs ship. These are static compatibility targets, not a supported
application dependency matrix. The React Native package's current wrapper (MapLibre React Native
11.5.0, Android 13.6.1, iOS 6.31.0) predates them: a style that uses root `state`,
`global-state`, `interpolate-hcl` or `interpolate-lab` needs the native SDK engines.

Tileflow retains its existing compiler and parser at Style Spec 24.8.5 (`validatorStyleSpec`):
`native-v1` checks that compiler's vocabulary and the intersection of the recorded Android and
iOS support. Where those tables predate the pinned engines, support comes from Style Spec 26.5.1
(`supportStyleSpec`) and the engines' release notes: root `state` and `global-state`, `split`,
`interpolate-hcl` and `interpolate-lab`. `color-relief` layers and multidirectional hillshade are
supported by both engines. The [native style artifact contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/native-style-artifact.md)
lists each entry with its source.

The checker reads the full `sdk-support` and expression metadata from the pinned Style Spec
package's `dist/latest.json`. Its minified JavaScript exports omit that information. A missing
expression-support entry, issue link or required native version newer than either selected engine
is not evidence of support; an entry of `supported` is support in every release. The metadata
source is the [pinned specification](https://github.com/maplibre/maplibre-style-spec/blob/v24.8.5/src/reference/v8.json).

`tileflowNativeProfileSchema`, `tileflowNativeDiagnosticSchema`, `tileflowRendererSchema` and
`tileflowNativeBuildRecordSchema` are strict canonical Zod schemas. The map authoring grammar and
its generated language JSON are unchanged: renderer selection belongs to build tooling, not maps.

## Included representations and explicit rejections

The profile admits fixed Mercator styles, standard vector/raster/GeoJSON/image sources, compatible
hillshade and building extrusions, one effective sprite, glyph URLs and complete prepared TTF/OTF
faces. Paint, layout and expression values must also pass the pinned semantic parser and native
support metadata. Hillshade and building extrusions do not establish 3D terrain support.

The raw style validator rejects globe or adaptive projection, terrain displacement, sky,
unsupported source/layer/property values (including `resampling` on hillshade and colour relief),
legacy stop-function objects, browser contour and PMTiles protocols, local file URLs and multiple
sprite providers. The existing portable camera/view bounds are preserved; an artifact
does not configure a native map instance's camera constraints. It does not silently remove
an unsupported feature or replace a font. An explicit fixed-Mercator property can be omitted in the
native representation because Native has no GL JS projection controller; this does not change the
logical map revision.

Dev's `native-lowering-v2` preparation first leaves out or replaces what native maps cannot draw
(browser contours, the 3D scene except building extrusions, terrain displacement, relief
resampling) and records each change as a degradation from `tileflowNativeCapabilities`; see the
[artifact contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/native-style-artifact.md)
for the vocabulary and the rule that marks a map web only. It converts a fixed `{type: 'globe'}`
projection to Native's implicit Mercator and removes a browser `sky` before this validator runs. This is a recorded projection
change, not globe support or visual equivalence. One authored map serves web and native preparation;
no native-specific Streets definition is used. Preparation adapts only finite `line-cap` and
`line-dasharray` decisions into constant-property layers, and replaces constant `icon-overlap` and
`text-overlap` modes with their `*-allow-overlap` equivalent. Other unsupported properties have no
implicit fallback. The raw validator continues to reject unlowered unsupported expressions and
overlap modes. See the [preparation contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md)
for the grammar, expansion limits and pending native visual checks. The lowering checks establish
per-feature selection and cap/dash values, not global feature draw order. A copied `line-sort-key`
cannot preserve ordering between simultaneous physical branches; overlapping features may produce
a different composition even when every property value is retained.

`native-build.json` uses strict schema version 3 and `preparationVersion: 'native-lowering-v2'`.
Its `transformations` array is ordered by map/theme and binds the input/lowered style hashes,
projection policy, an optional `sky: 'removed'`, removed and inserted layers, physical layer spans,
symbol overlap replacements and the style's degradation IDs. The runtime manifest remains version

1. An older build-record decoder must reject version 3 rather than silently ignore the preparation
   evidence.

The same entry point computes and checks the per-map family document (`createTileflowNativeFamily`,
`tileflowNativeFamilySchema`) and exports the reference evaluators that the native SDKs reproduce
(`fillTileflowNativeTemplate`, `tileflowNativeBlendLayers`, `emphasizeTileflowNativeValue`).

Text must use a valid glyph template containing `{fontstack}` and `{range}`, or a complete static
font stack backed by prepared faces. Native preparation maps each exact OpenType full name to its
verified TTF/OTF URL. WOFF2 conversion, Unicode-range split providers, dynamic font-stack closure and
implicit system-font fallback are outside this artifact profile. A fallback name without a prepared
face fails instead of being silently substituted. The existing font pipeline still owns parsing,
font selection, content hashes and required licenses.

The `deferFontClosure` option is only for compiler preflight before font preparation. It deliberately
does not prove text-provider closure. The Dev pipeline always performs the final full validation
after preparation; external callers must not present a preflight result as a complete artifact check.

## Input and prepared-style budgets

`tileflowNativeProfileLimits` and `validateTileflowNativeStyle()` keep untrusted compiler input at
**320,000 visited JSON nodes**; the largest official map, Map 1777, holds about 245,000. Dev applies this gate before lowering. The raw validator has no
option to borrow the output allowance, and preparation never retries rejected input with a larger
budget. Exceeding the input bound remains `NATIVE_UNSUPPORTED_STYLE` at the root style pointer.

`tileflowNativePreparedStyleLimits` and `validateTileflowNativePreparedStyle()` use a separate fixed
ceiling of **540,000 nodes** for the expanded representation. The latter performs the same semantic,
source, font and URL checks; it does not lower a style, relax unsupported properties or establish
that the input came from a trusted build. Use it to check prepared artifact JSON, not as the entry
gate for authoring. Dev uses it after lowering, after font preparation and after generation URL
retargeting, before writing the output generation.

Both stages use the same traversal. Each object key or array index and each value counts as a
node. Both retain **8 MiB of serialized UTF-8, depth 64, 128 sources, 4,096 layers, 16 prepared font
faces and 32 returned errors**. Cycles, getters, sparse arrays, non-JSON values and `toJSON` hooks
remain invalid. The prepared budget changes only the node allowance; per-decision and per-layer
expansion limits also remain mandatory.

The 540,000-node ceiling was set when the full Streets family lowered to about 513,000 nodes per
theme. Streets now lowers from about 136,000 to 208,000 nodes per theme, and Map 1777, which needs
no lowering, holds about 245,000. The ceiling accommodates the bounded prepared representation,
not unbounded growth of custom styles. Prepared font bytes retain the existing
1 MiB per-face bound; URL, icon and sprite limits retain their owning pipelines' bounds. These are
validation-work limits, not download, GPU-memory or billing limits.

Allowing the larger prepared representation increases the maximum traversal and parser workload.
The byte, depth, layer and decision bounds still apply; there is no caller-selected unlimited
mode. The node traversal stops at its ceiling before JSON serialization and semantic parsing.
These finite limits are not a latency guarantee for every machine or a substitute for admission
controls in an application accepting arbitrary artifacts.

## Read diagnostics

Every native diagnostic has `code`, `phase`, `severity`, `path`, `renderer`, `profile`, `message`
and `suggestion`. `path` is a JSON Pointer into the style; artifact preparation prefixes it with the
map and theme. Error messages do not include rejected URLs, parser details or credentials. Unsafe
object-key text is represented by its ancestor pointer.

- `NATIVE_UNSUPPORTED_STYLE`: incompatible style semantics or artifact shape.
- `NATIVE_UNSUPPORTED_SOURCE`: incompatible source, URL or browser protocol.
- `NATIVE_FONT_UNAVAILABLE`: missing or incompatible native text-provider closure.
- `NATIVE_MANIFEST_REQUIRED`: no declaring document URL for relative resources.
- `NATIVE_RENDERER_UNSUPPORTED`: unavailable renderer/profile or native delivery target.

Dev sessions and CLI commands retain their existing diagnostic envelopes and add the native
`renderer`/`profile` context. Unchanged web calls do not gain extra diagnostic fields.
