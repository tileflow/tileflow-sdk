# tileflow

The Tileflow command-line interface: author, validate, preview, build, capture, and deploy maps.
This package exposes the `tileflow` executable only. Do not import `tileflow` as a JavaScript library;
use `@tileflow/core` or the relevant integration package instead.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

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

`init` creates a singular `tileflow.config.ts` extending the official Streets map. `preview` opens
Map DevTools with that map, live reload, rendered-feature inspection, compiler attribution, zoom
curves, a sprite atlas, scene selection, saved captures, and before/after review.

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

## Map development tools

Use `describe` for bounded language discovery (`describe themes --json` lists palette requirements
and optional time-of-day composition), `inspect` for configuration and data, `capture`
for reproducible evidence, and `compare` for saved captures, semantic edits, styles, references or
baselines. `preview` opens Map DevTools. These tools work in independent projects with
custom maps and data; official maps are optional.

See the [map authoring workflow](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/map-authoring.md)
for command examples, bounded JSON queries, compatible aliases and efficient agent workflows.

## Preview and compare

`preview` binds to `127.0.0.1` by default. `--host` explicitly accepts an IP literal or `localhost`;
it does not implicitly expose a public listener. `--theme <name>` selects a concrete theme.
`--scene <name>` selects a committed standalone scene.

Run `npx tileflow preview` from your project directory to load `tileflow.config.ts`, start the
watched server, and automatically open Map DevTools in your default browser once the server is
listening. Use `--config <path>` for another config or `--no-open` to start without opening a tab.
`--json` and `--renderer native` also keep the browser closed. The CLI always prints the local URL
in ordinary web preview output, so you can open it manually if browser launch is unavailable.

Opening Map DevTools through another loopback name, such as `localhost` instead of `127.0.0.1`,
redirects to the **Local** origin printed by the CLI, preserving camera and theme query parameters.
This keeps the map, palette controls, and workbench API on the same origin.

Run from the project directory and keep selected configs inside it, so capture commands copied from
Map DevTools resolve the same files. The project itself can live anywhere, independently of this SDK.

The default is one Map DevTools pane, one watched artifact session, and one map renderer. Choose a
map, theme or configured scene in **Controls**. Map and theme pickers appear when there are multiple choices. **Compare → Compare live maps** adds a reference from the current
project; `--against-*` also supports a reference from another config. The native renderer retains its assets-only
preview endpoint.

Compare two configs live in Map DevTools:

```sh
npx tileflow preview --config candidate/tileflow.config.ts --against-config reference/tileflow.config.ts
```

Map DevTools shares a camera across side-by-side, split, overlay, or blink views. Its inspector
shows bounded feature and compiler information; invalid edits keep the last valid generation.
**Capture as reference** saves a starting point. After editing, **Capture & compare** reuses its
camera and frame to review the change. The selected reference lasts for this browser session.

**Capture** renders the compiled map at the current camera and the fixed dimensions in **Capture settings** (the sliders icon).
Temporary preview visibility switches are excluded. **Captures** retains local evidence across
reloads; **Compare** checks saved captures before offering a before/after slider and pixel difference.
Each capture has a **Delete** action with confirmation that removes its saved image and record from this project.
It reports incompatible cameras, frames, renderers or data without presenting pixel metrics.

**Copy context for AI** exports the selected feature, semantic configuration paths, camera, revision
and reproducible commands. An agent can also read the active browser context:

```sh
npx tileflow inspect session --url http://127.0.0.1:3333 --json
```

