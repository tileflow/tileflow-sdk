# @tileflow/cli

CLI-only tools for Tileflow config, preview, validation, capture, and hosted deploy. The package
requires Node.js 22 or newer and intentionally exposes only the `tileflow` binary; importing
`@tileflow/cli` as a JavaScript library is not a supported surface.

Local config, validation, build, preview, and hosted-compatibility checks require
no Tileflow account or API key:

```sh
npm install @tileflow/core@alpha @tileflow/maps@alpha
npm install --save-dev --save-exact @tileflow/cli@alpha
npm exec --no -- tileflow init
npm exec --no -- tileflow validate
npm exec --no -- tileflow validate --target hosted
npm exec --no -- tileflow build
npm exec --no -- tileflow preview
```

The generated config imports `streets`, extends it, materializes a custom dark theme from
`streetsThemes.dark`, and declares the starter's theme family, modules, and view. Streets already
owns its complete icon and glyph providers, so the leaf does not repeat font stacks or know a
delivery URL.

`npm exec --no --` runs the project-local CLI and fails instead of downloading
a missing package. Other package managers work; use the equivalent command for
the lockfile already owned by the project.

`tileflow preview` previews the map exported by `tileflow.config.ts` and uses its configured `view`.
Select one of that map's committed standalone scenes explicitly:

```sh
npm exec --no -- tileflow preview --scene madrid-mobile
```

To work on another map, point `--config` at another singular config. Multi-map catalogs are internal
orchestration used by this repository's workbench and are not a second public config shape.

`tileflow dev` remains a compatibility alias. The `preview` name distinguishes this SDK preview
server from an application's own `npm run dev` process.

`--api-base-url` selects the origin used by official World, Bathymetry vector, Bathymetry DEM,
Nautical, and terrain TileJSON sources in the generated preview style. In particular, a hybrid
Bathymetry map resolves `/tiles/bathymetry/tiles.json` and `/tiles/bathymetry/dem/tiles.json` from
that one origin. `TILEFLOW_API_URL` supplies the same value when the flag is omitted, which lets a
local tiles stack serve all sidecars without changing map authoring.

The preview binds only `127.0.0.1` by default. Network exposure is never implicit. To bind another
interface, pass one explicit IP literal (or `localhost`) with `--host`, for example
`tileflow preview --host 192.0.2.10`. URL-, path-, and hostname-shaped values are rejected.

A map preview accepts `--theme <concrete-name>`; omission selects its declared default. A scene
preview applies its committed concrete theme, camera, and CSS viewport dimensions. Capture remains the
authority for exact DPR and pixels. Scenes whose target is an application must be viewed through
that application's normal development server.

## Build artifacts

`tileflow build` resolves the exported map lineage, validates executable config and MapLibre
semantics, compiles its ordered package/local icon directories and selected text provider, and
writes `manifest.json`, one `styles/<map>/<theme>.json` per concrete appearance, and every referenced
sprite/font asset. The manifest records `defaultTheme`, optional `systemThemes`, and the exact theme
catalog; it never flattens a default into a second style alias. A
map with text has exactly one provider: local/package `fonts` directories or a `glyphs` descriptor
whose `fontStacks` are explicit. The default output is `dist/tileflow`; choose another directory
explicitly with `--out`:

```sh
npm exec --no -- tileflow build --out public/tileflow
```

Build is local and credential-free. Hosted compatibility is a separate
`tileflow validate --target hosted` preflight; both that command and `deploy` reject non-Tileflow
World data through the same compatibility check.

## Deterministic agent diagnostics

Use JSON mode when an agent or CI job needs to validate or reason about the resolved config:

```sh
npm exec --no -- tileflow validate --json
npm exec --no -- tileflow inspect --json
npm exec --no -- tileflow inspect --map madrid --json
npm exec --no -- tileflow language manifest --json
npm exec --no -- tileflow language schema --json
npm exec --no -- tileflow explain --map madrid --theme dark --json
npm exec --no -- tileflow semantic-diff --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
npm exec --no -- tileflow semantic-diff --config maps.workspace.ts --from before --to after --json
```

