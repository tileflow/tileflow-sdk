# Native artifacts, local preview and Hosted deployment

Use a project-local CLI version that includes the native artifact selector and a trusted
`tileflow.config.ts`. Follow the [installation instructions](../README.md) first. Native commands
prepare, serve or publish Tileflow artifacts; they do not install, start or qualify a mobile renderer.

## Validate and build

```sh
npx tileflow validate --renderer native --target local --json
npx tileflow build --renderer native --target local --out public/tileflow --json
```

`validate` prepares and checks the complete theme family without writing production output.
`build` writes the checked generation beneath `public/tileflow/native`, including a strict version-1
runtime manifest and a separate schema-v2 `native-build.json` record. Serve the complete renderer
directory, not just the style. A failed compatibility check leaves existing output unchanged.

Both commands accept `--renderer web|native`; omission means `web`. Renderer selection is separate
from `--target local|hosted`. Existing `validate --target hosted` continues to perform web Hosted
preflight. Native with `--target hosted` fails with `NATIVE_RENDERER_UNSUPPORTED` before loading the
config or writing files. `build --target hosted` is not publication and is rejected. The explicit
combined Hosted publication command below performs its own complete two-renderer preflight.

JSON success uses the existing version-1 command envelope. Native results additionally identify
`renderer: 'native'`, `profile: 'native-v1'` and `validation: 'static-artifacts'`. JSON failure writes
one structured envelope to stderr, leaves stdout empty and exits nonzero. Native diagnostics have
safe JSON Pointers, stable codes, severity and suggestions. Unknown renderer names are not echoed.
The ordinary web commands and their default artifact bytes retain their existing behavior.

## Watch and serve native artifacts

`preview` and its `dev` alias use the same renderer selector:

```sh
npx tileflow preview --renderer native --map stores --theme light
```

Native mode creates the existing watched artifact session with renderer `native`. It keeps the
last-known-good native artifact family when a watched generation becomes invalid and replaces it
only after a later valid generation is prepared. The endpoint is an **assets-only** development
endpoint: it does not render a browser map, open the visual workbench, start Metro, launch a device,
or establish visual/native acceptance.

With the default host and port, the canonical runtime manifest is:

```text
http://127.0.0.1:3333/native/manifest.json
```

The manifest remains the ordinary strict version-1 Tileflow runtime manifest. Its style, sprite,
font, tileset and generation references use the existing renderer-specific `/native/...` paths; no
preview-only manifest schema is introduced. `--map` and `--theme` validate a desired map/theme
against that finalized manifest but do not narrow or fork the served artifact family.

Human output identifies the exact manifest URL, profile `native-v1`, and `assets-only` endpoint.
Native NDJSON lifecycle events additionally carry `renderer`, `profile`, `manifest` and
`assetsOnly`; the default and explicit `--renderer web` lifecycle/output contract remains the
existing browser-preview contract.

Metro remains the React Native application's JavaScript development server. The application points
its Tileflow source at the native manifest URL using its own development networking setup. Tileflow
does not add a Metro plugin, device discovery or a tunnel.

`preview` still binds to `127.0.0.1` by default. Existing explicit `--host <ip-or-localhost>` behavior
is preserved. Selecting another host does not add LAN discovery, a public tunnel, an iOS ATS
exception, an Android cleartext exception, or any native application mutation; the application and
developer remain responsible for making an explicitly selected development endpoint reachable
under their own platform/network policy.

Browser-only selections fail before config execution in native mode. In particular, committed
`--scene` preview and every `--against-*` comparison-workbench option are unavailable with
`--renderer native`. Native mode does not serve the browser preview root, preview JavaScript runtime,
compiler-inspection sidecars, or the dev handler's status/event control routes. Use ordinary/default
web preview for those workflows.

The `native-lowering-v1` preparation policy records fixed globe-to-Mercator normalization and
finite cap/dash layer partitioning in `native-build.json`; it does not change web artifacts.
Native preparation rejects adaptive/unknown projections, terrain, browser PMTiles/contour protocols,
missing text providers and unsupported style values rather than degrading them silently. It preserves
shared icon inheritance and independent sprite densities, and maps verified licensed TTF/OTF faces
into native style declarations. See the
[profile contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md)
and [artifact layout](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md).

