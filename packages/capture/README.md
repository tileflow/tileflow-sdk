# @tileflow/capture

Pinned, headless local capture and visual comparison for Tileflow scenes. Most users should invoke
it through the project-local `tileflow` CLI; this package is the public Node integration surface.

## Capture committed scenes

```ts
import {captureTileflowScenes} from '@tileflow/capture';

const result = await captureTileflowScenes({
  scenes: ['madrid-desktop'],
  allowBrowserInstall: true,
});

const [{png, receipt, sha256, networkDependent}] = result.captures;
```

Standalone scenes compile through `@tileflow/dev`, inject the installed MapLibre JS and CSS into a
pinned Playwright Chromium headless shell, fulfill generated local icon assets in memory, and wait
for `load`, `idle`, and two animation frames. They never open a visible window or an HTTP listener.
One call with multiple scenes uses one Browser and a fresh isolated context per scene. Capture
installs the exact pinned shell automatically when `allowBrowserInstall` is true; the CLI enables
that normal happy path by default.

For a warm integration, retain and close a session:

```ts
import {createTileflowCaptureSession} from '@tileflow/capture';

const session = createTileflowCaptureSession({cwd: process.cwd()});
try {
  await session.capture(['madrid-desktop']);
  await session.captureAll();
} finally {
  await session.close();
}
```

Sessions can also capture caller-provided scene definitions or a prepared `TileflowBuildArtifacts`
snapshot. Every durable definition names one concrete theme; omission and the browser-only
`system` selector are rejected. Results carry that theme, PNG bytes, dimensions, hashes, safe
runtime identity, the canonical receipt, warnings, and a `networkDependent` flag. They never expose
a Playwright page or browser as part of the capture result.

Failures use `TileflowCaptureError` with a stable code and optional bounded details. The phase
distinguishes style validation, browser start, resource loading, MapLibre load/idle, and screenshot
production. Resource details contain only a classified kind, sanitized origin, optional HTTP
status, and safe bounded context; raw Playwright stacks, queries, credentials, response bodies, and
DOM contents are not part of the public diagnostic contract.

## Application capture

Application scenes need only the app's normal loopback server:

```ts
const result = await captureTileflowScenes({
  appOrigin: 'http://127.0.0.1:3000',
  scenes: ['madrid-product'],
});
```

Tileflow does not start or discover the server. It accepts only loopback HTTP(S), creates a fresh
context without reused profile/cookies/storage or service workers, confines redirects to the exact
approved origin, finds exactly one target, waits for Tileflow's `data-tileflow-state="idle"` marker,
and captures the element or viewport. The React, Vue, and Svelte wrappers expose the marker plus
`data-tileflow-map`, the resolved `data-tileflow-theme`, and optional `data-tileflow-capture-id`.
Capture verifies the concrete theme before and after screenshot production. A full one-off
`appUrl`, selector, and frame can be supplied through the session options. The route and component
props own application camera state; capture includes that camera in scene identity but does not
rewrite it.

The application's development server also remains authoritative for local PMTiles. Each range is
served from one immutable snapshot and strong ETags prevent one PMTiles read from silently mixing
generations. Application Capture deliberately adds no lease or token that freezes every local
dataset for the complete screenshot. A source edit during that exact window can therefore move a
later read to the next valid generation; application receipts already classify style and data as
`expected-unverified`. Standalone Capture is stricter because it owns and retains its artifact
snapshot for the complete render.

## Prepared/offline browser setup

```ts
import {setupTileflowCaptureBrowser} from '@tileflow/capture';

const renderer = await setupTileflowCaptureBrowser({allowInstall: true});
```

Playwright provisions its exact platform-specific headless shell in the versioned per-user browser
cache. Tileflow always launches headlessly, never uses system Chrome, never embeds a browser in the
npm tarball, and never deletes the shared cache. Set `allowInstall: false` for an offline prepared
environment. The equivalent CLI command is `tileflow setup capture`; use it to pay installation
cost in advance or verify prepared CI, not as a prerequisite for normal capture.

## Receipts and visual comparison

`createTileflowCaptureReceipt`, `parseTileflowCaptureReceipt`,
`validateTileflowCaptureReceipt`, and `serializeTileflowCaptureReceipt` implement the strict,
bounded schema-version-4 receipt contract. A receipt contains the concrete theme,
image/scene/style hashes, dimensions,
renderer/platform identity, the required resolved `data` identity, explicit style/data verification,
and remote-dependency state. Standalone map receipts mark configured style and data as `rendered`;
application receipts mark them as `expected-unverified` because capture cannot inspect an arbitrary
application's live MapLibre instance. Vector endpoints are represented by a query-free SHA-256
fingerprint rather than a raw URL. Receipts contain no time, user, origin, path, query, signed token,
repository, absolute filesystem path, config source, environment, or credential.

