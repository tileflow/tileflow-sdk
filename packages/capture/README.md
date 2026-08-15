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
snapshot. Results carry PNG bytes, dimensions, hashes, safe runtime identity, the canonical receipt,
warnings, and a `networkDependent` flag. They never expose a Playwright page or browser as part of
the capture result.

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
`data-tileflow-map` and optional `data-tileflow-capture-id`. A full one-off `appUrl`, selector, and
frame can be supplied through the session options. The route and component props own application
camera state; capture includes that camera in scene identity but does not rewrite it.

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
bounded schema-version-2 receipt contract. A receipt contains image/scene/style hashes, dimensions,
renderer/platform identity, the required resolved `data` identity, and
remote-dependency state; it contains no time, user, origin,
repository, absolute path, config source, environment, or credential.

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

For an external design screenshot that has no Tileflow receipt, use the separate exploratory
primitive:

```ts
import {analyzeTileflowCaptureReference} from '@tileflow/capture';

const analysis = await analyzeTileflowCaptureReference(result.captures[0], referencePng);
```

It strictly validates the bounded non-interlaced PNG, reports dimensions and up to 16 deterministic
quantized palette entries, and—only for equal dimensions—exact/perceptual changed pixels, mean
absolute RGBA-channel difference, and a high-contrast diff PNG. It does not assert scene/runtime
compatibility, accept a receipt for the reference, or create a baseline.

## Security and determinism boundary

`tileflow.config.ts` is executable trusted repository code, not a sandbox. Chromium receives a
small non-secret environment allowlist. Standalone capture fulfills only exact compiled synthetic
assets and reports external HTTP(S) origins; application capture accepts only loopback URLs and
does not echo query strings or DOM contents in failures. Remote tiles, glyphs, or sprites can change,
so a remote-dependent result is evidence but not a globally byte-stable golden image.

See `THIRD_PARTY_NOTICES.md` for runtime license treatment and
https://tileflow.dev/docs/agent-workflow for the complete CLI workflow.
