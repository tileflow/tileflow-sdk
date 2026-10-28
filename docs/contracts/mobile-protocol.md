# Mobile host and renderer protocol contract

The Swift and Kotlin map SDKs show Tileflow maps through an embedded renderer: the runtime in
`packages/mobile-runtime`, which runs Core and MapLibre GL JS inside the system WebView. This
document defines how a native **host** (the SDK code that owns the WebView, its transport and the
Hosted session) and the **renderer** talk to each other. Public behavior belongs to the SDK APIs;
this contract records what both sides must agree on.

## One definition, three implementations

[`packages/mobile-runtime/protocol.json`](../../packages/mobile-runtime/protocol.json) defines the
protocol version, limits, methods, events, event levels, camera change reasons, resource kinds and
the error taxonomy. `node scripts/mobile-protocol-generate.mjs` writes from it:

- the runtime's `src/contract.ts`;
- the internal `ProtocolContract` of each host (Swift `Bridge/ProtocolContract.swift`, Kotlin
  `bridge/ProtocolContract.kt`);
- the public enumerations shared by both hosts (`ProtocolTypes.swift`, `ProtocolTypes.kt`): error
  codes with their classification, event levels, camera change reasons and resource kinds.

`pnpm native:runtime` runs the generator with `--check` first, and the runtime's tests check the
contract's own rules, so a host and the renderer cannot drift. Never edit a generated file.

## Handshake and versions

Each renderer document belongs to one host **generation**: a WebView, its transport and its data
channel. A new document, for example after the system ends the renderer process, is a new
generation; nothing of the previous one is reused.

1. Before the document's first script, the host defines `tileflowHost` with the view's instance
   identifier, the generation, the platform and the protocol versions it supports
   (`protocol: {minimum, maximum}`).
2. The renderer selects the highest version both sides support and sends `hello` with its runtime
   hash and `protocol: {minimum, maximum, selected}`. `selected` is null when they share none.
3. The host accepts the renderer only when `selected` is one of its versions, equals the version of
   the `hello` message itself, and the runtime hash equals the hash in the embedded receipt.
   Otherwise the map fails with `incompatibleRuntime` and the reason `protocolVersion` or
   `runtimeHash`, without waiting for the handshake timeout.
4. A renderer that shares no version answers every request with `incompatibleRuntime` instead of
   ignoring it.

Before loading, the host also checks that the receipt of the embedded runtime declares a supported
protocol version. The runtime is embedded and versioned with the SDK, so a mismatch is a build
fault, but it is always reported as a typed error.

## Requests

Control messages are JSON of at most `maximumMessageBytes` (64 KiB). A request carries the
negotiated `protocolVersion`, the instance and generation, a request identifier and a command.
Identifiers increase monotonically within a generation and are never reused. At most
`maximumPendingRequests` (64) requests are pending; each expires after `requestTimeoutMs`
(30 seconds) on both sides.

An invalid but addressable request is answered at once with `invalidRequest`. A message for another
instance or generation is never answered.

Cancelling the caller's task or coroutine sends `cancel` with the request's identifier. The
renderer aborts the operation's signal, so reads on the data channel stop too, and answers the
request with `cancelled`. Swift callers receive `CancellationError`; Kotlin callers receive the
coroutine's `CancellationException`. When the host gives up on a request because it timed out, it
cancels it in the renderer in the same way.

When a generation is retired, its pending requests fail with `cancelled` if the view continues with
a new renderer, or with `disposed` if the view was destroyed.

## Data channel

Payloads larger than control messages travel over the native transport that already serves every
map resource. There is no local HTTP server.

- The host registers a payload for one request and receives a reference:
  `{id, byteLength, sha256}`. Identifiers are 128 random bits, URL-safe and specific to one
  generation.
- The renderer reads it with `GET tileflow://data/<id>` on iOS (`WKURLSchemeHandler`) or
  `GET https://tileflow.invalid/data/<id>` on Android (request interception). Any other method or
  identifier shape is refused.
- The renderer verifies the exact length and the SHA-256 digest before it parses anything. A
  difference fails the request with `resourceFailed` and the reason `dataIntegrity`.
- The host releases a request's references when the request settles, whether it succeeded, failed,
  timed out or was cancelled. A released payload answers 404, which the renderer reports as
  `resourceFailed` with the reason `dataUnavailable`. Retiring a generation releases everything.
- Equal payloads in flight share one entry. The renderer reads each distinct digest once per
  request and reuses data that its current content already holds, so content that did not change
  is neither read nor sent to the map's worker again.
- Limits: `maximumDataBytes` (32 MiB) per payload, `maximumDataTotalBytes` (64 MiB) in flight per
  generation and `maximumDataReferences` (64) entries. The host refuses payloads beyond them with
  `invalidRequest` and the reason `dataTooLarge`, before anything is sent.

The data channel carries data from the host to the renderer. Results larger than a control message
in the other direction are not supported yet.

`setContent` sends every GeoJSON layer this way. The renderer validates the GeoJSON against
RFC 7946, without GeometryCollection or foreign members, with closed rings, finite positions inside
longitude and latitude ranges and property values nested at most 64 levels. Invalid GeoJSON fails
the request with `invalidRequest` and the reason `invalidGeoJSON`, and the previous content stays.