`validate`, `inspect`, `explain`, and `semantic-diff` success writes exactly one
schema-version-1 command envelope to stdout. The two discovery commands intentionally return their
contracts raw instead of wrapping them: `language manifest --json` emits authoring-manifest version
1 and `language schema --json` emits config-reference version 3. Every JSON-mode failure, including
failure to load either raw discovery contract, leaves stdout empty and writes one schema-version-1
command failure to stderr. Command summaries and every failure diagnostic contain `phase`, `code`,
`path`, `severity`, `message`, and a bounded safe `suggestion`; diagnostics are sorted and
deduplicated deterministically.

Config inspection returns the resolved map, parent-to-leaf lineage, declared paths, leaf-level merge
provenance, and an explicit `themeContract`: default/system selection, shared token schema,
concrete values, typography, lighting, differences from the default, and stable audit diagnostics.
It omits the executable input-file graph and sanitizes credentials, URL queries,
secret-shaped values, data URLs, and absolute filesystem paths. The generated
[`modules-api-reference.json`](../../docs/modules-api-reference.json) is the machine-readable
map/module schema; its default `authoring` entrypoint tells an agent how to write the singular
config with `extends` and `scenes`, while its named `resolved` entrypoint matches inspection and
compiler input. Both are produced from executable core schemas rather than a handwritten parallel
API list.

`tileflow language manifest --json` discovers the complete closed semantic language without loading
a project: compiler identity, domains and their dependencies, public operations, expression-builder
signatures and limits, render selectors, semantic fields/features, diagnostics, reports, commands,
and schema references. `tileflow language schema --json` returns the packaged generated JSON Schema
that those references address. Together they are the canonical bootstrap surface for an authoring
agent; neither command writes files or accesses the network.

Each manifest command entry declares its `outputKind`, `outputVersion`, and stable
`outputSchemaRef`. `raw-authoring-manifest` and `raw-config-reference` identify the two bootstrap
documents above; `command-envelope` identifies the ordinary version-1 CLI contract.

`tileflow explain` compiles exactly one map/theme selection through `createStyleResult()` and emits
its structured `report` and safe compiler `diagnostics`; it deliberately omits the usually large
MapLibre `style`. In a singular config, `--map` is optional; a multi-map workbench requires it.
`--theme` defaults to that map's declared default. `--inspection` adds opt-in, read-only
physical-output provenance to the report. Its physical layer IDs and indexes are diagnostic
observations only: they are not stable application or authoring targets, and no semantic operation
accepts them. The JSON document has this stable projection:

```json
{
  "schemaVersion": 1,
  "command": "explain",
  "ok": true,
  "selection": {"map": "madrid", "theme": "dark"},
  "authoringManifestSchemaVersion": 1,
  "compilation": {"ok": true, "diagnostics": [], "report": {}},
  "diagnostics": []
}
```

`tileflow semantic-diff --from-config <path> --to-config <path>` compares the sole map exported by
each ordinary config, which is the normal agent workflow for reviewing a change across two files or
checkouts. If either endpoint is a multi-map `*.workspace.ts`, select that endpoint explicitly with
`--from-map` or `--to-map`; selectors are rejected for singular configs. The existing
`--config <workspace> --from <map> --to <map>` form remains as the same-workspace shortcut. Paired
config options and workspace options cannot be mixed.

The successful document adds `diff`, whose exact core shape is `{schemaVersion, from, to, summary,
changes}`; each change is `add`, `remove`, or `change` at an RFC 6901 JSON Pointer. Differences are
informational, so a non-empty diff still exits successfully. Selection, load, validation, asset, or
compilation failures leave stdout empty and emit one safe structured document on stderr.

## Command families

| Family            | Commands                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Semantic language | `language manifest`, `language schema`                                                         |
| Map authoring     | `init`, `validate`, `inspect`, `explain`, `semantic-diff`, `build`, `preview` (`dev` alias)    |
| Local evidence    | `setup capture`, `capture`, `visual compare`, `visual analyze`, `visual diff`, `visual update` |
| Data and assets   | `inspect features`, `icons list --json`, `icons diff`                                          |
| Account           | `login`, `logout`, `whoami`                                                                    |
| Hosted delivery   | `deploy`, `status`                                                                             |

Run `tileflow <command> --help` (or the family help, such as `tileflow icons --help`) for the exact
arguments and bounded JSON modes.

The CLI retains the hidden `projects` command family as a compatibility and support surface for the
internal application boundary. It is not part of the ordinary workflow or the product catalog.

