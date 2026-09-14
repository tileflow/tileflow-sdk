# Native resource URLs, sources and initial views

`@tileflow/core/native` provides URL helpers, source coordination and renderer-neutral initial
views for clients without a browser origin. Its published entry bundles a private WHATWG parser
with IDNA processing. It does not use or replace the ambient `URL`, `TextEncoder` or `TextDecoder`,
and has no renderer dependency.

The synchronous URL helpers resolve references only. Manifest sources use an injected bounded
acquisition adapter; direct MapLibre sources do not make requests. None of these APIs renders maps
or authorizes Hosted requests. A successful resolution is not a claim that a style or feature works
on a particular native renderer. Install `@tileflow/core@alpha` as described in the
[package README](../README.md); the examples use only this package's public exports.

## Resolve the manifest explicitly

A native client must provide the complete manifest URL. There is no implicit
`/tileflow/manifest.json`, Metro host, device address, or current application route.

<!-- docs:check -->

```ts
import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';

const manifestUrl = resolveTileflowNativeManifestUrl(
  'https://maps.example.com/tileflow/native/manifest.json',
);
```

The result is the validated, absolute HTTPS manifest URL; no network request is made.
The default policy requires HTTPS. Both input and resolved URLs are limited to 2,048 UTF-16 code
units. Empty values, leading or trailing whitespace, control characters, backslashes, fragments,
malformed percent escapes, embedded credentials, and protocol-relative URLs are rejected.
Local file URLs and custom renderer protocols are outside this helper's HTTP(S) contract.

## Resolve resources from their owning document

Pass the URL of the document that declares the resource. A style URL is relative to its manifest;
a tile URL in TileJSON is relative to that TileJSON; a font URL in a style is relative to the style.
The helper uses normal URL path resolution and never guesses a deployment prefix.

<!-- docs:check -->

```ts
import {resolveTileflowNativeResourceUrl} from '@tileflow/core/native';

const styleUrl = resolveTileflowNativeResourceUrl('styles/main/light.json', {
  documentUrl: 'https://maps.example.com/tileflow/native/manifest.json',
});

const tileUrl = resolveTileflowNativeResourceUrl('./{z}/{x}/{y}.pbf', {
  documentUrl: 'https://tiles.example.com/streets/tiles.json',
  template: 'tile',
});
```

`styleUrl` resolves to the `styles/main/light.json` path beneath the manifest's directory. `tileUrl`
resolves to the `streets/{z}/{x}/{y}.pbf` template on the tile server; no tile coordinates are chosen.

Use the actual document URL after any redirects that the application has approved. The declaring
URL is validated even when the resource is already absolute. External HTTPS resources retain their
own origin. The helper never adds delivery credentials or copies a parent's query parameters to a
child resource.

`template: 'tile'` preserves `{z}`, `{x}`, `{y}`, `{ratio}`, `{quadkey}`, `{bbox-epsg-3857}`, and
`{prefix}`. `template: 'glyphs'` preserves `{fontstack}` and `{range}`. These placeholders are allowed
only in the resource path or query, not the authority. They are not expanded or checked against a
renderer version. Unknown, mismatched, and incomplete placeholders are rejected. Without a template
option, literal braces are rejected; existing percent-encoded braces in paths and queries remain
encoded literal data. Manifest and declaring-document URLs cannot contain literal placeholders.
Hostname normalization must not introduce placeholders, including from percent escapes or Unicode
characters that normalize to braces.

## Opt into one development origin

A debug integration can explicitly permit one HTTP origin:

<!-- docs:check -->

```ts
import {resolveTileflowNativeManifestUrl} from '@tileflow/core/native';

const manifestUrl = resolveTileflowNativeManifestUrl(
  'http://192.168.1.5:8080/tileflow/manifest.json',
  {developmentOrigin: 'http://192.168.1.5:8080'},
);
```

