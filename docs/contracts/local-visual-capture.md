# Local visual capture contract

Status: public alpha contract as of 2026-10-12.

This document owns Tileflow's repository-local scene, timed shot, headless-browser, capture receipt,
application readiness, watch, and visual-baseline behavior. The CLI is the recommended user and agent surface;
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
validated at their config path. Bounds padding must be less than half the viewport's shorter side,
so the bounds keep room to fit. Application paths are root-relative and cannot carry an origin,
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

A standalone scene compiles the owning map into one artifact snapshot through `@tileflow/dev`, fulfills the
exact installed MapLibre main module, worker module, and CSS closure in a fresh
browser context, fulfills generated local sprite assets from memory under a closed synthetic origin,
applies the camera, waits for MapLibre `load` and `idle`, waits two animation frames, and captures
the map. Multiple scenes and warm watch use one Browser with a fresh context per scene. No Node
listener, user profile, visible window, or public CDN runtime is created. If the map uses local PMTiles, the standalone operation retains one
immutable artifact generation until that render finishes.

The virtual document and MapLibre module closure are routed before network access at a credential-free
HTTP(S) resource origin from the style, preferring loopback when present. This lets loopback tiles
and Tileflow font faces load without Private Network Access blocking a synthetic page.

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
TILEFLOW_APP_ORIGIN=http://127.0.0.1:3000 npx tileflow capture app-desktop
```

Each navigation uses a fresh context with no reused cookies, local storage, user profile, or
service workers. Tileflow selects exactly one target by `captureId`, then an explicit selector, or
the exported map ID. A `map` frame captures the selected element; `viewport` captures the page
viewport. Zero or multiple matches, navigation failure, application console/page errors, an error
readiness marker, and timeout fail closed without echoing DOM contents or URL queries. Main-frame
redirects must remain on the exact approved origin, and the bounded credential/fragment-free URL
plus target readiness are checked again after screenshot production. An explicit unmarked selector
may be captured once visible; Tileflow-owned map targets must remain `idle`.

A known application failure remains `APPLICATION_ERROR` when target attachment exhausts the capture
budget. A target that never appears without a reported application failure remains `CAPTURE_TIMEOUT`;
explicit cancellation remains `ABORTED`.

Standalone capture applies the committed camera itself. Application capture deliberately does not
reach into an arbitrary framework component to rewrite its camera: the selected application route
and props must render the committed camera. The camera remains part of scene identity, so changing
it invalidates baseline compatibility even when an application accidentally renders the same
pixels. The same trust boundary applies to the configured style and data: standalone receipts mark
both as `rendered`, while application receipts mark both as `expected-unverified`. An application
receipt identifies the configuration expected by the scene, but does not claim that Tileflow
inspected the running application's MapLibre style or data source.

Local PMTiles keep a stable logical Style URL. The Tileflow handler in the application server
resolves each range request to its current immutable snapshot, retains that generation until the
response is prepared, and returns a strong generation ETag so one cached PMTiles read cannot
silently combine ranges from two generations. Application Capture does not add a token or lease
spanning the complete screenshot.
If the user edits the PMTiles during that exact window, separate reads may resolve different valid
generations; this bounded race is part of the `expected-unverified` application boundary. A later
implementation may add an explicit capture-scoped lease if real evidence justifies its lifecycle.

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

Still captures also retain their normalized concrete-theme scene definition. The CLI saves a
schema-version-1 record containing that definition, receipt and warnings, plus the PNG, under
`.tileflow/captures/records/<captureId>.json` and `<captureId>.png`. The ID is the SHA-256 of the
canonical record JSON; the receipt binds the PNG and scene hashes. Identical records are reused,
and different contents never replace an existing ID. JSON results and captured watch events expose
`captureId`. Timed shots retain their separate frame/video contract.

Map DevTools offers confirmed deletion of an individual capture. Its local
`POST /__workbench/captures/delete` action accepts `{id}` with a full capture ID and removes only that
record's JSON and PNG. It rejects symbolic links and paths outside the project, shares the
capture/compare busy guard and same-origin JSON request checks, and is idempotent for missing files.
Scene exports and source configuration are unchanged. Deleting the pinned reference clears it in
the requesting browser; other saved captures remain available.

`tileflow compare --before <id> --after <id>` reads these saved records without executing a config,
compiling, starting a browser or fetching data. It checks bounded regular files, hashes, receipt
shape and normalized scene identity before invoking the same review comparator used for fresh
renders. Camera, dimensions, renderer and data mismatch remain explicit nonzero outcomes. Comparable
pixel changes are informational. `--capture-dir`, `--region` and `--diff` select the store, physical
region and optional contextual diff. No comparison accepts or updates a baseline implicitly.

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

Diagnostic paths keep compiler-owned RFC 6901 pointers such as `/modules/water/enabled` so agents
can address the authored field directly. Filesystem paths remain relative to the invocation
directory when local and become `(external)` when they would escape it.

Static semantic rejection uses `STYLE_INVALID` and `style-validation`. Runtime phases are
`browser-start`, `resource-load`, `map-load`, `map-idle`, and `screenshot`; shots add
`theme-blend` and `video-encode`. Resource HTTP failures
use `RESOURCE_FAILED`; MapLibre event failures use `MAP_LOAD_FAILED`; load and idle timeouts both
use `CAPTURE_TIMEOUT` with their distinct phase; screenshot API failure uses `SCREENSHOT_FAILED`;
and invalid PNG bytes/dimensions retain `INVALID_PNG` with the screenshot phase.

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

Receipts are canonical schema-version-4 JSON and contain only concrete theme plus
scene/map/target identity, normalized
scene and style hashes, PNG hash and CSS/physical dimensions, Tileflow/MapLibre/Playwright/Chromium
identity, OS/architecture class, DPR, required resolved `data` identity, explicit `verification`,
and `networkDependent`. The durable receipt data type is owned and versioned by `@tileflow/capture`;
it is not an alias of the evolving core authoring type.

For external vector tiles, `data` records the provider kind, optional explicit revision, OpenMapTiles
schema/version, stable primary source ID, park-layer semantics, the complete schema bindings, the
`businessCorridor`, `bathymetry`, `canopy`, `globalLandcover`, and `tree` capabilities, and a safe
source fingerprint. Each capability states whether that optional source layer is bound.
The fingerprint contains only a source class plus SHA-256. Its input removes query and fragment;
loopback sources also discard host and port. A raw URL, origin, path, query, signed token, or
credential is never written to a receipt. A baseline and a capture share a scene only when their
data identities are equal.
Receipts also omit time, user, repository, absolute filesystem path, environment, source pixels,
and config source.

Receipt parsing accepts only schema version 4 and is exact-key, UTF-8, size, portable-identifier,
hash, dimension, and pixel-budget validated; parser-dependent duplicate keys are rejected.

World data is always exact. Capture resolves a logical current or exact TileJSON selector
once for the lifetime of its session. The TileJSON must return one immutable tile template and the
strict `tileflow.world` identity: `product: "world-v1"`, `releaseId`, `descriptorSha256`,
`archiveSha256`, `dataContractSha256`, and `contractSha256`. Capture cross-checks the release and
descriptor against the tile template and prepares an exact, usable TileJSON URL. During Capture,
the existing browser route fulfills that URL with the complete frozen response; it never rediscovers
World. The response SHA-256 participates in prepared style metadata. The pinned MapLibre loader retains
zoom limits, bounds, scheme, attribution and vector-layer metadata, with explicit style source
options retaining their native precedence. The scene camera is unchanged: above the advertised
maximum, MapLibre renders the highest available tiles instead of requesting nonexistent levels.
Every scene and retry reuses the same frozen TileJSON without another upstream lookup. Required
resource and source-layer failures remain errors. Exact World metadata remains authoritative even
when served from loopback; the stale-metadata allowance for local development datasets does not apply.
Capture never derives these identifiers from a mutable URL. A second
selector or a missing/conflicting identity fails closed. World data identity also records the
compiled park-layer semantics.

The prepared style hash includes the frozen TileJSON asset identity. Changed source metadata can
therefore require baseline review even when the resulting pixels match. Capture never approves or
replaces a baseline automatically.

## Timed shots

`TileflowMap.shots` is optional tooling metadata beside `scenes`, with the same ownership rules: it
belongs to the singular exported map, does not inherit, is removed before cartographic
compilation, and never changes style or manifest identity. A committed shot has this version-1
shape:

```ts
type TileflowMapShot = {
  theme: string; // concrete; never "system"
  viewport: {width: number; height: number; dpr?: 1 | 2};
  fps?: 24 | 25 | 30 | 50 | 60; // default 30
  easing?: 'smooth' | 'linear'; // default "smooth"
  keyframes: Array<{
    at: number; // whole milliseconds from the start
    camera: {
      type: 'center';
      center: [number, number];
      zoom: number;
      bearing?: number;
      pitch?: number;
    };
    blend?: {themes: string[]; position: number};
  }>;
};
```

Shot names follow the scene-name rules and are distinct under case folding. The theme, viewport,
and camera values use the scene limits. A shot has 2 to 64 keyframes; the first is at 0, each later
keyframe is strictly later, and the last is at most 60000 ms. Keyframe cameras use only the center
form: a bounds camera depends on the renderer's viewport fit, so interpolating between two of them
would not be defined by the shot itself. Either every keyframe or none declares `blend`; every blend
lists the same two to eight distinct concrete themes in the same order, and its position is from 0
to one less than the number of themes. Theme existence is checked when the shot renders.

A shot renders `floor(lastKeyframe.at × fps / 1000) + 1` frames, at most 3600. Frame `i` samples
the shot at `i × 1000 / fps` ms. Within each keyframe segment the center is interpolated in Web
Mercator coordinates along the shorter way around the world, zoom and pitch linearly, bearing along
the shorter arc, and the blend position linearly. `smooth` applies smoothstep to each segment's
progress; `linear` does not. A frame at a keyframe time shows that keyframe's camera exactly. Core's
pure `tileflowCaptureShotFrames` is the only implementation of this sampling, and capture uses it.

Shots always render in standalone mode. One fresh context and page load the shot theme's compiled
style exactly as a standalone scene does, with the same routing, resource classification, and
`networkDependent` rules. The page style differs only in a zero-duration style transition, so a
changed paint value takes effect when the frame renders instead of animating for 300 ms. When the
shot blends, the page prepares the blend once through Core's theme controller from the compiled
styles of every blended theme, after loading the fonts of all those styles. Each frame then moves
the blend position, applies its camera with `jumpTo`, waits for MapLibre `idle`, waits two
animation frames, and captures the map element as a PNG, so every frame meets the scene readiness
rule. Reduced motion removes label cross-fades. The capture timeout applies separately to page
setup, to blend preparation, and to each frame; time spent delivering a frame to the caller does not
count. Abort closes the page and fails with `ABORTED`.

The default `webm` format opens a WebCodecs `VideoEncoder` in a separate, fully routed browser
context before the first frame. It requests VP9 profile 0 and falls back to VP8, and fails with
`VIDEO_ENCODER_UNAVAILABLE` in phase `video-encode` when neither is supported; the message suggests
the `frames` format. Each captured PNG is decoded and encoded at timestamp `round(i × 10^6 / fps)`
microseconds, with a key frame every second. Tileflow writes the chunks into a WebM file with known
element sizes: an EBML header, then one Segment containing a SeekHead, Info with a 1 ms timestamp
scale and the playback duration `frameCount × 1000 / fps` ms, one video track (`V_VP9` or `V_VP8`,
physical pixel dimensions, and the frame duration), one Cluster per key frame holding SimpleBlocks,
and Cues for each Cluster. Encoder failures use `VIDEO_ENCODE_FAILED`. The `frames` format skips
encoding and delivers each PNG to the caller in order without retaining it.

`tileflow capture --shot <name>` renders committed shots; repeat it or use `--all-shots`. Shot
selection cannot be combined with scenes, `--all`, `--map`, `--watch`, or scene camera, viewport,
theme, or application flags. `--format webm|frames` selects the output. Managed output goes to
`.tileflow/captures/shots/<shot>.webm` or the directory `.tileflow/captures/shots/<shot>/` holding
`frame-0000.png` onward, each with the sibling receipt `<shot>.receipt.json`; `--out-dir` replaces
the managed directory, and `--out` names the `.webm` file or frame directory of exactly one shot,
whose receipt replaces `.webm` with `.receipt.json` or appends it to the directory name. A video and
its receipt are written as one atomic pair. Frames are written to a sibling staging directory while
they render; the frame directory and receipt then replace any previous pair together, which removes
frames left from a longer shot. An existing frame directory may contain only Tileflow frame files.
Overwrite, symbolic-link, and boundary rules match still captures. JSON mode prints one
schema-version-1 `capture.shot` document with sorted entries containing shot, map, concrete theme,
format, optional codec, relative output and receipt paths, output and frame hashes, frame count,
fps, duration, dimensions, renderer identity, `networkDependent`, and warnings. Failures use the
one-shot failure document with command `capture.shot`; unknown shots report `SHOT_NOT_FOUND` with
phase `shot-resolution`.

A shot receipt is canonical schema-version-1 JSON with `kind: "shot"`, bounded to 64 KiB. It
contains the shot name, map, concrete theme, and SHA-256 of the normalized shot; the SHA-256 of the
shot theme's prepared style and, when the shot blends, each blended theme with its style SHA-256 in
blend order; fps, frame count, and the duration of the last keyframe; CSS and physical dimensions
and DPR; `frames.sha256`; the output kind (`webm` with its codec, or `frames`) and SHA-256;
renderer and OS/architecture identity; the schema-v4 data identity; `rendered` style and data
verification; and `networkDependent`. `frames.sha256` is the SHA-256 of each frame's lowercase
hexadecimal PNG SHA-256 followed by a newline, in frame order. Frames follow the same
reproducibility rules as scene captures, so `frames.sha256` is the comparable identity of a shot's
pixels. Encoders may produce different bytes for the same frames, so a video's `output.sha256`
identifies only that file; for the `frames` format it equals `frames.sha256`. Like scene receipts,
shot receipts contain no time, user, repository, absolute path, environment, URL, or credential.

## Visual comparison and baselines

Two deliberate Tileflow renders can be compared without pretending either one is an approved
baseline. The live authoring surface is `tileflow preview`, opening Map DevTools with
one watched session and one preview handler by default. Any `--against-*` selection adds a second
same-origin preview handler with its own watched session, synchronizes their
camera, persists Map DevTools state in the URL, and provides side-by-side, split, opacity-overlay, and
blink views. An invalid edit retains that side's last valid artifacts and exposes only bounded
diagnostics until it recovers. The opt-in compiler sidecar, rendered-feature inspector, zoom-curve
samples, compiled sprite atlas, and scene/capture-command copy helpers are local diagnostics; the
sidecar is never a build artifact or runtime manifest field.

The **Capture** action in Map DevTools pins the displayed, ready artifact generation and invokes the same
capture session with the selected map/theme, current camera and explicit fixed frame. Temporary
preview visibility overrides are excluded. The renderer starts lazily and is reused until shutdown.
The action stores the same immutable records as `tileflow capture`; history and saved comparison
verify and reuse those records. Resizing the UI does not alter the capture frame. An invalid or
stale revision cannot begin capture. Saved review retains the ordinary frame, renderer and data
compatibility gates before exposing exact pixel metrics; the result is never baseline approval.

The local Map DevTools adapter exposes version-1 catalog, history, capture, compare and context JSON.
`tileflow inspect session --url <local-preview-origin> --json` reads browser observations with their
generation, displayed generation, update time and stale flag. Bounded feature/style/provenance
context is separate from deterministic receipts and does not assert exact source-file ownership.
Limits and user workflow are documented in the
[CLI guide](../../packages/cli/docs/map-authoring.md#work-with-a-person-and-an-agent).

Durable review evidence also uses an exact headless capture matrix:

```sh
npx tileflow visual compare \
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
npx tileflow visual analyze app-desktop \
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
npx tileflow visual diff app-desktop \
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