## Local visual feedback

Explore with capture itself. The first run may install Playwright's exact pinned Chromium headless
shell into its versioned per-user cache:

```sh
npm exec --no -- tileflow capture \
  --map madrid \
  --theme dark \
  --center=-3.69201,40.40871 \
  --zoom=16.15 \
  --width=1200 \
  --height=1200 \
  --json
```

The successful entry includes a normalized `definition` with its concrete `theme`, `camera`,
`viewport`, and default map `target`. Copy it under a chosen `scenes.<name>` key; the CLI never rewrites
executable TypeScript config. Then commit the bounded scene so agents and CI render the same map,
camera, and viewport:

```ts
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'madrid',
  name: 'Madrid',
  version: 1,
  extends: streets,
  scenes: {
    'madrid-desktop': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'madrid-product': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
      viewport: {width: 390, height: 844, dpr: 2},
      target: {
        kind: 'application',
        path: '/maps/madrid',
        captureId: 'product-map',
      },
    },
  },
});
```

`scenes` is tooling metadata owned by this map. It is not inherited and does not enter the
cartographic compiler; tooling supplies the exported map ID when it normalizes a scene internally.
Every scene stores a concrete theme; omission and browser-only `system` are invalid.

### Live comparison workbench

Use the ordinary preview server with a right-hand selection to compare two maps or themes while
authoring:

```sh
# Two maps or themes from one config.
npm exec --no -- tileflow preview \
  --map harad --theme light \
  --against-map ferraris --against-theme light

# Or compare against another config.
npm exec --no -- tileflow preview \
  --config ./candidate.config.ts --map candidate \
  --against-config ./reference.config.ts --against-map reference
```

Any `--against-*` option opens the comparison workbench. Both previews remain same-origin and share
one synchronized camera. The toolbar switches between side-by-side, split, opacity overlay, and
blink modes; the selected mode, camera, split, opacity, and active interaction side survive in the
URL. Each config has its own watched, last-known-good session, so an invalid edit shows bounded
diagnostics without discarding the last valid map and recovers automatically after a fix.

Enable **Inspect** and click a rendered feature to see its bounded feature data, paint/layout values,
zoom-curve samples, and compiler contribution sidecar. The sprite gallery shows the compiled atlas,
not source directories. **Copy scene** produces a concrete-theme scene for the current camera and
viewport; **Copy command** produces the corresponding capture command. The inspector sidecar exists
only in memory in this local workbench and is not emitted by `tileflow build`.

### Reproducible two-style review

For shareable evidence with exact pixels, use headless capture instead of the live preview:

```sh
npm exec --no -- tileflow visual compare \
  --config ./candidate.config.ts --map candidate --theme light \
  --against-config ./reference.config.ts --against-map reference --against-theme light \
  --center=-3.7038,40.4168 --zooms=12,14,16 \
  --width=1200 --height=800 --dpr=1 --region=0,0,1200,760 \
  --diff --open --json
```

`--against-config` is explicit and may name the same config. Both sides use one camera, viewport,
DPR, ordered zoom matrix, pinned browser session, and concrete theme. At most 16 zooms and 64 MiB
of aggregate embedded PNG data are accepted; an earlier preflight also caps the matrix at
67,108,864 aggregate physical pixels. The default transaction writes
`.tileflow/comparisons/compare.html`, a machine-readable sibling JSON document, and PNG/receipt-v4
pairs below `compare.assets`; `--diff` adds a highlighted diff when identities are comparable. The
HTML embeds every image, uses a restrictive CSP, performs no network request, and offers the same
side-by-side, wipe, overlay, and blink review modes.

`--region=x,y,width,height` selects one shared physical-pixel rectangle for compact appearance
profiles. Review JSON uses the explicit signed direction `rightMinusLeft`; the region does not crop
captures, changed-pixel metrics, or diffs.

Stdout and the sibling JSON use the same schema-version-1 `visual.compare` document: concrete
left/right selections, shared camera and viewport, zoom-sorted rows with Review v1 documents and
relative artifact paths, report/document paths, and sorted warnings. This document and the watch
NDJSON described below are versioned compatibility boundaries.

