# tileflow

The Tileflow command-line interface: author, validate, preview, build, capture, and deploy maps.
This package exposes the `tileflow` executable only. Do not import `tileflow` as a JavaScript library;
use `@tileflow/core` or the relevant integration package instead.

## Install

Use Node.js 22 or newer. Install the CLI in your project and commit the lockfile:

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact tileflow@alpha
npx tileflow init
npx tileflow validate
npx tileflow preview
```

Run these commands from the project directory. After installation, `npx tileflow` uses the local
executable. With another package manager, use its local-execution command and the existing lockfile;
do not add a second lockfile or rely on a globally installed CLI.

`init` creates a singular `tileflow.config.ts` extending the official Streets map. `preview` serves
the exported map using its configured view. `dev` is a compatibility alias for `preview`, not a
replacement for an application's normal development server.

Local validation, compilation, and asset preparation require no account or API key. Preview and
capture may fetch configured remote tiles and fonts. Config files are executable trusted code,
not a sandbox; review their imports before running them.

## Validate and build

```sh
npx tileflow validate --json
npx tileflow validate --target hosted --json
npx tileflow build --out public/tileflow
```

The default build directory is `dist/tileflow`. A build writes a runtime manifest, concrete-theme
styles, and referenced prepared sprite/font assets. Serve the complete output, not just a style
file. A framework component defaults to `/tileflow/manifest.json`; set its `manifestUrl` explicitly
when your application's public path differs.

`build` is local. Hosted compatibility is a separate preflight: hosted deployment requires Tileflow
World and currently rejects local/package font bundles. Production builds reject unresolved local
PMTiles inputs rather than silently copying or publishing user datasets. Publish managed data
explicitly or supply an application-owned production source.

To work on another map, use `--config <path>`. An ordinary config exports one map. Multi-map
workspaces are advanced repository orchestration, not a second application authoring model.

## Discover the language and inspect a change

Agents should read generated contracts instead of guessing property names, expression syntax, or
compiler-generated layer IDs:

```sh
npx tileflow language manifest --json
npx tileflow language schema --json
npx tileflow inspect --json
npx tileflow explain --theme dark --json
npx tileflow semantic-diff --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
```

The language commands need no project and perform no network access. `language manifest` returns
the raw authoring manifest (schema version 2); `language schema` returns the raw generated config
reference (version 4). Use their versions and schema references when consuming the output.

`validate`, `inspect`, `explain`, and `semantic-diff` return one version-1 command envelope on
stdout. JSON-mode failures leave stdout empty, write one structured failure to stderr, and exit
nonzero. Diagnostics include `phase`, `code`, `path`, `severity`, `message`, and `suggestion`.
A non-empty semantic diff is informational, not a command failure.

Inspection includes resolved inheritance, merge provenance, and the theme contract. `explain`
returns compilation diagnostics and a report, not the complete Style JSON. Add `--inspection` only
when physical output provenance is needed; those layer IDs are not stable authoring targets.

For a normal config, map selection is implicit. Paired `--from-config` and `--to-config` compare
two ordinary configs. Workspace comparisons use their documented explicit map selectors; do not
mix the paired-config and same-workspace forms.

## Preview and compare

`preview` binds to `127.0.0.1` by default. `--host` explicitly accepts an IP literal or `localhost`;
it does not implicitly expose a public listener. `--theme <name>` selects a concrete theme.
`--scene <name>` selects a committed standalone scene.

Compare two configs in the live workbench:

```sh
npx tileflow preview --config candidate/tileflow.config.ts --against-config reference/tileflow.config.ts
```

The workbench shares a camera across side-by-side, split, overlay, or blink views. Its inspector
shows bounded feature and compiler information; invalid edits keep the last valid generation.
Use headless capture, not the live viewport, when exact dimensions and device-pixel ratio matter.

`--api-base-url` or `TILEFLOW_API_URL` changes the API origin used by the official preview sources.
It does not change the map's authored data ownership or publish any data.

## Capture a reproducible scene

Add a concrete-theme scene to `tileflow.config.ts`:

<!-- docs:check -->

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  version: 1,
  extends: streets,
  scenes: {
    'madrid-desktop': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
  },
});
```

```sh
npx tileflow capture madrid-desktop --json
```