Supply the same option when resolving that document's resources. Scheme, hostname, and port must
match the selected origin after URL normalization. An exception for `localhost` does not permit
`127.0.0.1`, another port, or another device. HTTPS remains allowed. The option must name an HTTP
origin without a path, query, fragment, wildcard, or credentials; an optional trailing slash is
accepted. Wildcards and placeholders are rejected before and after hostname normalization.

Keep this option in debug-only application configuration. The helper cannot determine whether the
application is a debug build, does not change iOS or Android transport settings, and does not expose
a development server. The application still owns any narrowly scoped debug transport exception.

## Handle errors without logging the rejected URL

Failures throw `TileflowNativeUrlError`, a `TypeError` with a stable `code` and `field`.

- `NATIVE_URL_INVALID`: malformed, unsafe, unsupported-scheme, or oversized URL.
- `NATIVE_URL_ABSOLUTE_REQUIRED`: a document URL is missing its explicit HTTP(S) origin.
- `NATIVE_URL_HTTPS_REQUIRED`: HTTP does not match the selected development origin.
- `NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID`: the development exception is not one valid HTTP origin.
- `NATIVE_URL_TEMPLATE_INVALID`: a template is unsupported, misplaced, or incomplete.

`field` is `manifestUrl`, `documentUrl`, `resourceUrl`, or `developmentOrigin`. Error messages do not
include the submitted URL or attach the original parser error. The application should preserve
that boundary when reporting failures: resource URLs may contain sensitive query parameters.

For JavaScript callers, missing or non-object resource options report `NATIVE_URL_INVALID` with
`field: 'documentUrl'`, just like an options object without its required `documentUrl`. Non-object
manifest options report `NATIVE_URL_DEVELOPMENT_ORIGIN_INVALID` with `field: 'developmentOrigin'`.
Omitting manifest options or passing `undefined` remains valid and uses the default HTTPS policy.
Neither function accepts `null` as an options object.

This is URL policy, not an authorization or server-side request-forgery defense. Callers still own
resource-origin authorization, redirect handling, response size limits, cancellation, and any
network request. Do not attach a credential merely because this helper accepted a URL.

## Private parser and source builds

The native entry embeds the low-level parser from `whatwg-url` 15.1.0, `tr46` 6.0.0 (Unicode 17
IDNA processing) and Punycode.js 2.3.1. It exposes no URL class or parser configuration. Package
consumers only install Core; the published `dist/native.js` has no external runtime imports.
The parser is a development/build dependency, not an additional runtime package to install.
Canonical manifest validation also embeds the existing Zod dependency; it adds no package that
consumers must configure. Complete notices are included in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

A React Native URL shim can concatenate references onto a filename or append a slash to `.json`.
The native helpers instead resolve against the owning document with the bundled parser, including
host percent-decoding, IDNA mapping, default ports and encoded dot segments. This does not require
an application-wide polyfill. The build-time native artifact validator uses the same Tileflow URL
policy with its existing host parser; it does not embed the mobile parser in its own bundle.

From an SDK source checkout, run the ordinary Core build, not a direct source import in a native
application. `tsup.native.config.ts` builds only the native entry with `platform: 'browser'`,
`target: 'es2020'`, ESM and no splitting. Its plugin redirects exactly the two relative
`./encoding` imports in the pinned parser modules to Core's private UTF-8 codec. It rejects an
unexpected dependency version, an unbound codec import or external runtime imports. It does not
patch packages on disk, configure a global alias or change another entry's build.

The codec uses replacement semantics for unmatched UTF-16 surrogates and invalid UTF-8 bytes and
preserves BOMs, matching `TextEncoder` and non-fatal `TextDecoder('utf-8', {ignoreBOM: true})`.
It processes at most 65,536 code units for encoding or 65,536 bytes for decoding per call. Private
placeholder sentinels are bounded well below that ceiling; the public URL ceiling stays at 2,048
code units. No parser or codec error is exposed as a cause containing the rejected URL.

