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
Neither function modifies the input. Relative resources require the explicit `documentUrl` option
and resolve against that declaring style; it is not inferred from a browser or Metro address.

Use the [Dev artifact pipeline](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md)
for authored maps. It resolves inheritance and semantic modules once, prepares icons and fonts,
checks every theme and returns a complete generation. Do not call a style validator instead of
preparing the referenced resources.

## Profile and metadata

The exported `tileflowNativeProfile` targets MapLibre React Native 11.3.10 with Native Android 13.2.0
and iOS 6.26.0. These are static compatibility targets, not a supported application dependency matrix.
The wrapper's Style Spec version is 26.2.1. Tileflow retains its existing compiler and parser at
24.8.5: `native-v1` checks that compiler's vocabulary and the intersection of its recorded Android
and iOS support. It does not expose every feature of Style Spec 26.2.1 or upgrade the web compiler.

The checker reads the full `sdk-support` and expression metadata from the pinned Style Spec
package's `dist/latest.json`. Its minified JavaScript exports omit that information. A missing
expression-support entry, issue link or required native version newer than either selected engine
is not evidence of support. The metadata source is the
[pinned specification](https://github.com/maplibre/maplibre-style-spec/blob/v24.8.5/src/reference/v8.json).

`tileflowNativeProfileSchema`, `tileflowNativeDiagnosticSchema`, `tileflowRendererSchema` and
`tileflowNativeBuildRecordSchema` are strict canonical Zod schemas. The map authoring grammar and
its generated language JSON are unchanged: renderer selection belongs to build tooling, not maps.

## Included representations and explicit rejections

The profile admits fixed Mercator styles, standard vector/raster/GeoJSON/image sources, compatible
hillshade and building extrusions, one effective sprite, glyph URLs and complete prepared TTF/OTF
faces. Paint, layout and expression values must also pass the pinned semantic parser and native
support metadata. Hillshade and building extrusions do not establish 3D terrain support.

It rejects globe or adaptive projection, terrain displacement, sky and global-state extensions,
unsupported source/layer/property values, legacy stop-function objects, browser contour and PMTiles protocols, local file URLs,
multiple sprite providers. The existing portable camera/view bounds are preserved; an artifact
does not configure a native map instance's camera constraints. It does not silently remove
an unsupported feature or replace a font. An explicit fixed-Mercator property can be omitted in the
native representation because Native has no GL JS projection controller; this does not change the
logical map revision.

Text must use a valid glyph template containing `{fontstack}` and `{range}`, or a complete static
font stack backed by prepared faces. Native preparation maps each exact OpenType full name to its
verified TTF/OTF URL. WOFF2 conversion, Unicode-range split providers, dynamic font-stack closure and
implicit system-font fallback are outside this artifact profile. A fallback name without a prepared
face fails instead of being silently substituted. The existing font pipeline still owns parsing,
font selection, content hashes and required licenses.

The `deferFontClosure` option is only for compiler preflight before font preparation. It deliberately
does not prove text-provider closure. The Dev pipeline always performs the final full validation
after preparation; external callers must not present a preflight result as a complete artifact check.

The validator limits JSON to 8 MiB of serialized UTF-8, depth 64 and 100,000 visited values, with at
most 128 sources, 4,096 layers, 16 prepared font faces and 32 returned errors. Prepared font bytes
retain the existing 1 MiB per-face bound. URL, icon and sprite limits remain the owning pipelines'
limits. These are local validation-work bounds, not download, GPU-memory or billing limits.

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
