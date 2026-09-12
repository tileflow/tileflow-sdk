# Capture receipts and visual comparison

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

The following comparison fragments assume captures and PNG/receipt bytes that the caller has
already loaded and validated. See the package README for a complete baseline-file example.

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