## Check the built package

From an installed and built SDK checkout:

```sh
pnpm --filter @tileflow/core exec tsx --test test/native-runtime-url.test.ts test/native-url-provider.test.ts test/native-url-utf8.test.ts test/native-url-policy.test.ts test/native-source-view-package.test.ts
```

The existing runtime regression checks the Node host and a React Native URL fixture independently.
Another test copies the built native file into an empty directory and executes it with ambient URL
and codec getters that throw. Neither test is a Hermes or device qualification.

For size comparisons, build Core in two isolated checkouts and retain an `npm pack --json` receipt
from each package directory. Pass the already-built Core directories and optional receipt paths to:

```sh
node packages/core/scripts/measure-native-url.mjs /path/to/before/packages/core /path/to/after/packages/core /path/to/before-pack.json /path/to/after-pack.json
```

The report separates raw native entry bytes, its runtime graph, a minified ES2020 browser consumer,
gzip size, compressed tarball bytes and unpacked package bytes. It performs no installation and is
not a Metro bundle, Hermes bytecode or device-memory measurement.

Native acceptance must install the exact tarball in an existing iOS/Android application and run
[`checkNativeUrlContract`](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/test/fixtures/native-url-contract.mjs)
with the installed `@tileflow/core/native` exports, leaving the application's URL global unchanged.
The [fixture procedure](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/test/fixtures/native-url-contract.md)
covers the two explicit development origins without network requests. Packaged Hermes execution
remains a separate qualification step; static parsing and Node tests do not establish it. URL-provider
checks do not qualify new source/view behavior. This entry does not render maps, create transport
grants or make mobile service availability claims.

## Acquire a bounded manifest

`loadTileflowNativeManifest(manifestUrl, {acquire, signal?, developmentOrigin?})` loads only the
runtime manifest. The application supplies `acquire`; Core never selects an ambient `fetch` or
starts a request at import time. The function returns an immutable `{manifestUrl, manifest}` result.
`manifestUrl` is the validated final response URL, not a guessed application or Metro address.

The acquisition adapter returns a request handle immediately. Its `response` promise resolves to
`{url, status, reader}`, and its `cancel()` method must be usable before the response arrives.
`url` must be the absolute final URL after redirects that the adapter has approved. Redirect and
resource-origin authorization remain application responsibilities; HTTPS syntax does not authorize
another origin. A missing or invalid final URL is an error, not a reason to reuse the request URL.

The reader exposes `read(maximumBytes)` and `cancel()`. Each read returns either `{done: true}` or
`{done: false, value: Uint8Array}` with between one and the requested number of bytes. Core requests
at most 64 KiB and copies each measured chunk before requesting another. At the 1 MiB ceiling it
requests one byte to distinguish EOF from overflow. Empty chunks, strings, malformed read results,
and chunks that exceed the requested allowance are rejected. The adapter must release its resources
at EOF; cancellation and failure also call its reader/request cancellation hooks.

An adapter must enforce bounded reads at its acquisition boundary. It must not implement this
interface by first calling an unlimited `response.text()`, `arrayBuffer()`, or native equivalent and
then slicing the completed body. A platform without a bounded byte reader needs an appropriate
acquisition adapter; this package does not supply a network bridge or a fallback buffering path.
The supplied request `maximumBytes` is the canonical 1 MiB cap, not an adjustable consumer budget.

Core counts actual bytes, never relies on Content-Length, and rejects overflow before JSON/schema
processing. Decoding is fatal UTF-8: malformed bytes and truncated sequences fail, including those
split across reads. One leading BOM is removed, matching the existing runtime reader; later BOMs
remain data. The private URL codec retains its existing replacement behavior for URLs. A depth
ceiling of 64 is checked before parsing JSON, and the canonical manifest schema still imposes all
map/theme/font/view/identity restrictions. Canonical and resolved manifest JSON must also remain
within 1 MiB; URL expansion cannot turn a small response into an unbounded result.

