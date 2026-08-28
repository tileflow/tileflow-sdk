# Local visual capture contract

Status: public alpha contract as of 2026-08-27.

This document owns Tileflow's repository-local scene, headless-browser, capture receipt, application
readiness, watch, and visual-baseline behavior. The CLI is the recommended user and agent surface;
`@tileflow/core`, `@tileflow/dev`, and `@tileflow/capture` expose the same primitives to Node tools.

## Scope and trust boundary

Local capture does not require a Tileflow account, API key, hosted control-plane request, MCP
server, system Chrome, or visible browser. Standalone scenes also require no HTTP server. Tileflow
loads `tileflow.config.ts` and its imports as executable repository code, so the repository remains
trusted code rather than a sandbox.

The renderer is the Chromium headless shell pinned by the installed Playwright version. Tileflow
always launches it headlessly and never falls back to a system browser. The first capture may run
Playwright's fixed-argument installer and put the exact platform shell in Playwright's versioned
per-user cache. `tileflow setup capture` makes that provisioning explicit;
use it to pay installation cost in advance or verify prepared/offline CI. `--no-browser-install`
is the enforcement mode and fails if the matching shell is absent. Normal capture installs the
shell automatically. Tileflow neither embeds the shell in its npm tarball nor deletes Playwright's
shared cache.

Chromium receives a bounded non-secret environment allowlist. Browser installation additionally
accepts upper- or lower-case proxy settings, certificate settings, and Playwright's explicit
browser-cache/download settings. Tileflow removes an ambient `TILEFLOW_API_KEY` before importing
config in capture and visual CLI workflows.

## Versioned scenes

`TileflowMap.scenes` is optional tooling metadata on the singular map exported by
`tileflow.config.ts`. It does not inherit and is removed before cartographic compilation. Existing
maps without scenes compile unchanged, and scenes do not alter generated style or manifest identity.
A committed scene has this version-1 shape:

```ts
type TileflowMapScene = {
  theme: string; // concrete; never "system"
  camera:
    | {
        type: 'center';
        center: [number, number];
        zoom: number;
        bearing?: number;
        pitch?: number;
      }
    | {
        type: 'bounds';
        bounds: [number, number, number, number];
        padding?: number;
        bearing?: number;
        pitch?: number;
      };
  viewport: {width: number; height: number; dpr?: 1 | 2};
  target?:
    | {kind: 'map'}
    | {
        kind: 'application';
        path: string;
        captureId?: string;
        selector?: string;
        frame?: 'map' | 'viewport';
      };
};
```

For example:

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

The owning map is implicit; Node tooling supplies its ID when it normalizes the scene internally.
The theme is mandatory and concrete. A committed visual cannot depend on an ambient browser
preference or a future change to the map's default; `system` and an omitted theme are rejected.
Scene names are strict own properties and bounded ASCII artifact names, must be distinct under case
folding, and cannot be a Windows device filename or `__proto__`; config records must be plain objects. Viewport sides are
64–4096 CSS pixels, DPR is 1 or 2, and the physical image budget is 16,777,216 pixels. Center,
bounds, zoom, bearing, pitch, padding, application path, and selector values are bounded and
validated at their config path. Application paths are root-relative and cannot carry an origin,
credentials, fragment, control character, or backslash. `captureId` and `selector` are mutually
exclusive. Defaults are DPR 1, zero bearing, zero pitch, zero bounds padding, map target, and map
framing.

Committed scenes are the reproducible surface for capture, watch, and visual baselines. One-off
camera/viewport options are exploratory and do not create a scene or baseline; exploratory
`--map` capture requires `--theme <concrete-name>`. A
successful exploratory `--json` entry adds `definition`, the exact normalized scene containing only
`theme`, `camera`, `viewport`, and the default `{kind: "map"}` target. An agent may copy that value
under a chosen `scenes.<name>` key. Tileflow does not rewrite executable TypeScript config.

## Standalone and application modes

