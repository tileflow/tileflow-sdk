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
runtime manifest, a separate schema-3 `native-build.json` record and a family document per map
(`families/<map>.json`). Serve the complete renderer directory, not just the style. A failed compatibility check leaves existing output unchanged.

Both commands accept `--renderer web|native`; omission means `web`. Renderer selection is separate
from `--target local|hosted`. Existing `validate --target hosted` continues to perform web Hosted
preflight. Native with `--target hosted` fails with `NATIVE_RENDERER_UNSUPPORTED` before loading the
config or writing files. `build --target hosted` is not publication and is rejected. Hosted
`deploy`, below, performs its own complete two-renderer preflight.

JSON success uses the existing version-1 command envelope. Native results additionally identify
`renderer: 'native'`, `profile: 'native-v1'` and `validation: 'static-artifacts'`. JSON failure writes
one structured envelope to stderr, leaves stdout empty and exits nonzero. Native diagnostics have
safe JSON Pointers, stable codes, severity and suggestions. Unknown renderer names are not echoed.
The ordinary web commands and their default artifact bytes retain their existing behavior.

## Watch and serve native artifacts

`preview` selects the renderer with `--renderer`:

```sh
npx tileflow preview --renderer native --map stores --theme light
```

Native mode creates the existing watched artifact session with renderer `native`. It keeps the
last-known-good native artifact family when a watched generation becomes invalid and replaces it
only after a later valid generation is prepared. The endpoint is an **assets-only** development
endpoint: it does not render a browser map, open Inspector, start Metro, launch a device,
or establish visual/native acceptance.

With the default host and port, the canonical runtime manifest is:

```text
http://127.0.0.1:3333/native/manifest.json
```

The manifest remains the ordinary strict version-1 Tileflow runtime manifest. Its style, sprite,
font, tileset and generation references use the existing renderer-specific `/native/...` paths; no
preview-only manifest schema is introduced. `--map` and `--theme` validate a desired map/theme
against that finalized manifest but do not narrow or fork the served artifact family.

Locally built sprites and fonts are served from the preview's own HTTP origin. Native preview checks
each generation with that exact origin as its development origin, the same exception the application
configures below. Resources on any other origin still require HTTPS. `validate` and `build` never
apply this exception.

Human output identifies the exact manifest URL, profile `native-v1`, and `assets-only` endpoint.
Native NDJSON lifecycle events additionally carry `renderer`, `profile`, `manifest` and
`assetsOnly`; the default and explicit `--renderer web` lifecycle/output contract remains the
existing browser-preview contract.

Metro remains the React Native application's JavaScript development server. The application points
its Tileflow source at the native manifest URL and sets `source.developmentOrigin` to its exact HTTP
origin, for example `http://127.0.0.1:3333`. Both addresses must be reachable from the target device;
an Android emulator may use a different host address. Other resource origins still require HTTPS.
The application supplies its own development networking setup. Tileflow
does not add a Metro plugin, device discovery or a tunnel.

`preview` still binds to `127.0.0.1` by default. Existing explicit `--host <ip-or-localhost>` behavior
is preserved. Selecting another host does not add LAN discovery, a public tunnel, an iOS ATS
exception, an Android cleartext exception, or any native application mutation; the application and
developer remain responsible for making an explicitly selected development endpoint reachable
under their own platform/network policy.

Browser-only selections fail before config execution in native mode. In particular, committed
`--scene` preview and every `--against-*` live-comparison option are unavailable with
`--renderer native`. Native mode does not serve the browser preview root, preview JavaScript runtime,
compiler-inspection sidecars, or the dev handler's status/event control routes. Use ordinary/default
web preview for those workflows.