The asset directory also contains a bounded schema-version-1
`.tileflow-visual-compare.json` inventory. It assigns ownership only to the listed sibling assets
and records each exact SHA-256. A later successful transaction removes stale generated rows or
diffs only when that valid prior inventory names them, preserves unrelated files, and refuses a
managed asset that has been modified, replaced by a symlink/non-file, or grown beyond its bound.
`--force` does not weaken those ownership checks. The inventory is capped at 64 KiB and the complete
report, JSON, inventory, PNGs, receipts, stale cleanup, and optional diffs commit or roll back as one
file transaction.

Different pixels are ordinary review evidence and exit 0. A frame, dimension, runtime, or exact
data mismatch exits 1 and suppresses pixel metrics because the images are not comparable.
`--allow-data-mismatch` keeps a data-mismatch report inspectable with exit 0, but does not invent
pixel metrics. `--watch` observes both configs, cancels stale renders, preserves the last complete
report through invalid edits, and emits deterministic NDJSON with `--json`. An explicit report path
requires `--force` in watch mode; the managed default path is safely replaceable.

Watch events are `watching`, `building`, `invalid`, `recovered`, `generation-complete`, `failed`,
and `stopped`, with monotonic comparison generations and source-side generations where applicable.
Without `--allow-data-mismatch`, an incompatible generation emits `failed`, does not replace the
last complete report, and remains an unresolved failure; an allowed data mismatch emits
`generation-complete` but still has no pixel metrics. An orderly stop exits 0 only after at least
one complete generation and no unresolved invalid or failed state; otherwise it exits 1.

Render one checkpoint, or recapture after every edit:

```sh
npm exec --no -- tileflow capture madrid-desktop --json
npm exec --no -- tileflow capture --all --json
npm exec --no -- tileflow capture madrid-desktop --watch --json
```

Use the first command when you want a single image and the last command while refining a map. Watch
mode stays open, follows changes to the config, its local imports, and its effective icons and fonts,
and writes a new PNG after each valid edit. Keeping the browser ready makes repeated renders faster.
If an edit is invalid, the last good image remains in place and capture resumes automatically after
the fix. Stop watch mode with `Ctrl+C`. It accepts named committed scenes or `--all`, not exploratory
camera options.

Standalone scenes need no app server, account, API key, MCP service, system Chrome, or visible
window. The first command—or the first capture—may provision Playwright's pinned Chromium headless
shell in its versioned per-user cache. `--no-browser-install` makes a prepared/offline environment
strict. Tileflow never falls back to a system browser or packages the browser in npm.

For prepared or offline CI, install ahead of time with
`npm exec --no -- tileflow setup capture --json`. Use `setup capture --no-browser-install` or
`capture --no-browser-install` as an enforcement check that the exact shell is already cached.

For an application scene, its route and component props must render the committed camera. Tileflow
uses the camera in scene identity but does not mutate arbitrary application map state.

One-shot success JSON is one deterministic schema-version-1 document plus one newline. It contains
sorted scene/map/theme/target entries, relative output and receipt paths, image hash/dimensions/DPR,
renderer identity, remote-dependency state, and warnings; it contains no image bytes, credential,
origin, absolute path, user, or timestamp. Managed output is an atomic pair under
`.tileflow/captures/<scene>.png` and `<scene>.receipt.json`. `tileflow init` ignores managed captures
and `.tileflow/diffs` when creating a new `.gitignore`. Explicit output replacement requires
`--force`; symlinks and path escapes fail closed.

Each written receipt uses capture schema v4 and records the concrete theme. A Tileflow World
capture resolves its TileJSON once for
the whole capture session and records the exact `world-v1` release plus descriptor, archive, data
contract, and product-contract hashes. All selected scenes and retries therefore use one immutable
World release even if `current` moves while the command is running.

One-shot `--json` failures leave stdout empty and write exactly one deterministic failure document
to stderr with `code`, `phase`, bounded diagnostics, and optional origin-only resource metadata.

Watch JSON is NDJSON with monotonic `building`, `invalid`, `recovered`, `captured`, `failed`, and
`stopped` generation events. It watches config, transitive local imports, and effective icon/font
files, preserves the last good capture through invalid edits, cancels stale work, and reuses one
headless Browser. An orderly stop exits 0 only after a successful capture with no unresolved
terminal failure.

### Capture through the real application

Application scenes use the app's existing Vite, Next.js, Webpack, or custom loopback server. Start
only that normal server; Tileflow does not run a package script, scan ports, or start
`tileflow preview`:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 \
  npm exec --no -- tileflow capture madrid-product --json