A standalone scene compiles the owning map into one artifact snapshot through `@tileflow/dev`, injects the
installed MapLibre JS and CSS into a fresh browser context, fulfills generated local sprite assets
from memory under a closed synthetic origin, applies the camera, waits for MapLibre `load` and
`idle`, waits two animation frames, and captures the map. Multiple scenes and warm watch use one
Browser with a fresh context per scene. No Node listener, user profile, visible window, or public
CDN runtime is created.

Non-loopback HTTP(S) resources make a receipt network-dependent and produce sorted origin-only
warnings. Loopback direct-tile, TileJSON, sprite, and glyph fixtures remain local dependencies and do not
set `networkDependent`; this keeps repository-owned browser tests and release smoke deterministic
without weakening warnings for public or private remote origins.

An application scene composes its committed path with an explicit loopback
`--app-origin`/`TILEFLOW_APP_ORIGIN`. `--url` is a one-off full loopback URL override. Origins and
URLs must use HTTP(S), resolve to localhost or a loopback address, omit credentials and fragments,
and remain bounded. Tileflow does not start the application, scan ports, or start
`tileflow preview`.
The application's normal Vite, Next.js, Webpack, or custom server is therefore the only server:

```sh
npm run dev
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 npm exec --no -- tileflow capture app-desktop
```

Each navigation uses a fresh context with no reused cookies, local storage, user profile, or
service workers. Tileflow selects exactly one target by `captureId`, then an explicit selector, or
the exported map ID. A `map` frame captures the selected element; `viewport` captures the page
viewport. Zero or multiple matches, navigation failure, application console/page errors, an error
readiness marker, and timeout fail closed without echoing DOM contents or URL queries. Main-frame
redirects must remain on the exact approved origin, and the bounded credential/fragment-free URL
plus target readiness are checked again after screenshot production. An explicit unmarked selector
may be captured once visible; Tileflow-owned map targets must remain `idle`.

Standalone capture applies the committed camera itself. Application capture deliberately does not
reach into an arbitrary framework component to rewrite its camera: the selected application route
and props must render the committed camera. The camera remains part of scene identity, so changing
it invalidates baseline compatibility even when an application accidentally renders the same
pixels. The same trust boundary applies to the configured style and data: standalone receipts mark
both as `rendered`, while application receipts mark both as `expected-unverified`. An application
receipt identifies the configuration expected by the scene, but does not claim that Tileflow
inspected the running application's MapLibre style or data source.

## DOM readiness protocol

The React `Map`, Vue `TileflowMap`, and Svelte `TileflowMap` roots expose equivalent attributes:

```txt
data-tileflow-map="<exported map id when known>"
data-tileflow-theme="<resolved concrete theme>"
data-tileflow-capture-id="<optional explicit captureId>"
data-tileflow-state="loading|idle|error"
```

`captureId` is additive and optional. Interactive maps start at `loading`, return to it when style
or data work resumes, and become `idle` only after the applicable MapLibre idle event plus two
animation frames. A terminal load failure produces `error`. Image mode becomes idle only after the
image decodes, including an already-cached image during hydration, or after its successful load
fallback. The wrappers update or remove the attributes during prop changes, teardown, and
recreation without changing existing classes, callbacks, analytics, or native MapLibre options.

## Capture output and watch

One-shot capture writes an atomic PNG/receipt pair. Managed output defaults to
`.tileflow/captures/<scene>.png` and `<scene>.receipt.json`; `tileflow init` ignores managed captures
and diffs in a new `.gitignore`. Explicit output replacement requires `--force`, and symlink or
path-escape targets are rejected. JSON mode writes one deterministic schema-version-1 document and
one newline, with sorted entries and paths relative to the invocation directory. Failures write
sanitized diagnostics to stderr, leave JSON stdout empty, and preserve an existing pair. With
`--json`, a one-shot failure is exactly one stderr document and newline with top-level `code` and
`phase`, at most 32 sorted bounded diagnostics, and an optional sorted `resources` array capped at
eight entries. Resource entries contain only kind, sanitized origin, optional HTTP status, and safe
bounded context such as a font stack; they never contain credentials, query strings, response
bodies, signed paths, or DOM contents.