The `native-lowering-v2` preparation policy records fixed globe-to-Mercator normalization, removal
of a browser sky, finite cap/dash layer partitioning and every degradation in `native-build.json`;
it does not change web artifacts. Native maps leave out or replace what MapLibre Native cannot draw
(browser contours, the 3D scene except building extrusions, terrain displacement, relief
resampling), and each style lists those changes in `metadata['tileflow:nativeDegradations']`.
Degradations are information and never block a map. Native preparation still
rejects adaptive/unknown projections, browser PMTiles protocols, missing text providers and other
unsupported style values. See the
[native style artifact contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/native-style-artifact.md)
for the degradation vocabulary and the family document. It preserves
shared icon inheritance and independent sprite densities, and maps verified licensed TTF/OTF faces
into native style declarations. See the
[profile contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md)
and [artifact layout](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md).

## Publish to Hosted for web and native apps

Every Hosted deploy publishes both renderer families of the map: the web styles and the native
styles MapLibre Native draws on iOS and Android, with the map's family document. There is no
separate flag. This describes the protocol the CLI implements against a compatible Hosted API; it
is not a statement that a package or server release is available.

```sh
npx tileflow deploy --map-id map_0123456789abcdef --map stores
```

`--map-id` selects the managed Tileflow Map; without it, `deploy` creates one first. `--map`
selects one map from the repository and can be omitted only when the config contains one map. The
command uses the ordinary deployment credential or account capability, not the publishable mobile
credential. Do not put privileged credentials in mobile application configuration.

Before authentication, upload or publication, the command loads the trusted config once, prepares
the map's icons, fonts and models, compiles every web theme and prepares every native theme from
that same compiled input. It validates profile `native-v1`, hashes, authored identity, source
ownership declarations, semantic POI provenance and overlay boundaries, and computes the family
document. Native preparation leaves out what MapLibre Native cannot draw and records it; a map
always publishes, and the command ends with a short list of what native apps draw differently
(for example the 3D building scene drawn as plain extrusions, or browser contours left out).
Only a theme that cannot be prepared at all, such as one whose glyphs are not served over HTTPS,
stops the deploy, with its diagnostics.

A map's own fonts travel as a Hosted font bundle that both families use: web styles load the faces
in the browser and native styles name the same files in `font-faces`. A map that places Team 3D
building models publishes both families too: its native styles leave the models out and record
it, and the response reports each placed model's published version.

Icon packages and font bundles are uploaded once, by content. The command then binds the compiled
styles to the confirmed sprite and font addresses, without evaluating the config again, and
publishes in several bounded requests:

1. `POST /v1/styles` carries the web family and an index of the native documents (deployment
   schema 3). The server reserves a deployment and answers `202` with the documents it still
   lacks.
2. Each native theme style, then the family document, is uploaded with `PUT` to the address the
   server named, as the exact canonical JSON the index describes.
3. The same `POST /v1/styles` activates the deployment once every document has arrived; the
   server checks each native style against its web theme before it publishes either family.

Every request is sent gzip-encoded. The decoded web request may hold 16 MiB, each native document
8 MiB and all native documents together 32 MiB; a map over a budget fails before any upload. The
output reports each step:

```text
i Publishing stores for web and native apps (12 themes, 6.4 MB web request).
i Reserved v8; uploading 13 native documents (11.6 MB).
  ✓ Native style dark 712.2 KB, 1/13
  …
  ✓ Family document 3.4 MB, 13/13
i Activating v8.
✓ Published stores (v8) for web and native apps.
! Native apps draw stores without some web features:
    3D building scene: drawn as plain building extrusions
    Sky, atmosphere and fog: not drawn
```

Uploads are create-only and the reservation follows the deployment's content, so an interrupted
deploy is resumed by running the same command again: the server lists only the documents still
missing (`Resuming v8: 4 of 13 native documents left to upload`). Repeating a deploy that already
published reports it as unchanged without uploading anything. A failed request or invalid response
leaves the local manifest unchanged; an uncertain response is not proof that the server performed
no publication.

The successful response (schema 3) identifies one managed Map and deployment, the web and native
theme references, and the native family document's address and revision. The CLI requires the
complete matching response before atomically replacing `--manifest`. That local file stays a strict
**runtime manifest for web**, so existing bundlers do not receive native fields. The CLI separately
prints the canonical native manifest URL.

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