For Tileflow World, Capture resolves the map's TileJSON selector once per session, requires
`tileflow.world` to identify `world-v1` with exact release, descriptor, archive, data-contract, and
product-contract SHA-256 values, and renders every standalone scene from the returned immutable tile
template. Repeated scenes and retries reuse that one resolution; another selector in the same
session fails instead of mixing releases. Existing canonical schema-v2 and schema-v3 receipts remain
readable as historical evidence and are never reclassified as schema v4.

Capture reuses Core's exact World V1 release-ID contract: 12–128 characters matching
`^world-v1-[a-z0-9][a-z0-9._-]*[a-z0-9]$`. Selector responses and durable receipts reject rather
than normalize uppercase, whitespace, another generation, or an incomplete boundary value.

Receipt-only tooling can import these contracts from `@tileflow/capture/receipt` without loading the
Playwright capture runtime.

```ts
import {compareTileflowCaptureToBaseline} from '@tileflow/capture';

const comparison = await compareTileflowCaptureToBaseline(result.captures[0], {
  png: baselinePng,
  receipt: baselineReceiptJson,
});
```

Comparison validates PNG CRC, hash, dimensions, pixel bounds, and receipt identity before reading
pixels. It classifies unchanged, changed, missing, scene-mismatch, and runtime-mismatch results,
reports exact RGBA changed pixels plus a fixed 0.1 perceptual metric, and returns an optional
transparent high-contrast diff PNG. Exact RGBA inequality determines `changed`.

To review two deliberate Tileflow renders that are allowed to use different maps, themes, and
styles, use the separate review primitive:

```ts
import {
  compareTileflowCapturesForReview,
  createTileflowVisualReviewDocument,
} from '@tileflow/capture';

const review = await compareTileflowCapturesForReview(
  {capture: leftCapture, definition: leftDefinition},
  {capture: rightCapture, definition: rightDefinition},
  {includeDiff: true, region: {x: 0, y: 0, width: 1200, height: 760}},
);
const document = createTileflowVisualReviewDocument(review);
```

Review requires each PNG, its schema-v4 receipt, and the exact normalized definition used to
produce it. It authenticates both sides before comparing pixels. Different map/style/theme
identities are intentional, but camera, viewport, target frame, physical dimensions, renderer, and
resolved data identity must agree before exact or perceptual metrics are meaningful. Statuses are
`comparable`, `frame-mismatch`, `dimensions-mismatch`, `runtime-mismatch`, and `data-mismatch`.
Inputs are snapshotted from plain accessor-free data before asynchronous work, and both individual
and aggregate PNG byte limits are enforced before hashing. Pixelmatch runs only for compatible
captures; `includeDiff: false` does not allocate or encode a diff. The optional diff is contextual
evidence only; this API never reads, writes, or approves a visual baseline.

Every comparable review also reports `appearance: {region, left, right, rightMinusLeft}`. Profiles
contain linear luminance, OKLab lightness/chroma (`mean`, `p10`, `p50`, `p90`), edge density, and
local contrast. The optional region is one bounded physical-pixel rectangle from the top-left and
affects only `appearance`; exact/perceptual metrics and the diff still describe the complete frame.

Review documents are a schema-version-1 compatibility boundary, exposed through
`tileflowVisualReviewSchemaVersion`. `tileflowVisualReviewLimits.maximumAggregatePngBytes` exposes
the 256 MiB aggregate input cap; each input is also subject to the 256 MiB
`tileflowVisualArtifactLimits.maximumPngBytes` cap and the shared decoded-pixel limits. Invalid,
non-plain, unauthenticated, or over-limit inputs throw `TileflowVisualReviewError` with stable code
`VISUAL_REVIEW_INVALID`. `createTileflowVisualReviewDocument` removes contextual `diffPng` bytes
while retaining the versioned identities, status, metrics, and warnings.

For an external design screenshot that has no Tileflow receipt, use the separate exploratory
primitive:

```ts
import {analyzeTileflowCaptureReference} from '@tileflow/capture';

const analysis = await analyzeTileflowCaptureReference(result.captures[0], referencePng, {
  region: {x: 0, y: 0, width: 1200, height: 760},
});
```

It strictly validates the bounded non-interlaced PNG, reports dimensions and up to 16 deterministic
quantized palette entries, and—only for equal dimensions—exact/perceptual changed pixels, mean
absolute RGBA-channel difference, a high-contrast diff PNG, and
`appearance.actualMinusReference` with the same signed profile. It does not assert scene/runtime
compatibility, accept a receipt for the reference, or create a baseline.

## Security and determinism boundary

`tileflow.config.ts` is executable trusted repository code, not a sandbox. Chromium receives a
small non-secret environment allowlist. Standalone capture fulfills only exact compiled synthetic
assets and reports external HTTP(S) origins; application capture accepts only loopback URLs and
does not echo query strings or DOM contents in failures. Remote tiles, glyphs, or sprites can change,
so a remote-dependent result is evidence but not a globally byte-stable golden image.

See `THIRD_PARTY_NOTICES.md` for runtime license treatment and
https://tileflow.dev/docs/agent-workflow for the complete CLI workflow.
