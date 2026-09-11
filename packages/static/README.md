# @tileflow/static

Static map schemas, overlay helpers, and request utilities for Tileflow static map rendering.

This package describes and submits a render scene, then follows its asynchronous operation until an
immutable image is ready. It is distinct from React's `<Map mode="image">`, which only displays an
existing hosted image and does not create or poll a Static Maps operation.

Every scene names one concrete `theme`. The browser-only `"system"` selector is rejected so hashes,
cache keys, receipts, and regenerated images remain reproducible.

Scene, size, camera, attribution, padding, and overlay objects are strict. Unknown fields are
rejected instead of being removed during normalization, so misspelled or unsupported options cannot
silently share another scene's identity.

```ts
import {
  createStaticMapIdempotencyKey,
  marker,
  precacheStaticMap,
  validateStaticScene,
} from '@tileflow/static';

const scene = validateStaticScene({
  map: 'madrid',
  theme: 'dark',
  format: 'webp',
  camera: {type: 'auto', padding: 24},
  size: {width: 600, height: 400, dpr: 2},
  overlays: [marker({coordinate: [-3.7038, 40.4168]})],
});

if (!scene.ok) throw new Error(scene.error);

const result = await precacheStaticMap(scene.scene, {
  apiKey: process.env.TILEFLOW_API_KEY,
  idempotencyKey: createStaticMapIdempotencyKey(),
});

console.log(result.attribution.entries);
```

`width` and `height` are logical CSS pixels. `dpr` accepts 1 or 2 and defaults to 1, so a 600 by
400 scene at DPR 2 produces a 1200 by 800 image without changing camera, padding, or overlay paint
sizes. Logical dimensions may reach 2048 per axis; the physical budget permits 4096 by 4096 output,
or 16,777,216 total pixels.

`format` accepts `png`, `jpeg`, or `webp` and defaults to PNG. PNG's canonical default stays omitted,
so explicit and omitted PNG requests share identity. JPEG and WebP use a fixed encoder quality;
there is no public quality option.

## Semantic overlays

Every overlay accepts a semantic `placement`:

- `above-water`
- `below-roads`
- `above-roads`
- `above-buildings`
- `below-labels`
- `above-labels` (default)

These values are stable across themes. They never expose a physical Style layer ID. Array order is
preserved within each placement; later overlays paint above earlier overlays in the same group.

Use `symbol` for a deployed sprite icon, renderer-owned text, or both:

```ts
import {symbol} from '@tileflow/static';

symbol({
  coordinate: [-3.7038, 40.4168],
  icon: 'store',
  label: {appearance: 'badge', text: '23'},
  placement: 'above-labels',
  anchor: 'bottom',
  offset: [0, -4],
  scale: 1,
});
```

`icon` is an ID in the exact managed sprite deployed with the selected Map, never a URL. Hosted
resolves and binds its dimensions before rendering; an unmanaged sprite or absent ID returns a
non-retryable structured error. `scale` changes the icon while `label.fontSize` controls text.
`offset` uses logical CSS pixels and moves the complete symbol after anchoring.

A string label is shorthand for `{appearance: 'plain', text}`. `plain` renders text with a halo;
`badge` renders text in a rounded container. Both use renderer-owned Noto faces independent of theme
typography. The accepted baseline is generated from the shipped WOFF2 `cmap` tables and covers
Latin/Extended, Vietnamese, Greek, Cyrillic, Arabic, Hebrew, Devanagari, Thai, Japanese, Simplified
and Traditional Chinese, and Korean. Symbols and embedded attribution use exactly that coverage.
Unsupported glyphs fail with `STATIC_MAP_LABEL_UNSUPPORTED`; Chromium must load the matching bundled
face. The renderer audits the face Chromium actually used for every run; any system-font glyph fails
the render.