```

The React, Vue, and Svelte wrappers expose `data-tileflow-map`, the resolved concrete
`data-tileflow-theme`, optional `data-tileflow-capture-id`, and
`data-tileflow-state="loading|idle|error"`. The headless client selects exactly one target, verifies
the theme, and waits for idle. Use `--url` for one explicit full loopback URL, `--selector` to
override target selection, and `--frame map|viewport` to override framing. Origins and URLs must be
credential-free loopback HTTP(S) without fragments. Each navigation uses a fresh context without a
reused profile, cookies, local storage, or service workers.

### Match a reference and protect the result

While refining a style, compare the current scene with any reference screenshot:

```sh
npm exec --no -- tileflow visual analyze madrid-desktop \
  --reference ./design-reference.png --region=0,0,1200,760 --json
```

`visual analyze` renders exactly one committed scene and writes the current image and a JSON report
under `.tileflow/analysis` by default. The report includes both images' dimensions and dominant
colors. When their physical dimensions match, it also includes exact and perceptual pixel metrics,
mean channel difference, a high-contrast `.diff.png`, and signed
`appearance.actualMinusReference` luminance, OKLab, edge-density, and local-contrast evidence. The
optional region affects only those appearance metrics. The reference PNG is never modified or
treated as a baseline.

Once the map is approved, save it as the expected baseline and use that image to catch later
regressions:

```sh
# Save the reviewed current render as the expected baseline.
npm exec --no -- tileflow visual update madrid-desktop \
  --baseline-dir test/visual-baselines --json

# Compare a fresh render without changing the baseline.
npm exec --no -- tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --json

# Or apply the operation to every committed scene.
npm exec --no -- tileflow visual diff --all \
  --baseline-dir test/visual-baselines --json

# In CI, return exit 2 when the pixels have changed.
npm exec --no -- tileflow visual diff madrid-desktop \
  --baseline-dir test/visual-baselines --fail-on changed --json
```

`visual diff` and `visual update` require either one or more positional scene names or `--all`;
those forms are mutually exclusive. `visual analyze` always accepts exactly one scene.

The baseline directory holds the reviewed expected PNG and its receipt. The files generated by a
comparison are working evidence: the current `.actual.png`, a transparent high-contrast
`.diff.png` when comparable, and a `.visual.json` report under `.tileflow/diffs` by default.
`visual diff` may replace those working files on each run, but it never changes the baseline. This
separation prevents a check from silently accepting the change it was meant to reveal.

Before comparing, `visual diff` validates the baseline PNG and receipt, including their hashes,
dimensions, runtime, and scene identity, without executing or fetching baseline metadata.
Statuses are `unchanged`, `changed`, `missing-baseline`, `scene-mismatch`, and `runtime-mismatch`.
Same-size images report exact RGBA changed pixels and an informational fixed-threshold perceptual
metric; exact inequality determines changed.

Changed pixels exit 0 by default so a person or agent can inspect the working files.
`--fail-on changed` exits 2 for CI; missing or incompatible baselines and operational failures exit

1. Run `visual update` again only after reviewing and accepting the new render. It is the only
   command that creates or changes baseline pairs, and it never stages, commits, or pushes. Remote
   tiles, glyphs, and sprites are reported because their pixels can change independently of the style.

## Inspect vector features

See which bounded source features the exported map sees near a camera before tuning taxonomy,
density, or labels:

```sh
npm exec --no -- tileflow inspect features \
  --center=-3.6927512,40.4086555 --zoom=16 \
  --layers=poi --properties=name,category,type,icon,filter_rank,size_rank --json