There is one version-1 grammar, shared with `parseTileflowRuntimeManifest`. Native supplies the
accepted private URL provider and byte-counting primitives to that grammar, without widening its
wire fields or accepting previously rejected relative URL forms. Every theme's `styleUrl` resolves
against the final manifest URL; font declarations retain the existing style-relative ownership.
The loader resolves those references but does not download styles, fonts, sprites, tiles or TileJSON.
Declared revisions and map/style IDs remain data, not inferred authorization or a session bootstrap.

There is no implicit cache, retry, request timeout or background task. Use the adapter's bounded
request policy or an external AbortSignal-compatible input for a deadline. Core does not construct
an AbortController, inspect `signal.reason`, install a polyfill, or wait for a broken cancellation
hook to finish. It retires an aborted operation immediately, observes late promise rejections and
cancels a reader that arrives after retirement. Physical cancellation of network work still depends
on the adapter honoring its cancellation methods.

## Control a source

`createTileflowNativeSourceController({acquire})` coordinates either a manifest-backed Tileflow
source or an unmanaged direct MapLibre style. Its `state` is undefined until the first `replace()`.
It then publishes only `loading`, `ready`, or `error` snapshots, each with a monotonically increasing
`generation`. The acquisition adapter remains required at construction, but is used only for
Tileflow sources. Core does not mount a renderer or subscribe to device appearance.

The following function expects an acquisition adapter implementing the bounded protocol above.
The example URL represents an existing manifest endpoint; no network adapter is supplied here.

<!-- docs:check -->

```ts
import {
  createTileflowNativeSourceController,
  type TileflowNativeManifestAcquire,
} from '@tileflow/core/native';

export async function connectNativeManifest(acquire: TileflowNativeManifestAcquire) {
  const controller = createTileflowNativeSourceController({acquire});
  await controller.replace(
    {
      kind: 'tileflow',
      map: 'streets',
      manifestUrl: 'https://maps.example.com/tileflow/native/manifest.json',
    },
    {theme: 'dark'},
  );
  const state = controller.state;
  if (state?.status === 'ready' && state.kind === 'tileflow') {
    console.log(state.map.name, state.theme.name, state.theme.revision);
  } else if (state?.status === 'error') {
    console.error(state.error.code, state.error.field);
  }
  return controller;
}
```

Every `ready` snapshot has `kind`, which always matches `source.kind`. Narrow `state.kind` to narrow
the entire ready union in TypeScript. The Tileflow variant retains the immutable requested `source`,
final `manifestUrl`, resolved `manifest`, selected `map` and concrete `theme` as required fields.
The direct variant contains only `status`, `generation`, `kind` and its immutable `source`; its style
is `source.style`. It has no manifest, map or theme fields, not optional placeholders for those fields.

For Tileflow sources, map/theme identity and revisions come from the manifest. Map-level `apiUrl`
takes precedence over manifest-level `apiUrl`; no identity is guessed from URL paths. The map's
canonical `view` is preserved as metadata. The controller does not combine camera inputs.

Omitted `theme` uses `defaultTheme`; a concrete theme selects that exact declared name. `system`
uses the manifest's `systemThemes` mapping only when an explicit `colorScheme: 'light' | 'dark'`
is supplied. The same portable resolver owns this precedence in the existing runtime. Core never
reads device appearance. A missing map, missing theme or unresolved system selection is an error;
there is no first-map or first-theme fallback.

`replace(source, options)` snapshots inputs and retires the prior generation. A failed replacement
cannot publish the previous source as newly ready. Only the current generation can publish success
or error, even when responses arrive out of order or a transport ignores cancellation. Each Tileflow
replacement reacquires its manifest; direct replacements make no request. There is no hidden source
cache. The promise settles when that generation completes or is retired; source failures are reported
in `state`, not as rejected replacement promises. Calling it after disposal rejects with
`NATIVE_SOURCE_DISPOSED`.

