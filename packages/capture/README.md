# @tileflow/capture

For the complete CLI workflow, use `describe`, `inspect`, `capture`, `compare`, and Inspector (`preview`)
as described in the [CLI guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md).
New still captures include their normalized `definition` for later review. The CLI stores immutable
capture IDs so `compare --before <id> --after <id>` can reuse evidence without rendering again.

Headless Tileflow map capture for Node.js. Produce PNGs with versioned receipts, compare reviewed
baselines, or inspect differences between deliberate renders. Use the
[CLI](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) for ordinary terminal
work; use this package when embedding capture in a script or integration.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

Use Node.js 22 or newer:

```sh
npm install --save-dev @tileflow/capture@alpha @tileflow/core@alpha @tileflow/maps@alpha
```

Capture uses Playwright's exact pinned Chromium headless shell. The browser is not bundled in npm
and a system Chrome installation is not a substitute. `allowBrowserInstall: true` permits its
first-use download. Provision the matching shell and system libraries ahead of time in restricted
CI environments; never assume that installing the npm package installed the browser.

Local capture needs no Tileflow API key. Configs are executable trusted code; remote tiles, fonts,
and sprites may still require network access and their own permissions.

## Capture a committed scene

Create `tileflow.config.ts` in the working directory:

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

Scenes belong to this map and do not inherit. Every scene needs a concrete theme; omission and
`system` are invalid. Coordinates are `[longitude, latitude]`, viewport dimensions are CSS pixels,
and `dpr` is 1 or 2.

Run the following TypeScript module from that working directory with your project's TypeScript
runner. It writes evidence, not an approved baseline:

<!-- docs:check -->

```ts
import {mkdir, writeFile} from 'node:fs/promises';
import {captureTileflowScenes, serializeTileflowCaptureReceipt} from '@tileflow/capture';

const result = await captureTileflowScenes({
  config: 'tileflow.config.ts',
  scenes: ['madrid-desktop'],
  allowBrowserInstall: true,
});
const capture = result.captures[0];
if (!capture) throw new Error('Capture returned no image.');

await mkdir('.tileflow/captures', {recursive: true});
await writeFile('.tileflow/captures/madrid-desktop.png', capture.png);
await writeFile(
  '.tileflow/captures/madrid-desktop.receipt.json',
  serializeTileflowCaptureReceipt(capture.receipt),
);
console.log(capture.sha256, capture.networkDependent, capture.warnings);
```

A standalone capture needs no HTTP server or visible browser window. One call uses one browser and
a fresh isolated context for each scene. Results include PNG bytes, dimensions, concrete theme,
scene/style/image hashes, runtime identity, a receipt, warnings, and `networkDependent`. They do not
expose a Playwright page or browser.

## Reuse or prepare the browser

For repeated capture, retain a session and close it even after errors:

<!-- docs:check -->

```ts
import {createTileflowCaptureSession} from '@tileflow/capture';

const session = createTileflowCaptureSession({allowBrowserInstall: true});
try {
  await session.capture(['madrid-desktop']);
  await session.captureAll();
} finally {
  await session.close();
}
```

To provision ahead of time, call `setupTileflowCaptureBrowser({allowInstall: true})`. In an offline
prepared environment, use `allowInstall: false` and capture with `allowBrowserInstall: false`.
The equivalent CLI command is `tileflow setup capture`. These settings control browser installation,
not the network access required by a map's remote resources. Tileflow never deletes the shared
per-user browser cache.

## Render a timed shot

A [capture shot](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/capture-shots.md)
is a committed camera move with keyframes and an optional theme blend. This module assumes a
`dusk-flyover` shot in `tileflow.config.ts` and writes its WebM video and receipt:

<!-- docs:check -->

```ts
import {mkdir, writeFile} from 'node:fs/promises';
import {captureTileflowShot, serializeTileflowShotReceipt} from '@tileflow/capture';

const shot = await captureTileflowShot({shot: 'dusk-flyover', allowBrowserInstall: true});
if (!shot.video) throw new Error('The shot produced no video.');

await mkdir('.tileflow/captures/shots', {recursive: true});
await writeFile('.tileflow/captures/shots/dusk-flyover.webm', shot.video);
await writeFile(
  '.tileflow/captures/shots/dusk-flyover.receipt.json',
  serializeTileflowShotReceipt(shot.receipt),
);
console.log(shot.frameCount, shot.codec, shot.framesSha256);
```

Every frame moves the camera with MapLibre `jumpTo`, moves the blend position, and waits for
MapLibre `idle` and two animation frames before its screenshot, exactly as a scene does. A slow
machine or network makes the render take longer; the video keeps its frame rate and shows every
frame. `timeoutMs` bounds page setup and each frame separately.

The pinned browser encodes the captured PNGs with WebCodecs: VP9, or VP8 where VP9 is unavailable.
A browser that supports neither fails before the first frame with `VIDEO_ENCODER_UNAVAILABLE`.
Use `format: 'frames'` to receive the PNG frames through `onFrame` instead of a video; frames are
delivered in order and are not kept in memory:

<!-- docs:check -->