Appearance objects accept `language: 'ja' | 'zh-Hans' | 'zh-Hant' | 'ko'`. It chooses the preferred
regional Noto CJK face; glyphs absent there fall through only to other bundled regional faces. It
does not translate text or select map data. Omission and string shorthand normalize to `zh-Hans`.
That fallback is deterministic but makes no regional-form promise for Han text whose language was
omitted. Font family and weight are not public controls. Label position can be `center`, any cardinal
side, or any diagonal side. With an icon, plain defaults above it and badge defaults above-right;
label-only symbols default to center.

`anchor` accepts the same nine center/cardinal/diagonal positions. `collision: 'always-visible'` is
the default: the symbol is never hidden and does not reserve collision space. `avoid-overlap`
participates in MapLibre's shared symbol collision index, including ordinary Style labels and other
request symbols. The visually higher layer wins: an `above-labels` request symbol can hide a
colliding Style label, while a `below-labels` symbol yields to it. Higher semantic placement wins
across placements; later request order wins within one placement. Style-owned overlap properties
remain authoritative.

## Attribution

New renders default to `attribution: {mode: 'embedded', position: 'auto'}` without adding that
omitted default to the normalized scene. Hosted derives notices from the sources referenced by the
exact selected Style and embeds a safe, compact block. Automatic placement prefers an unobstructed
corner, then the least interfering corner among declared request overlays. Explicit center and
bounds cameras never move.

Choose a corner when composition requires it:

```ts
attribution: {mode: 'embedded', position: 'bottom-left'}
```

Or request structured external attribution:

```ts
const result = await createStaticMap(
  {...scene.scene, attribution: {mode: 'external'}},
  {
    apiKey: process.env.TILEFLOW_API_KEY,
    idempotencyKey: createStaticMapIdempotencyKey(),
  },
);

for (const entry of result.attribution.entries) {
  renderAttributionText(entry.text, entry.links);
}
```

External mode leaves the image unchanged and returns `position: null`. The caller must retain and
display every returned entry beside the image. Entries contain bounded plain text, safe HTTP(S)
links, and `platform-notice` or `team-declared` authority; they never contain source HTML or private
resource IDs. Embedded results return the resolved corner. Changing mode or requested position
changes scene and artifact identity.

Embedded attribution uses the same generated multilingual coverage as symbol labels and the fixed
`zh-Hans` CJK fallback. External attribution contains structured text only and is rendered by the
caller.

## Automatic framing

`camera.type: 'auto'` fits the complete painted footprint of every declared marker, circle, line,
polygon, and symbol. Symbol sizing uses the exact deployed icon dimensions plus deterministic label
measurement, anchor, scale, and offset. It works with Mercator and Globe styles when the geometry
can be shown. It never clips silently.

```ts
camera: {
  type: 'auto',
  padding: {top: 24, right: 240, bottom: 24, left: 24},
  maxZoom: 16,
  bearing: 0,
}
```

Padding uses logical CSS pixels. A number applies to every side; omitted sides in an object are
zero. Without `padding`, Tileflow uses `min(32, ceil(5% * min(width, height)))`. `maxZoom` defaults
to 16 and `bearing` to 0. A single position still honors asymmetric padding, so its apparent center
can move away from the viewport center.

Point-like overlays around ±180° use the shortest longitude interval. Tileflow never reinterprets
vertices inside a line or polygon: an ambiguous crossing returns an error. Represent a correctly
cut `MultiLineString` or `MultiPolygon` as several `line` or `polygon` overlays with identical
styles; auto-fit may move each complete component to an adjacent world copy.

Current overlay primitives use MapLibre's GeoJSON pipeline and require
`abs(latitude) <= MAX_OVERLAY_LATITUDE` (`85.051129`). Tileflow rejects larger latitudes instead of
clamping them. A Globe basemap may display polar regions even though these overlay primitives cannot
yet be drawn there.