```

The command supports HTTP(S) TileJSON/vector sources and returns only requested properties plus
geometry summaries in stable order. Viewport, tiles, bytes, scanned/returned features, names, and
timeouts are bounded. Safe provenance includes origins, a query-free TileJSON path, and configured
source revision or `null`; credentials, URL queries, hidden properties, response bodies, and
absolute paths are omitted. It is read-only apart from executable config's own possible side
effects and removes `TILEFLOW_API_KEY` before loading config.

## Hosted authentication and deploy

Hosted writes have two independent authorization paths:

- Personal developer session: run `npm exec --no -- tileflow login` once for a
  Tileflow API origin. Login authenticates the account and selects no Map.
  Each hosted command exchanges that account session for a brief capability scoped to its
  explicit Map ID.
- CI key: create a dashboard `CI deploy` key, store it as
  `TILEFLOW_API_KEY`, and let the repository workflow deploy without a local login. The server
  binds that key to exactly one Map.

Hosted control-plane requests stay pinned to the configured HTTP(S) origin, apply a hard bounded
timeout, and stream at most 1 MiB of response data. CLI diagnostics never echo an untrusted remote
response body or bearer credential.

Inspect the account, then target the Map shown in the dashboard:

```sh
npm exec --no -- tileflow whoami --json
npm exec --no -- tileflow deploy --map-id map_AbCdEfGhIjKlMnOp
npm exec --no -- tileflow status --map-id map_AbCdEfGhIjKlMnOp
npm exec --no -- tileflow logout
```

When Tileflow gives an agent a World conversion command, keep its opaque technical destination and
conversion reference in that exact deploy action:

```sh
npm exec --no -- tileflow deploy \
  --world-conversion wcv_example1234