## Events

The renderer sends only the events the host subscribes to; it does not even compute the payload of
any other event. `hello` and `error` need no subscription.

Each event belongs to one level. Levels are cumulative:

| Level        | Adds                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `essential`  | `loading`, `contentReady`, `themeChanged`, `themeTransition`, `warning`, `tap`, activations, `animationEnded`, `shotCue`, `cameraMoveEnded` |
| `camera`     | `cameraMoveStarted`                                                                                                                         |
| `continuous` | `cameraMoved`, at most once per rendered frame                                                                                              |

The host sends its subscriptions in `initialize` and replaces them with `setEvents`. Each
subscription has a throttle interval, from 0 to `maximumThrottleMs`. A throttled event is delivered
at once when its interval has passed; otherwise its latest payload is delivered when the interval
ends, so the last state is never lost. `cameraMoveEnded` discards a `cameraMoved` that is still
waiting for its interval.

The host's subscriptions are the union of what each part of the SDK asks for, with the shortest
interval any of them asks for. Applications choose a level and the camera update interval through
the map options.

Camera events carry the camera, a revision and the `reason` for the movement:

- `gesture`: a person moved the map, including map controls and the motion that continues after a
  gesture;
- `api`: the application moved the camera through the SDK, with or without an animation;
- `system`: the SDK moved the camera itself, for example after a layout change or a view mode
  transition.

`themeTransition` reports each phase of a theme change (`preloading`, `applying`, `ready`, `error`)
with the current and target themes; the `ready` phase carries the route inks of the theme on screen.
`themeChanged` still reports the settled theme alone.

## Scene beyond the theme

Requests for the parts of a map that the web SDKs drive through Core's controllers each replace
what the previous request of their kind asked for, so a host can send its whole desired state to a
new renderer:

- `setViewMode` changes between 2D and the declared 3D scene; a `duration` makes the buildings rise
  or descend. The view mode is also part of the options a host replays.
- `setSun`, `setEmphasis` and `setStyleState` reach Core's theme controller and answer its status. An
  emphasis keep area, Boundaries rows (`setBoundaryValues`) and application images (`setImages`, PNG
  or JPEG with optional variants by theme) travel on the data channel. Images the renderer already
  holds, by digest, are neither read nor decoded again.
- `setDepthMarkers` names images by the names given to `setImages`; a marker naming an image the
  renderer does not hold fails the request.
- `getRouteInks` answers the route inks of the theme on screen.

Application layers (`setContent`) may name a route `ink` instead of a colour, a `placement`
(`top` or `ground`), an `occludedOpacity` for a line on the ground, and a line's `progress`.

Animations can outlast a request's timeout. `animateLineProgress` and `playShot` answer with an
animation identifier once the animation starts; the renderer later sends `animationEnded` with the
identifier and whether it finished, and `shotCue` for each cue a shot reaches. These events always
follow the answer that names their animation. `stopAnimation` stops one; a host that gives up on
an animation sends it. One shot plays at a time; a new shot or a person's gesture stops the playing
one. A shot reports its camera movement once, with the reason `api`, rather than once per frame.
Animations end with their renderer generation.

`initialize` also takes `renderer` options fixed for the renderer's lifetime: `antialias` (on by
default) and `validateStyle` (off by default). A host that changes them starts a new generation.

## Errors and warnings

Every error, whether the renderer or the host raises it, has a code from the taxonomy in
`protocol.json`. Each code states whether it is **recoverable** (the same work can succeed later
without the application changing anything) or **terminal** (the application must change its
request or configuration, or the account must change), and which side may raise it. A code that
the renderer is not allowed to send is treated as a renderer fault. A code whose guidance differs by
platform, such as where its configuration lives, carries `documentation.swift` and
`documentation.kotlin` for the generated public enumerations.

Errors carry an optional context: a stable `reason`, the `resource` kind, the resource's `origin`
(scheme, host and port only), the HTTP `status`, the exceeded `limit`, and a developer-facing
`message`. Context never contains a URL path, a query or a credential.

The renderer reports problems in two ways:

- `error` means the map can no longer render in this generation, for example after losing its
  graphics context. The host reports it as a failure.
- `warning` means the map continues, for example after tiles failed to load or the 3D scene could
  not be loaded. Warnings with equal code and context are aggregated: the first is sent at once and
  repeats within `warningWindowMs` (one second) are sent together with their count.

Swift exposes errors as `TileflowMapError` (`code`, `context`, `isRecoverable`), compared by code
so existing matches such as `case .disposed` keep working. Kotlin exposes `TileflowMapException`
with `code` and `context`, and `TileflowErrorCode.isRecoverable`. Both deliver failures as the
`failed` event and warnings as the `warning` event with their number of occurrences.

## Change the protocol

1. Edit `protocol.json`. Raise `version` when a change is incompatible; raise `minimumVersion`
   only when a host may no longer speak an older version.
2. Run `node scripts/mobile-protocol-generate.mjs` and implement the change in the runtime and in
   both hosts.
3. Run the runtime tests, `node scripts/mobile-runtime-smoke.mjs`, the size budget, and the Swift
   and Kotlin suites.