## Publish web and Native together

The pre-release source supports an explicit combined deployment against a compatible Hosted API.
This is a wire and implementation contract, not a statement that a package or server release is
available. The API must understand renderer-collection deployment schema 2.

```sh
npx tileflow deploy --with-native --map-id map_0123456789abcdef --map stores
```

`--map-id` selects the existing managed Tileflow Map. `--map` selects one map from the repository;
it can be omitted only when the config contains one map. The command uses the ordinary deployment
credential or account capability, not the publishable mobile credential. Do not put privileged
credentials in mobile application configuration.

Before authentication, upload or publication, the command loads the trusted config once, prepares
its icon closure, compiles all web themes and lowers all Native themes from that same compiled
input. It validates profile `native-v1`, hashes, authored identity, source ownership declarations,
semantic POI provenance and overlay boundaries. Native incompatibility rejects the entire request;
it cannot publish a new web family alone. Existing Hosted restrictions still apply, including the
current rejection of package-owned web font bundles. This opt-in does not bypass those restrictions;
use an explicitly configured glyph provider for this Hosted path.

Shared icon packages use the existing content-addressed upload protocol once. The command replaces
only the confirmed owned sprite URL, without reevaluating config, and sends one strict renderer
collection to `POST /v1/styles`. The server verifies both complete families and their owned resources,
stages immutable outputs, and activates them through the existing single deployment authority.
A Native staging failure does not activate the replacement web family. Retry the same input after an
interrupted response: the server's existing content identity determines reuse or a new deployment.

The successful response has its own explicit schema version 2 and identifies one managed Map and
deployment plus web and Native theme references. The CLI requires the complete matching response
before atomically replacing `--manifest`. That local file stays a strict **runtime manifest v1 for
web**, so existing bundlers do not receive unknown Native fields. The CLI separately prints the
canonical Native manifest URL. A failed request or invalid response leaves the existing local file
unchanged; an uncertain response is not proof that the server performed no publication.

Ordinary `deploy` without `--with-native` keeps its schema-1 request and response behavior. A later
web-only deployment does not inherit a Native family from an older deployment.

## Native discovery and protected resources

The canonical entry URL is on the application's configured API origin:

```text
https://api.example.test/maps/map_0123456789abcdef/native/manifest.json
```

This bounded, one-map runtime manifest is **public metadata**. It contains identity, theme names,
revisions and references, never Style JSON, credentials or grants. It is served with `no-store` only
for a coherent active Native deployment. Its GET is not a commercial completion event.

Use that URL in the existing `Map` source descriptor, keeping the authored map name in `source.map`.
The application configures its publishable mobile credential and approved API origin once, using the
[React Native application configuration contract](../../react-native/docs/native-configuration.md).
The SDK requires both the requested and final response URLs to be the exact canonical route for the
declared managed Map. The manifest's `apiUrl` must exactly equal the configured canonical API origin;
a remote document cannot create a trusted origin or choose where the credential is sent.

The credential goes only to the configured API's `POST /v1/sessions/start`. It is not sent to the
manifest, a CDN, a style URL or a redirect destination. Styles, TileJSON, tiles, sprites, glyphs and
font resources remain protected by the existing grant and resource-ownership checks.

A Native theme references `/maps/<mapId>/native/v<deploymentVersion>/<theme>.json` and requires a
revision. The server verifies that version against the active deployment and the style's stored
bytes against the revision. Before resource projection, the SDK checks the protected response URL
and its Map/theme/deployment/revision metadata. If discovery became stale, it refetches the public
manifest at most once for that selection, preserving its existing session and admission context.
Another Map, origin, mode or older deployment cannot replace that ownership. A repeated failure
enters the existing safe error/rollback path rather than mixing generations or looping indefinitely.

Session start, public metadata discovery and Map rendering do not themselves assert a billable
completion. Completion remains owned by the server's existing eligible protected GET 200/206 path.
Disabled mobile delivery fails closed; publication does not enable it.

## Qualification boundary

Native local preview is artifact preparation and delivery only. A successful artifact or deployment
response does not establish Hermes execution, iOS/Android rendering, device reachability, visual
fidelity, package publication or product availability. Qualify the exact compatible SDK/API pair,
React Native application, platform networking policy and native runtime separately.