`subscribe(listener)` synchronously receives the current snapshot, when present, and subsequent
snapshots until its returned unsubscribe function is called. Observer exceptions are isolated from
acquisition and from other observers. Reentrant replacement/disposal prevents remaining observers
from receiving an obsolete notification. `dispose()` is idempotent: it retires active work, clears
listeners and retains the last snapshot for inspection without publishing another state. No late
completion or abort can notify a disposed controller.

## Use an unmanaged direct style

A direct source is `{kind: 'maplibre', style: string | MapLibreStyle}`. It does not call `acquire`,
parse a manifest, infer Hosted identity, attach credentials, select a Tileflow theme, or fetch the
style or its resources. A supplied `theme`, including `system`, fails with `NATIVE_THEME_INVALID`.
An injected `colorScheme` alone has no effect on a direct source.

This example uses an already-created controller; no acquisition adapter is needed for the replacement:

<!-- docs:check -->

```ts
import type {TileflowNativeSourceController} from '@tileflow/core/native';

export async function useDirectStyle(controller: TileflowNativeSourceController) {
  await controller.replace({
    kind: 'maplibre',
    style: 'https://maps.example.com/styles/light.json',
  });
  const state = controller.state;
  return state?.status === 'ready' && state.kind === 'maplibre' ? state.source.style : undefined;
}
```

A string must be an explicit absolute HTTP(S) document URL. It uses the same bounded WHATWG/IDNA
policy as manifest URLs, including HTTPS by default and an exact opt-in development origin. Relative
strings and custom protocols are rejected; there is no owner URL to resolve them against.

A style object is copied as data and deeply frozen without freezing or mutating caller-owned
objects. Its strings, expressions, metadata and resource references are preserved: there is no
lowering, URL rewriting, font preparation or fallback. Values must be finite JSON data in plain
objects or dense arrays. Accessors, hidden properties, symbol keys/values, functions, bigint,
cycles, custom prototypes and `__proto__`, `constructor`, `prototype` or `toJSON` keys are rejected.
Shared non-cyclic subobjects are copied and counted at each occurrence. This is not a JavaScript
sandbox: supply data, not executable objects or proxies with side effects.

Direct input uses the existing raw native style ceilings: 8 MiB of compact serialized UTF-8 JSON,
depth 64, 160,000 visited keys/indexes and values, 4,096 layers and 128 sources. It does not use the
larger allowance reserved for compiled/lowered artifacts. An oversized direct object can instead
be delivered through a style URL, with resource acquisition governed by its consuming adapter.
These checks establish data safety and bounded copying, not conformance to the Style Specification
or support for a style property on a particular renderer. A direct `ready` state is not a rendering
or authorization result. Failures use `NATIVE_SOURCE_INVALID` with `field: 'source'`.

Replacing a pending Tileflow source with a direct source retires the manifest operation. Its late
response, error or abort cannot overwrite the direct state. Switching back to Tileflow follows the
normal manifest acquisition path. The direct style is snapshotted before observer notifications or
retired-transport cleanup can mutate the original data.

## Resolve an initial view without a renderer

`resolveTileflowNativeInitialView({view?, mapOptionsView?, manifestView?})` returns an immutable
`{center, zoom, bearing, pitch}`. All three inputs are partial renderer-neutral view objects, not
React Native props or MapLibre camera types. Precedence applies independently to each field:
`view` > `mapOptionsView` > `manifestView` > shared runtime defaults.

<!-- docs:check -->

```ts
import {resolveTileflowNativeInitialView} from '@tileflow/core/native';

const initialView = resolveTileflowNativeInitialView({
  manifestView: {center: [-3.7, 40.4], zoom: 10, bearing: 12},
  mapOptionsView: {zoom: 11, pitch: 30},
  view: {zoom: 13},
});
```