Static semantic rejection uses `STYLE_INVALID` and `style-validation`. Runtime phases are
`browser-start`, `resource-load`, `map-load`, `map-idle`, and `screenshot`. Resource HTTP failures
use `RESOURCE_FAILED`; MapLibre event failures use `MAP_LOAD_FAILED`; load and idle timeouts both
use `CAPTURE_TIMEOUT` with their distinct phase; screenshot API failure uses `SCREENSHOT_FAILED`;
and invalid PNG bytes/dimensions retain `INVALID_PNG` with the screenshot phase. Existing error
codes remain accepted for compatibility.

`tileflow capture --watch` keeps one warm Browser and a shared watched artifact session. It watches
the config, transitive local TypeScript/JavaScript/JSON imports, and effective icon and font sources.
Its NDJSON stream uses `building`, `invalid`, `recovered`, `captured`, `failed`, and `stopped`
events with monotonic generations. Invalid edits retain the last good artifact and capture; a
repaired generation recovers and captures. The initial session is not exposed until its watcher is ready;
new generations abort stale capture work, and only the latest ready generation may replace managed
output. `invalid` and `failed` events add bounded optional `code` and `phase` fields at the event and
diagnostic levels; failed resource events may add the same safe `resources` array as one-shot JSON.
SIGINT/SIGTERM closes the watcher, contexts, browser, and any explicitly started standalone preview
server.

New receipts are canonical schema-version-4 JSON and contain only concrete theme plus
scene/map/target identity, normalized
scene and style hashes, PNG hash and CSS/physical dimensions, Tileflow/MapLibre/Playwright/Chromium
identity, OS/architecture class, DPR, required resolved `data` identity, explicit `verification`,
and `networkDependent`. The durable receipt data type is owned and versioned by `@tileflow/capture`;
it is not an alias of the evolving core authoring type.

For external vector tiles, `data` records the provider kind, optional explicit revision, OpenMapTiles
schema/version, stable primary source ID, optional schema bindings/capabilities, and an optional safe
source fingerprint.
The fingerprint contains only a source class plus SHA-256. Its input removes query and fragment;
loopback sources also discard host and port. A raw URL, origin, path, query, signed token, or
credential is never written by a new receipt. This identity participates in scene compatibility.
Receipts also omit time, user, repository, absolute filesystem path, environment, source pixels,
and config source.

Canonical schema-v2 and schema-v3 receipts remain readable as historical evidence and are never
reclassified as schema v4. Schema-v2 receipts predate source fingerprints, `verification`, and the
bathymetry capability; parsing first validates their exact canonical legacy representation, then
normalizes a legacy URL to the safe fingerprint and infers verification from the target. Schema-v3
receipts already carry the safe data identity but predate the mandatory concrete scene theme. A
three-capability baseline remains compatible when a fresh receipt adds bathymetry or new binding
keys, provided every identity value recorded by the baseline still agrees. Conflicting recorded
values remain a scene mismatch. Serializing a parsed legacy receipt writes only the normalized safe
shape; it never reproduces a v2 raw URL. Receipt parsing remains exact-key, UTF-8, size,
portable-identifier, hash, dimension, and pixel-budget validated; parser-dependent duplicate keys
are rejected.

Schema-v4 World data is always exact. Capture resolves a logical current or exact TileJSON selector
once for the lifetime of its session. The TileJSON must return one immutable tile template and the
strict `tileflow.world` identity: `product: "world-v1"`, `releaseId`, `descriptorSha256`,
`archiveSha256`, `dataContractSha256`, and `contractSha256`. Capture cross-checks the release and
descriptor against the tile template, rewrites every standalone scene to that exact template, and
reuses the same result for retries. It never derives these identifiers from a mutable URL. A second
selector or a missing/conflicting identity fails closed. Schema-v2 `generation` and `revision`
remain legacy baseline fields only and are not confused with the v3 contract.

## Visual comparison and baselines

Two deliberate Tileflow renders can be compared without pretending either one is an approved
baseline. The live authoring surface is `tileflow preview` with any `--against-*` selection. It
mounts two same-origin preview handlers with independent watched sessions, synchronizes their
camera, persists workbench state in the URL, and provides side-by-side, split, opacity-overlay, and
blink views. An invalid edit retains that side's last valid artifacts and exposes only bounded
diagnostics until it recovers. The opt-in compiler sidecar, rendered-feature inspector, zoom-curve
samples, compiled sprite atlas, and scene/capture-command copy helpers are local diagnostics; the
sidecar is never a build artifact or runtime manifest field.