Use the origin printed by your running preview. This reads browser observations, including their
age and stale flag; exact source lines and token ownership are not inferred. See the
[Map DevTools workflow](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/map-authoring.md#work-with-a-person-and-an-agent)
for storage and context bounds.

`--api-base-url` or `TILEFLOW_API_URL` changes the API origin used by the official preview sources.
It does not change the map's authored data ownership or publish any data.

## Capture a reproducible scene

Captures return reusable IDs. Compare two saved renders with
`tileflow compare --before <id> --after <id> --json`; no config, browser, or network is needed.
The [authoring workflow](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/map-authoring.md)
describes storage, integrity checks, mismatch outcomes and watch-session reuse.

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

## Render a timed shot

Commit a [capture shot](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/capture-shots.md)
under `shots` on the same map: a concrete theme, a viewport, and two or more center-camera
keyframes, optionally with a theme blend. Then render it:

```sh
npx tileflow capture --shot dusk-flyover --json
npx tileflow capture --shot dusk-flyover --format frames --out-dir evidence --json
```

The first command writes `.tileflow/captures/shots/dusk-flyover.webm`; the second writes
`evidence/dusk-flyover/frame-0000.png` and the following frames. Each output has a sibling
`.receipt.json` shot receipt. Repeat `--shot` or use `--all-shots` to render several shots; `--out`
names the `.webm` file or frame directory of a single shot. Every frame waits for the map to be
ready, so a slow machine renders more slowly without dropping frames.

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

## Team Icon Sets and repository locks

Two intentionally separate families cover shared icons. `icon-set` manages the remote Team catalog
with Team authority; `icons install|update|pin` maintain the repository's exact
`tileflow.icons.lock.json` beside the selected config.

```sh
npx tileflow icon-set publish ./icons --id brand --team @acme --idempotency-key brand-2026-09-14 --json
npx tileflow icon-set versions brand --team @acme --json
npx tileflow icons install --team @acme --json
npx tileflow icons pin @acme/brand --version 3 --team @acme --json
```

Use your own directory, Team selector, and retry key. `publish` compiles one local directory into
the four generated sprite files and creates an immutable integer revision; republishing identical
bytes reports `unchanged` and reuses the same revision. `list`, `status`, `versions` and `uses` are
bounded Team reads. `archive` and `unarchive` change only catalog state and never remove retained
revisions. `purge <slug> --version <n>` additionally requires `--idempotency-key`, an exact
`--confirm @team/set@version`, and `--acknowledge-unknown-locks`, because repository locks that were
never deployed are not discoverable and already-downloaded public bytes cannot be revoked.

The lock commands inspect the `iconSet()` references your config declares. They are the only
commands that resolve `latest`, and the only ones that write the lock. `install` fills in declared
references that have no pin, `update` moves selected references to their current latest revision,
and `pin` selects one exact revision. Every requested reference is resolved before a single
compare-and-swap write of the whole snapshot, so a concurrent writer fails the command instead of
losing its pins. No lock command rewrites `tileflow.config.ts`.

`validate`, `build`, `preview`, `deploy`, `icons list` and `icons diff` read the lock and never
resolve a catalog head. `--cache-dir` chooses the verified artifact cache root and `--offline` fails
a cache miss instead of hydrating it. Publishing a newer revision changes nothing in a repository
until `install`, `update` or `pin` changes its exact pin.

These commands require an account session or a Team data key carrying `icons:read` for reads and
`icons:write` for publication, archive state and purge. A Map-scoped deploy key never gains catalog
authority. Availability depends on your deployment; check the installed command's help and your
Team's enabled features.

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
icons, account sessions, coordinates, and hosted delivery. Hidden support commands are not a
recommended application workflow.

A manifest 404 usually means assets were not built/served at the component's configured URL.
Missing fonts or sprites require the complete prepared output. Hosted compatibility failures should
be fixed before authentication or upload, not bypassed with repeated deployment attempts.

See [deployment documentation](https://tileflow.dev/docs/deploy),
[SDK responsibility boundaries](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/sdk-responsibilities.md),
and [issues](https://github.com/tileflow/tileflow-sdk/issues). Source `main` may be newer than npm;
use the installed CLI's help and generated contracts for that release.

## Detailed guides

These guides are also included in the installed package under `docs/`. They describe this source
revision; prefer the installed copy when working with an older release.

- [CLI setup and defaults](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/cli-setup-and-defaults.md)
- [Build artifacts](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/build-artifacts.md)
- [Deterministic agent diagnostics](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/deterministic-agent-diagnostics.md)
- [Coordinates](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/coordinates.md)
- [Command families](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/command-families.md)
- [Local visual feedback](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/local-visual-feedback.md)
- [Inspect vector features](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/inspect-vector-features.md)
- [Hosted authentication and deploy](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/hosted-authentication-and-deploy.md)
- [Agent icon composition](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/agent-icon-composition.md)
- [Read-only icon comparison](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/docs/read-only-icon-comparison.md)

## Validate icon representations

`tileflow validate`, development and build resolve icon capabilities before returning a map.
Validation and deployment also prepare map-owned tree models before compiling styles or making
remote writes. Invalid or missing model files report a local asset error; prepared geometry travels
inside the style, including models inherited from Streets.
`TF_ICON_REPRESENTATION_MIXED` means a layer can select SDF and RGBA icons, including a fallback or
local override. Keep that selection homogeneous or use an explicit bounded mapping. Development
reports the invalid generation while retaining its last valid artifact.

Declare defaults in `tileflow.icons.json`; inspect effective appearances and text-fitting layouts with
`tileflow icons list --json`. Diff reports detect default-only changes and show rendered previews.
See [Author recolorable and adaptable icons](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-icons.md) for the source profile and halo bounds.
