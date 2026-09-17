# Native artifacts and local preview

Use a project-local CLI version that includes the native artifact selector and a trusted
`tileflow.config.ts`. Follow the [installation instructions](../README.md) first. Native commands
prepare or serve Tileflow artifacts; they do not install, start or qualify a mobile renderer.

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
config or writing files. `build --target hosted` is not publication and is rejected; web Hosted
publication continues to use the existing `deploy` command. This contract adds no native Hosted
path.

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

## Qualification boundary

Native local preview is artifact preparation and delivery only. A successful session, fetched
manifest or parsed style does not establish Hermes execution, iOS/Android rendering, device
reachability, visual fidelity, Hosted support, package publication or product availability. Qualify
the exact React Native application, platform networking policy and native runtime separately.