The result is `{center: [-3.7, 40.4], zoom: 13, bearing: 12, pitch: 30}`. With no inputs, the defaults
are `{center: [0, 20], zoom: 2, bearing: 0, pitch: 0}`. Coordinates always use
`[longitude, latitude]`; Core neither swaps nor wraps them.

Validation reuses the manifest view grammar: longitude -180 to 180, latitude -90 to 90, zoom 0 to 24,
bearing -180 to 180 and pitch 0 to 85, all finite. Supplied fields with `undefined` are omitted;
`null`, out-of-range values, unknown fields, accessors and malformed tuples are errors. Every
supplied level is validated, even if a higher-precedence level would override it. Invalid explicit
input never silently falls back. The result owns a new frozen tuple, not a reference to an input or
to the shared defaults. Failures use `NATIVE_SOURCE_INVALID` with `field: 'view'` and no caller values.

The resolver is synchronous and independent of source control. Calling it again for a camera update
does not load a manifest, change the selected theme or increment a source generation. It does not
animate, read device appearance, install listeners or apply the result to a renderer.

## Handle source errors

Source operations and initial-view resolution use `TileflowNativeSourceError` with stable `code`,
`field` and `kind`. An active external abort produces `kind: 'cancelled'` and `NATIVE_SOURCE_ABORTED`;
superseded or disposed work cannot publish that error into a newer generation. Acquisition,
response, schema and selection failures are terminal for that generation. A later explicit
`replace()` can retry. Tile-resource failures after a map is created are outside this controller
and do not get classified as manifest failures.

| Code | Meaning |
| --- | --- |
| `NATIVE_SOURCE_INVALID` | Invalid source, view, acquisition configuration or cancellation input. |
| `NATIVE_SOURCE_ABORTED`, `NATIVE_SOURCE_DISPOSED` | Cancellation or use after controller disposal. |
| `NATIVE_MANIFEST_URL_INVALID` | Invalid request/final URL or development-origin policy. |
| `NATIVE_MANIFEST_REQUEST_FAILED` | Acquisition/read failure or unsuccessful response. |
| `NATIVE_MANIFEST_RESPONSE_INVALID` | Invalid response, reader or chunk protocol. |
| `NATIVE_MANIFEST_ACCESS_DENIED`, `NATIVE_MANIFEST_NOT_FOUND` | HTTP 401/403 or 404, respectively. |
| `NATIVE_MANIFEST_TOO_LARGE` | Actual body or resolved/canonical JSON exceeds the 1 MiB cap. |
| `NATIVE_MANIFEST_UTF8_INVALID`, `NATIVE_MANIFEST_JSON_INVALID` | Malformed UTF-8 or JSON. |
| `NATIVE_MANIFEST_INVALID` | Invalid version-1 structure, relationships or excessive nesting. |
| `NATIVE_MANIFEST_RESOURCE_INVALID` | A manifest resource fails native URL policy. |
| `NATIVE_MAP_NOT_FOUND`, `NATIVE_THEME_INVALID` | Missing map or invalid/unresolved theme selection; a theme on a direct source. |

Fields identify only `source`, `signal`, `manifestUrl`, `response`, `body`, `map`, `theme` or `view`.
Errors never carry a rejected URL, response body, credential, remote exception, schema issue list or
abort reason. Successful snapshots necessarily contain resource URLs; treat them as potentially
sensitive when logging. The synchronous URL helpers retain their existing `TileflowNativeUrlError`
contract. A view error is thrown by the pure resolver and does not change controller state.

These APIs acquire manifests, snapshot direct sources and resolve view data. They do not load styles,
validate their cartographic compatibility, fetch their resources, render maps, create Hosted
authorization or sessions, or provide a React Native component. New direct-source and view behavior
requires its own packed Hermes checks; prior URL/manifest checks, Node tests and browser captures do
not establish those results.