```ts
import {mkdir, writeFile} from 'node:fs/promises';
import {createTileflowCaptureSession} from '@tileflow/capture';

await mkdir('frames', {recursive: true});
const session = createTileflowCaptureSession({allowBrowserInstall: true});
try {
  const shot = await session.captureShot('dusk-flyover', {
    format: 'frames',
    onFrame: (frame) =>
      writeFile(`frames/frame-${String(frame.index).padStart(4, '0')}.png`, frame.png),
  });
  console.log(shot.frameCount, shot.framesSha256);
} finally {
  await session.close();
}
```

`captureShots` and `captureAllShots` render several shots from one compiled snapshot. A shot
receipt records the shot, theme and blend styles, timing, dimensions, renderer, data identity, and
`frames.sha256`, a digest of every frame's PNG SHA-256. Frames are reproducible under the same
conditions as scene captures; encoder bytes may differ between runs, so `output.sha256` identifies
the written video while `frames.sha256` identifies its pixels.

## Capture the running application

Application capture uses the app's normal loopback server; it does not start a server or discover a
port. Add a `madrid-product` entry to the config's `scenes` using this definition:

<!-- docs:check -->

```ts
import type {TileflowCaptureScene} from '@tileflow/core';

const applicationScene = {
  theme: 'dark',
  camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 12},
  viewport: {width: 1280, height: 800, dpr: 1},
  target: {kind: 'application', path: '/maps/madrid', captureId: 'main-map'},
} satisfies Omit<TileflowCaptureScene, 'map'>;
```

The route must render a Tileflow component for `madrid`, with theme `dark` and
`captureId="main-map"`. The application owns its camera; capture records the scene camera but does
not move the application's map. Start the app in one terminal, then run:

<!-- docs:check -->

```ts
import {captureTileflowScenes} from '@tileflow/capture';

const result = await captureTileflowScenes({
  appOrigin: 'http://127.0.0.1:3000',
  scenes: ['madrid-product'],
  allowBrowserInstall: true,
});
console.log(result.captures[0]?.sha256);
```

Only loopback HTTP(S) is accepted. Capture confines redirects to the approved origin, uses no
reused profile/cookies/storage or service workers, selects exactly one target, waits for
`data-tileflow-state="idle"`, and verifies the concrete theme before and after capture.
`appUrl`, `selector`, and `frame` provide explicit one-off overrides. Do not run a separate
`tileflow preview` server beside the app.

Application receipts mark style/data as `expected-unverified`; capture cannot inspect an arbitrary
application's live MapLibre instance. Standalone receipts mark them as `rendered` and retain one
prepared artifact generation for the whole capture. An application dataset edit can move later
requests to a new generation; application capture does not freeze every dataset for the screenshot.

## Compare a reviewed baseline

This example requires an existing reviewed PNG and receipt pair in `test/visual-baselines`. It
reads them without replacing them:

<!-- docs:check -->

```ts
import {readFile} from 'node:fs/promises';
import {captureTileflowScenes, compareTileflowCaptureToBaseline} from '@tileflow/capture';

const result = await captureTileflowScenes({
  scenes: ['madrid-desktop'],
  allowBrowserInstall: true,
});
const capture = result.captures[0];
if (!capture) throw new Error('Capture returned no image.');

const comparison = await compareTileflowCaptureToBaseline(capture, {
  png: await readFile('test/visual-baselines/madrid-desktop.png'),
  receipt: await readFile('test/visual-baselines/madrid-desktop.receipt.json', 'utf8'),
});
console.log(comparison.status);
```

Comparison validates the image and receipt before reading pixels. Results distinguish unchanged,
changed, missing, scene mismatch, and runtime mismatch. Exact RGBA inequality determines `changed`;
the perceptual metric and optional diff image are additional evidence. Never update a baseline
merely to make a failing comparison pass.

`compareTileflowCapturesForReview` compares two deliberate renders with different styles while
requiring compatible framing, renderer, and data identity. It accepts captures with or without a
retained `definition`; when present, that definition must match the explicit review definition.
`analyzeTileflowCaptureReference` analyzes
an external PNG without claiming receipt compatibility. Neither operation approves a baseline.
See the [receipt and comparison reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/docs/receipts-and-comparison.md),
also included under `docs/` in the installed package, for identities, metrics, and limits.

## Errors, receipts, and reproducibility

`TileflowCaptureError` reports a stable code, phase, and bounded details. Phases distinguish style
validation, browser startup, resource loading, MapLibre readiness, and screenshot production.
Resource diagnostics contain safe classification and origin/status information, not credentials,
query strings, response bodies, raw browser stacks, or DOM contents.

Receipts use schema version 4; parsing rejects any other version. Shot receipts use their own
schema version 1. Import
`@tileflow/capture/receipt` for receipt-only tooling without loading the capture runtime. World selectors resolve once per capture session to
an immutable release. Capture retains the complete resolved TileJSON, including its zoom range,
bounds, attribution and vector-layer metadata. Above the data's maximum zoom, MapLibre enlarges
available tiles while preserving the scene camera. Retries reuse the same frozen metadata.
Remote-dependent rendering is not a guarantee of globally identical pixels
across platforms or future runs.

Read the [capture contract](https://github.com/tileflow/tileflow-sdk/blob/main/docs/contracts/local-visual-capture.md)
for durable behavior and [third-party notices](https://github.com/tileflow/tileflow-sdk/blob/main/packages/capture/THIRD_PARTY_NOTICES.md)
for runtime licenses. For release-specific behavior, prefer installed declarations and docs over `main`.
