# Native resource URLs

`@tileflow/core/native` provides synchronous URL helpers for clients that do not have a browser
origin. Its published entry bundles a private WHATWG parser with IDNA processing. It does not use
or replace the ambient `URL`, `TextEncoder` or `TextDecoder`, and has no renderer dependency.

These helpers resolve URLs; they do not load manifests, validate MapLibre styles, create maps, or
authorize Hosted requests. A successful resolution is not a claim that a style or feature works on
a particular native renderer. Install `@tileflow/core@alpha` as described in the
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
Complete notices are included in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

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
pnpm --filter @tileflow/core exec tsx --test test/native-runtime-url.test.ts test/native-url-provider.test.ts test/native-url-utf8.test.ts test/native-url-policy.test.ts
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
remains a separate qualification step; static parsing and Node tests do not establish it. This
entry still does not load manifests, render maps, create transport grants or make mobile service
availability claims.