The first capture may install Playwright's exact pinned Chromium headless shell. `tileflow setup
capture` provisions it ahead of time; a system Chrome installation is not a substitute. Scenes
belong to their map and do not inherit. `system` and an omitted scene theme are invalid.
Coordinates are `[longitude, latitude]`; viewport dimensions are CSS pixels and `dpr` determines
physical image size.

One-off capture accepts camera, size, and theme flags and returns a normalized scene definition.
Commit that definition deliberately; the CLI does not rewrite executable config. Capture receipts
record runtime and data identity. Remote dependencies can change, so a successful render is not a
promise of identical pixels on every platform or future run.

For application capture, define an application target with its route and optional `captureId` in
the scene. Start the application's normal server in one terminal. In another terminal, run:

```sh
npx tileflow capture madrid-product --url http://127.0.0.1:3000/maps/madrid --json
```

This command assumes a committed `madrid-product` application scene and a matching Tileflow component
on that route. Capture does not start the server or discover ports. It accepts loopback HTTP(S),
selects exactly one target, verifies the concrete theme, and waits for the component's idle marker.
Do not run a separate `tileflow preview` server beside the application.

## Review pixels without accepting changes

After reviewing a render, create its baseline. Compare subsequent renders separately:

```sh
npx tileflow visual update madrid-desktop --baseline-dir test/visual-baselines --json
npx tileflow visual diff madrid-desktop --baseline-dir test/visual-baselines --fail-on changed --json
```

Only `visual update` changes baseline PNG/receipt pairs. `visual diff` writes working evidence, not
approval. Changed pixels normally exit 0; `--fail-on changed` exits 2. Missing or incompatible
baselines and operational failures exit 1. Never run `visual update` automatically to make CI pass.

Use `visual analyze <scene> --reference <png>` for an external screenshot without a Tileflow
receipt. Use `visual compare` for an authenticated two-style review with matched camera, viewport,
renderer, and data identity. Neither operation approves a baseline. Capture watch mode emits NDJSON
generation events rather than a single JSON document.

The [capture contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/local-visual-capture.md)
documents readiness, receipts, comparison limits, and CLI output formats.

## Publish data and deploy a map

Hosted writes require authorization. For local development, `login` stores a personal session;
for CI, provide an appropriately scoped key through the secret environment variable
`TILEFLOW_API_KEY`. CI does not fall back to a saved personal login. Never put a key in a config,
browser bundle, copied prompt, or command-line argument.

```sh
npx tileflow login
npx tileflow whoami --json
npx tileflow deploy --map-id map_AbCdEfGhIjKlMnOp
npx tileflow status --map-id map_AbCdEfGhIjKlMnOp
```

Replace the example Map ID with the destination created in Tileflow. It is a public identifier,
not a credential or the portable `id` in your config. A CI deploy key must authorize that destination.
`logout` removes the saved personal session.

Deploy publishes the compiled concrete-theme family and managed icon assets; it does not ask the
server to compile TypeScript. Repeating an unchanged deployment reuses its version. Build writers
refuse to overwrite hosted manifests by default, and deploy refuses to replace a self-hosted
manifest without explicit authorization. Keep separate outputs, or use the documented overwrite
option only for an intentional migration.

Data publication is separate from map deployment:

```sh
npx tileflow tileset inspect ./data/stores.pmtiles --json
npx tileflow tileset publish ./data/stores.pmtiles --id stores --team @acme --attribution 'Store data © Example' --json
npx tileflow tileset status stores --team @acme --json
```

Use your own file, Team selector, and attribution. Inspection is account-free. Publication validates
and uploads a managed dataset using Team data authority, not a map-only deploy key. Interrupted
uploads are resumable; a completed version becomes current at stable delivery URLs. Purge is
explicit, requires confirmation, and can be blocked by retained deployment dependencies.

`inspect features` samples bounded vector-source features. `icons list` and `icons diff` inspect
prepared icon identities; they do not turn package directories into a separate hosted library.
Use the installed command's help for exact arguments and supported JSON output.

## Local coordinate commands

`setup coordinates` and `coordinates search|describe|operations|transform` require a compatible,
explicitly provided native distribution. Installing this CLI does not provide native engine,
catalog, or grid assets, and no public native runtime download is currently offered. There is no
hosted fallback. See the
[local runtime guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/coordinates-runtime/README.md)
for the verified platform, setup, and development-artifact restrictions.

## Reference and troubleshooting

Run `npx tileflow --help` or `npx tileflow <command> --help` for the installed command surface.
The families cover map authoring, semantic language discovery, local visual evidence, datasets and
icons, account sessions, coordinates, and hosted delivery. Hidden compatibility commands are not a
recommended application workflow.

A manifest 404 usually means assets were not built/served at the component's configured URL.
Missing fonts or sprites require the complete prepared output. Hosted compatibility failures should
be fixed before authentication or upload, not bypassed with repeated deployment attempts.

See [deployment documentation](https://tileflow.dev/docs/deploy),
[SDK responsibility boundaries](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/sdk-responsibilities.md),
and [issues](https://github.com/tileflow/tileflow-sdk/issues). Source `main` may be newer than npm;
use the installed CLI's help and generated contracts for that release.