Durable review evidence uses an exact headless capture matrix:

```sh
npm exec --no -- tileflow visual compare \
  --config ./candidate.config.ts --map candidate --theme light \
  --against-config ./reference.config.ts --against-map reference --against-theme light \
  --center=-3.7038,40.4168 --zooms=12,14,16 \
  --region=0,0,1200,760 --diff --json
```

The command accepts one to 16 unique sorted zooms. Both sides share center, bearing, pitch,
viewport, DPR, pinned browser session, and one resolved data snapshot per capture session. Each side
has a concrete theme and produces a schema-v4 receipt. The default rollback-capable transaction
writes an offline, CSP-restricted HTML report, deterministic sibling JSON, PNG/receipt pairs, and
optional contextual diffs below `.tileflow/comparisons`. The report embeds its images and performs
no network request. Watch mode observes both config graphs, aborts stale work, preserves the last
complete report through invalid edits, and emits schema-version-1 NDJSON lifecycle events.

An optional `--region=x,y,width,height` selects one shared bounded rectangle in physical pixels,
relative to the top-left. Comparable Review rows then include linear luminance, OKLab
lightness/chroma, edge density, and local contrast for each side plus explicit signed
`rightMinusLeft` deltas. The region never crops the captures, exact/perceptual metrics, or diff.

Stdout and the sibling JSON are one schema-version-1 `visual.compare` document containing concrete
left/right selections, shared camera and viewport, zoom-sorted Review v1 rows with relative artifact
paths, report/document paths, and sorted warnings. The sibling asset directory also contains the
bounded 64 KiB schema-version-1 `.tileflow-visual-compare.json` inventory. Each entry owns one exact
generated sibling by relative name and SHA-256. A later successful transaction removes only stale
assets named by that valid inventory, preserves unrelated files, and refuses an inventoried asset
that was modified, replaced by a symbolic link/non-file, or exceeds its byte bound. `--force` does
not weaken these ownership checks. Report, JSON, inventory, PNG/receipt pairs, optional diffs, and
stale removal commit or roll back together.

Watch NDJSON events are `watching`, `building`, `invalid`, `recovered`, `generation-complete`,
`failed`, and `stopped`, with monotonic comparison generations and source-side generations where
applicable. Invalid edits and incompatible generations preserve the last complete report. Without
`--allow-data-mismatch`, a data mismatch is an unresolved `failed` generation and no new output is
installed; with it, the generation completes with exit-compatible evidence but no invented pixel
metrics. On an orderly stop, watch exits 0 only after at least one complete generation and no
unresolved invalid or failed state; otherwise it exits 1.

The receipt-authenticated review primitive allows map, theme, scene, and style identities to differ.
It reports `comparable`, `frame-mismatch`, `dimensions-mismatch`, `runtime-mismatch`, or
`data-mismatch`; exact/perceptual metrics and a diff exist only when frame, physical dimensions,
renderer/platform, and exact resolved data identity agree. Visual pixel differences are evidence
and exit 0. Incompatibility exits 1; `--allow-data-mismatch` can keep that particular report
inspectable with exit 0 but never manufactures pixel metrics. Review never reads, mutates, or
approves a baseline.

An external screenshot is exploratory evidence, not a Tileflow baseline. Analyze it separately:

```sh
npm exec --no -- tileflow visual analyze app-desktop \
  --reference ./design-reference.png --region=0,0,1200,760 --json
```

The command validates one regular, non-symlinked, bounded, non-interlaced PNG before browser launch,
captures exactly one committed scene, and leaves the reference and every baseline directory
unchanged. It writes `.actual.png`, `.analysis.json`, and—when physical dimensions match—a
transparent high-contrast `.diff.png` under `.tileflow/analysis` by default. The report contains
only hashes, dimensions, up to 16 quantized palette buckets, exact/perceptual pixel metrics, mean
absolute RGBA-channel difference, relative artifact paths, warnings, and an `appearance` profile.
Its explicit `actualMinusReference` direction covers luminance, OKLab lightness/chroma, edge density,
and local contrast. The optional physical-pixel region affects only that profile. Dimension
mismatches have no invented pixel metric, appearance profile, or diff. It does not accept or
manufacture a receipt for the reference, claim scene/runtime compatibility, or define a pass/fail
similarity threshold.