Deterministic request failures return `422`, set `retryable: false`, and preserve a stable code,
reason, and bounded details. `validateStaticScene` returns that document; request helpers throw
`StaticMapRequestError` either locally or from the Hosted response. The reasons distinguish an empty
scene, an ambiguous antimeridian path, an out-of-range overlay latitude, an unsupported label glyph,
an unavailable managed icon or semantic placement, an oversized composed symbol, an insufficient
viewport, a Globe visibility conflict, an unresolvable camera, and failed post-fit containment.
Correct the scene or redeploy the Map as directed; do not retry it unchanged. Unsupported
attribution grammar or glyphs, excessive attribution, and a block that cannot fit use the same
non-retryable `422` boundary.

Other bounded Hosted JSON failures throw `StaticMapError`. It preserves HTTP `status` and any safe
`code`, `retryable`, `requestId`, or `remainingUnits` fields the server supplied; absent fields are
`null`. `StaticMapRequestError` extends the same class. Malformed, oversized, or unsafe remote
documents remain generic errors and are never reflected to the caller.

The package has four deliberately separate surfaces, all available from the root for compatibility:

- scene validation and normalization: `staticSceneSchema`, `validateStaticScene`, and
  `normalizeStaticScene`;
- overlay authoring and MapLibre compilation: `line`, `circle`, `marker`, `polygon`, `symbol`, and
  `compileStaticOverlays`;
- renderer identity: `createRenderManifest`,
  `validateStaticRenderManifest`, `hashRenderManifest`, and `hashStaticSceneRequest`;
- bounded Hosted transport: `prepareStaticMapRequest`, `createStaticMap`, `precacheStaticMap`, and
  `requestStaticMapUntilReady`.

Applications that need only one surface can use `@tileflow/static/scene`, `/overlays`, `/manifest`,
or `/client`. The root remains a compatibility entry point.

`StaticRenderManifest` is the single strict immutable input contract between a resolved Hosted style
and a Static Maps renderer. It binds safe attribution, exact source identity, semantic placement
anchors, and resolved sprite dimensions. Its top-level `mapId` identifies the resolved destination
while `scene.map` retains the portable map name supplied by the application. It is unrelated to the
runtime delivery manifest generated by application build or deploy workflows.

Create one idempotency key per intentional create/precache action and retain it across network
retries. Reusing the key with the same normalized scene returns the stored result; reusing it with a
different scene returns 409. A successful paid operation reports `unitCost: 15`, shared
`remainingUnits`, its durable `operationId`, cache reuse, hash, and immutable image URL. An
unbounded Starter service reports `remainingUnits: null`. Creation helpers require the single strict
result contract, including `resultVersion: 1` and attribution. A live
equal-hash render may return `202`; the helper polls with the same body/key within its bounded wait.
`maxWaitMs` is the total client completion budget, including network, response parsing, and polling
delays; `signal` cancels the same complete operation. The helper aborts in-flight work when either
boundary is reached. It rejects malformed responses, non-HTTP(S) image URLs, and any change of
durable operation ID while polling.

Framework adapters can call `prepareStaticMapRequest(scene)` once and pass its result to
`requestStaticMapUntilReady(request, {createUrl, idempotencyKey, ...})`. The prepared request uses
the same normalized scene for its `sceneKey` and HTTP body, so equivalent omitted/explicit defaults
deduplicate consistently without duplicating the polling implementation.

Free cannot initiate Static Maps work. Starter consumes 15 shared API units for each successful
logical operation, including a distinct-key cache reuse. Downloading an immutable PNG, JPEG, or WebP
consumes zero units.

Docs: https://tileflow.dev/docs

## Team credentials

A Team credential can serve multiple Maps. Pass `mapId` in the options to `createStaticMap` or
`precacheStaticMap`; it must be a Managed Map ID such as `map_1234567890abcdef`. The client sends
`X-Tileflow-Map-Id` separately from the portable scene. `scene.map` remains the deployed environment
name. The Hosted API must support unified Team credentials and authorize the selected Map.
Existing Map-scoped keys remain usable without this option. Keep either key on a trusted server.