`@tileflow/capture` exports `captureTileflowScenes`, `captureTileflowShot`,
`createTileflowCaptureSession`, explicit browser setup/launch helpers, strict scene and shot receipt
APIs, `compareTileflowCaptureToBaseline`, and `compareTileflowCapturesForReview`. Capture results
include PNG bytes for Node callers; shot results include the WebM bytes and per-frame hashes, while
frames reach the caller's `onFrame`. CLI JSON projects only scene, map, concrete theme, target,
hashes, dimensions, warnings, renderer identity, and relative artifact paths. A session can capture
named scenes, all committed scenes, caller-provided definitions, or an existing
`TileflowBuildArtifacts` snapshot, render one, several, or all committed shots, and must be closed.
`TileflowCaptureError` exposes a stable additive code plus optional bounded details containing the
phase, diagnostics, and safe resource metadata; raw nested causes are not a CLI contract.

`analyzeTileflowCaptureReference` and `validateTileflowVisualReferencePng` expose the same bounded
exploratory reference path to Node callers. `createTileflowVisualReferenceAnalysisDocument` removes
diff bytes before JSON projection.

Capture-result, baseline visual-comparison, visual-analysis, receipt-authenticated Review,
`capture.shot`, and `visual.compare` command/watch documents use schema version 1; capture receipts
use schema version 4 and shot receipts use schema version 1. These are compatibility boundaries.
Removing or renaming a field, changing an enum's meaning, weakening readiness, changing exact-pixel
classification, or silently selecting another browser/runtime requires an explicit contract
revision. Review exposes its version through
`tileflowVisualReviewSchemaVersion`, its 256 MiB aggregate PNG-input cap through
`tileflowVisualReviewLimits.maximumAggregatePngBytes`, and invalid input through
`TileflowVisualReviewError`/`VISUAL_REVIEW_INVALID`. New optional metadata must remain bounded,
deterministic, non-secret, backward-readable, and covered by parser and CLI serialization tests.