```

The conversion reference is neither a Map ID nor a credential. It resolves the new Map on the
server. The CLI uses the sole map exported by the selected config; if the config contains several,
add `--map <name>` to select the local map to connect. A successful server-confirmed continuation
keeps unrelated manifest entries and records only that Map's stable `mapId`, hosted theme URLs,
World `v1` generation, and fixed session usage mode. Do not add an API key or payment authority to
a copied prompt.

An explicit key or `TILEFLOW_API_KEY` never uses the saved account session. The deploy API rejects a
`--map-id` that does not match the key. Read-only hosted icon comparison validates the same binding
before loading its baseline.

The CI key grants only `styles:write` and `status:read`. It cannot upload
datasets or render images. Give it an expiration, rotate the repository secret
before it expires, and avoid non-expiring CI keys.

Detected CI never falls back to the credential saved by `tileflow login`: if
`TILEFLOW_API_KEY` is absent, deploy stops before loading config or making a
request. Once captured, the key is hidden from `process.env` and `--api-key` is removed from the
temporary `process.argv` view before the CLI imports executable `tileflow.config.ts`; both process
surfaces are restored after the protected operation. Every config-aware command uses the same
scope, including validate, build, dev/watch, capture, visual, inspect, icon inspection, and deploy.
This is defense in depth, not a sandbox; deploy only reviewed repository code on a trusted runner,
and do not pass keys through the `--api-key` command line in CI.

The [deploy documentation](https://tileflow.dev/docs/deploy) contains copyable
GitHub Actions and GitLab CI workflows. Both use `npm ci`, the committed
lockfile, and the repository-local CLI. GitHub exposes the key only to its deploy
step. GitLab variables are job-scoped, so its example validates in a keyless job
and deploys in a protected `production` job; the locked install and runner are
part of that trusted job boundary. Both serialize publications and intentionally
omit path filters because `tileflow.config.ts` can import arbitrary repository
files.

The CLI records bounded private provenance for GitHub Actions, GitLab CI,
generic CI, and local runs. These provider fields are descriptive client
reports, not OIDC attestations. Provider values can be overridden with:

```txt
TILEFLOW_DEPLOY_REPOSITORY
TILEFLOW_DEPLOY_REVISION
TILEFLOW_DEPLOY_REF
TILEFLOW_DEPLOY_RUN_ID
TILEFLOW_DEPLOY_RUN_URL
```

Invalid explicit values fail before a network write. Provider metadata that is
missing, malformed, or too long is omitted. Secrets and the complete
environment are never logged.

A separate app-build step is absent from the minimal workflows. Self-hosted build and deploy emit the same
runtime manifest version 1 shape; Hosted fields are optional identity metadata on its map/theme
entries. Filesystem build writers refuse to replace a manifest carrying Hosted metadata by default,
and deploy refuses to replace a purely local manifest. Prefer `emitBuildArtifacts: false` or
separate output paths when the app deliberately packages a deploy manifest. The explicit
`overwriteHostedManifest: true` build option and
`tileflow deploy --overwrite-self-hosted-manifest` flag authorize that destination replacement. A
retry of the same compiled theme family reuses its deployment version and prints `Unchanged`;
changed cartography prints `Published` with a new version. Allowed websites is managed separately
in Tileflow and is never read from repository config. The
fingerprint binds resource references, not the changing bytes behind referenced
glyph or sprite URLs. Every theme of one logical map publishes atomically; separate maps can still
partially succeed when no remote batch release is used.

All config, theme-style, icon, and compatibility preflight happens before the first style write. After
that boundary the current Hosted API has no batch commit across repository-internal orchestration:
one singular config can publish before a later config fails. The orchestrator then leaves the
previous local manifest untouched, reports which publications succeeded, and tells the operator to
retry; idempotent publication converges on that retry. The local manifest
writer uses a durable same-directory temporary followed by direct rename and directory sync, so
readers see either the previous or next complete manifest. Multi-file artifact writers remain
rollback-capable sets. Neither mechanism is a remote transaction or can make several API writes
all-or-none.

Deploy treats the locally compiled MapLibre Style family as one logical-map artifact. The request
contains an exact `styles[theme]` collection, per-theme canonical SHA-256 identities in the build
manifest, only bounded hosting policy that does not belong in MapLibre itself, and the exact managed
icon-package identity when the family has one. Delivery
policy is not inherited with cartographic fields. Deploy does not serialize the module
configuration, send a public `tileset` selector, or ask the hosted API to compile the map again.
Hosted publication currently requires Tileflow World; `vectorTiles()` remains available for local
builds and previews but fails deploy before any remote write. The API binds recognized
Tileflow-owned world and terrain URLs to its generated map ID. A successful response must return
exactly the submitted theme names and a hosted Style URL for each. Deploy writes strict runtime
manifest version 1 with stable theme URLs, `colorScheme`, content revision, optional font faces and
style IDs, rather than duplicating dataset configuration. No older manifest is normalized.

For a map with `icons: ['./icons']`, hosted validation compiles the local SVG/PNG/JPEG/WebP files
without a key. Ordered directories apply left to right and later exact IDs replace earlier files.
Deploy uploads the four generated sprite files before its first style write and reuses
byte-identical packages by content hash. Source icons and absolute paths remain local; generated
atlas bytes and sorted icon names are public. Each hosted package is limited to 256 icons and 8 MiB
generated bytes as a processing envelope. There is no package-count quota; physically retained
generated packages share the organization's 5/10-GB hosted-storage pool with retained PMTiles,
remain protected by deployment/library references, and otherwise enter the technical orphan grace
before deletion. Upload success must confirm the submitted `contentHash`, exact icon count, exact
generated byte total, one opaque `icp_<id>`, and the corresponding query-free
`/sprites/<id>/sprite` URL. The CLI rejects any missing or divergent field before using that URL.

Hosted deploy currently rejects local or package-owned web fonts before authentication or remote
writes. Use self-hosted delivery or an explicit public glyph provider. Enabling managed font bundles
requires a separately deployed ownership, quota, retention, and immutable-delivery contract.

For both managed resource kinds, `assetSetSha256` remains a separate per-map output identity. It
hashes each generated file's exact portable name, media type, byte count, and SHA-256 using Core's
asset-set v1 contract; it does not hash only the icon-package manifest. Hosted must
confirm the immutable resource bytes, reconstruct those same per-file identities (including the
`icons/<mapId>/` prefix), and reject the Style when the submitted build-manifest hash diverges.

## Agent icon composition

List the effective local catalog used by the exported map:

```sh
npm exec --no -- tileflow icons list --json
```

The successful stdout contract is one deterministic JSON document followed by exactly one newline.
Its top-level fields, in order, are `schemaVersion: 2`, `pathBase: "cwd"`, and `maps`.
Schema version 2 is a compatibility boundary: removing or renaming a field or changing an enum's
meaning requires a new schema version. Additive optional fields require corresponding documentation
and tests.

Each sorted map entry has one `id` and an `icons` value. `icons.kind` is `none` for `icons: []`, or
`directories` for a prepared ordered composition. A directory entry contains:

- `directories`, in the exact left-to-right authoring order, using config-relative paths or safe
  `npm:<package>/<path>` descriptors;
- `finalIds`, the sorted canonical lower-kebab IDs in the resulting sprite;
- `replacements`, with the replaced path and winning path for every later exact-ID replacement;
- `sources`, with the winning ID, cwd-relative path, format, byte length, and intrinsic dimensions;
- `insideWorkingTree`; and
- the deterministic generated `packageHash`.

There is deliberately no parallel catalog registry, provider kind, semantic mapping, external
sprite branch, or arbitrary source-to-runtime renaming. `<id>.<ext>` publishes `<id>` and the
reserved pattern form `<id>.pattern.<ext>` also publishes `<id>`. This lets an
agent answer “which directory wins this icon?” directly from one map record without reconstructing
hidden provider state. Use `--map <id>` to select one exact map when internal orchestration supplies
more than one.

All reported paths are relative to the invocation working directory. A source outside that tree
uses `../` and `insideWorkingTree: false`; no absolute path is emitted. Listing follows local
authoring semantics. Run `npm exec --no -- tileflow validate --target hosted` separately before a
hosted deploy to check containment, portable IDs, SVG safety, and hosted limits.

The Tileflow command performs no authentication, network request, browser/server launch, or file
write. It removes an ambient `TILEFLOW_API_KEY` before importing config. As with every config-aware
command, loading `tileflow.config.ts` executes repository code and is not a sandbox; side effects in
that code remain the repository's responsibility. Success emits no ANSI or progress prose. Usage,
config, source, decode, and render failures exit 1, write diagnostics to stderr, and leave stdout
empty.

The output contains no source contents or source hash, rendered cells, atlas coordinates,
image/base64 payload, credential, timestamp, random value, or absolute path. Open a reported local
source path with normal repository tools only when the pixels themselves are needed.

## Read-only icon comparison

Compare the exported map with its active hosted revision before deciding whether to deploy:

```sh
npm exec --no -- tileflow icons diff --map-id map_AbCdEfGhIjKlMnOp --against production
npm exec --no -- tileflow icons diff --map-id map_AbCdEfGhIjKlMnOp --against production --json
npm exec --no -- tileflow icons diff --map-id map_AbCdEfGhIjKlMnOp --against production --report ./icon-diff.html
```

The command compiles only the exported map, performs authenticated read-only control-plane
requests, and never uploads a package, creates a deployment, or writes the frontend manifest.
Plain and JSON modes create no files. A requested HTML report adds reads of the baseline's four
public sprite files and
embeds verified old/new images in one self-contained file. The report groups exact-cell icon
previews under `Added`, `Modified`, and `Removed`. Added and removed cards show only the affected
icon; modified cards compare `Before` with `Next`. A script-free 1x/2x selector defaults to 2x,
switches the embedded density, and renders 1x at half the 2x preview size inside a stable frame so
the selected state is immediately visible. Package hashes, generated sizes, and icon counts stay in
collapsed `Details`. A map badge is shown only for a map-scoped report. It exposes no atlas
implementation UI and contains no API key, remote runtime dependency, original icon source, or
local source path. Use `--force` to replace different existing report bytes and `--open` only
together with `--report`.

Visual modification means that normalized rendered RGBA pixels changed at 1x or 2x. Fully
transparent RGB is ignored. The manifest also hashes the four encoded artifacts, so an artifact can
change while its per-icon pixel list remains unchanged. The report and digest analysis operate on
generated sprite data; SVG, raster source files, and absolute paths stay on the local machine.

`--json` writes exactly one deterministic schema-version-1 document plus a trailing newline. Its
stable top-level fields, in order, are:

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "baseline": {"deploymentId": "dep_...", "package": null, "version": 7},
  "proposed": {"package": null},
  "icons": {"added": [], "removed": [], "modified": [], "unchangedCount": 0},
  "generatedBytes": {"before": 0, "after": 0, "delta": 0},
  "artifacts": {"report": null},
  "hasChanges": false
}
```

Package summaries, when present, contain `contentHash`, `iconCount`, `label`, and `totalBytes`.
A missing hosted baseline is an initial comparison against an empty package. The command compares
only delivered icon pixels, canonical package manifests, and generated bytes; config-directory
provenance and style-reference analysis belong to `icons list` and final style validation.

Normal differences exit 0. Config, compilation, credential, network, response, and report errors
exit 1.

This workflow does not provide OIDC, automatic secret installation, an official
GitHub Action, an atomic multi-map deploy set, or a Tileflow-hosted remote
builder.

Docs: https://tileflow.dev/docs/deploy