Generated captures and diffs are disposable evidence. A baseline directory is an explicit,
user-owned test artifact and is never inferred from `.tileflow`; teams decide whether to version
it. `visual diff` is read-only with respect to baselines:

```sh
npm exec --no -- tileflow visual diff app-desktop \
  --baseline-dir test/visual-baselines --json
```

It captures fresh actual pixels, validates the baseline PNG and receipt without fetching,
embedding, or executing metadata, and writes `.actual.png`, an optional transparent magenta/cyan
`.diff.png`, and `.visual.json` under `.tileflow/diffs` by default. Result statuses are
`unchanged`, `changed`, `missing-baseline`, `scene-mismatch`, and `runtime-mismatch`. Dimension
changes are `changed` without pixel metrics. Same-size images report exact RGBA changed-pixel count
and ratio plus Pixelmatch's informational fixed 0.1 perceptual metric. Exact RGBA inequality—not
the perceptual metric—determines `changed`.

PNG input is byte- and pixel-bounded and must begin with a canonical, non-interlaced IHDR before
the decoder runs. Baseline/output overlap is rejected using a conservative, platform-aware
normalized path identity, and stable JSON refuses cross-volume paths rather than emitting an
absolute path.

Ordinary changed pixels exit 0 so agents inspect the document. `--fail-on changed` opts into exit 2. Missing or incompatible baselines and operational failures exit 1. Remote resource use is
recorded and warned because such pixels are useful evidence but cannot be claimed globally
byte-stable.

`tileflow visual update` is the only baseline mutation surface. It captures fresh pixels, reports
the safe old/new identity, and writes every selected scene's PNG/receipt pair in one rollback-capable
atomic transaction. It creates, updates, repairs partial/corrupt pairs, or performs a byte-identical
no-op. It refuses the repository root, managed-output overlap, output/baseline overlap, symbolic
links, and ambiguous paths. It never stages, commits, pushes, or otherwise changes Git state.

## Programmatic surface and compatibility

`@tileflow/capture` exports `captureTileflowScenes`, `createTileflowCaptureSession`, explicit browser
setup/launch helpers, strict receipt APIs, `compareTileflowCaptureToBaseline`, and
`compareTileflowCapturesForReview`. Capture results include PNG bytes for Node callers; CLI JSON
projects only scene, map, concrete theme, target, hashes, dimensions, warnings, renderer identity,
and relative artifact paths. A session can capture named scenes, all committed scenes, caller-provided
definitions, or an existing `TileflowBuildArtifacts` snapshot, and must be closed.
`TileflowCaptureError` exposes a stable additive code plus optional bounded details containing the
phase, diagnostics, and safe resource metadata; raw nested causes are not a CLI contract.

`analyzeTileflowCaptureReference` and `validateTileflowVisualReferencePng` expose the same bounded
exploratory reference path to Node callers. `createTileflowVisualReferenceAnalysisDocument` removes
diff bytes before JSON projection.

Capture-result, baseline visual-comparison, visual-analysis, receipt-authenticated Review, and
`visual.compare` command/watch documents use schema version 1; capture receipts use schema version 4. These are compatibility boundaries. Removing or renaming a field, changing an enum's meaning,
weakening readiness, changing exact-pixel classification, or silently selecting another
browser/runtime requires an explicit contract revision. Review exposes its version through
`tileflowVisualReviewSchemaVersion`, its 256 MiB aggregate PNG-input cap through
`tileflowVisualReviewLimits.maximumAggregatePngBytes`, and invalid input through
`TileflowVisualReviewError`/`VISUAL_REVIEW_INVALID`. New optional metadata must remain bounded,
deterministic, non-secret, backward-readable, and covered by parser and CLI serialization tests.
