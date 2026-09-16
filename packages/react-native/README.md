# @tileflow/react-native

Pre-release TypeScript contracts, camera/session ownership, appearance adaptation and private native resource admission for Tileflow on React Native.
This is a **private workspace** package. It is not in the publication catalog and does not export a `Map` component.
Its package entry exports types only; importing that entry does not load React Native, MapLibre,
Core's runtime, a renderer, or a network adapter.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Installation in a source checkout

Use this package with the matching Core workspace, not as a published mobile SDK. After installing
the repository dependencies and building Core, the focused checks are:

```sh
pnpm --filter @tileflow/core build
pnpm --filter @tileflow/react-native verify
```

The peer matrix is exact: React **19.2.0**, React Native **0.83.10**, and
`@maplibre/maplibre-react-native` **11.3.10**. Development dependencies use the same versions.
The private transport targets MapLibre Native **13.2.0** on Android and **6.26.0** on iOS.
The package does not establish support for another version, Expo Go, another architecture or an
app-store build. Declaring these peers is not evidence that this package has mounted a native map.

Package builds use the existing TypeScript/tsup conventions. License preparation copies the
repository's Apache-2.0 license at pack time; no native libraries or third-party implementation
sources are vendored. The internal Core dependency follows the workspace protocol used by the
other adapters. This private package consumes source-checkout capabilities, not a promise that an
older published Core release has every declaration used here.

Native autolinking does not install the networking owner. For the required installation order,
Android build integration, iOS CocoaPods/SPM post-install step and execution boundary, read the
[private native admission guide](docs/native-admission.md). The transport is an explicit internal
test seam; it is not reachable through a public runtime export.

## Hosted application configuration

Hosted mobile credentials are native configuration, not an end-user login or
public React API. See the [native configuration guide](docs/native-configuration.md) for exact
iOS/Android setup, origin binding, threat model and rotation.

## Contract pieces

`MapProps` combines `MapBaseProps` (source, presentation, lifecycle callbacks and ref) with the
exclusive camera modes in `MapCameraProps`. These are complete type contracts for that bounded
surface, not a callable `Map`, placeholder component or JSX renderer.

`source` is one `TileflowNativeSource` object: `{map, manifestUrl}`. It selects a named Tileflow
map and requires an explicit manifest URL. It has no renderer discriminator or direct-style mode.
The same Tileflow-only boundary applies to React, Vue and Svelte; only those web bindings retain
their existing optional `manifestUrl` and browser default. Native does not discover a manifest.
A completely unmanaged map uses `@maplibre/maplibre-react-native` directly. Tileflow Map contracts
are not a general MapLibre wrapper API.

Omitted themes use the manifest default. A concrete theme selects that published name; the future
renderer owner supplies the current appearance for `system`. Core's selection rules are unchanged.
Source validation, bounded manifest acquisition, generation ownership and URL policy remain in
[Core's native contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-resource-urls.md).
These public source contracts do not themselves issue network requests.

Presentation uses React `children` and ref types plus React Native's `style` and `testID` types.
Children are opaque React nodes here; this does not introduce a Tileflow annotation or popup API.
Composable MapLibre children do not transfer ownership of the map, style, lifecycle or Hosted
networking away from Tileflow.

`MapOptions` is a positive type allowlist from the pinned MapLibre declaration:
`dragPan`, `touchZoom`, `doubleTapZoom`, `doubleTapHoldZoom`, `touchRotate`, `touchPitch`, `compass`,
`compassHiddenFacingNorth`, and `scaleBar`. It excludes style inputs (`mapStyle`, `styleURL`),
container ownership, interception/headers, view callbacks and all renderer lifecycle callbacks.
It does not re-export MapLibre's full props or ref. These types do not replace runtime validation
by the eventual component.

```ts
import type {MapProps} from '@tileflow/react-native';

const definition = {
  source: {
    map: 'streets',
    manifestUrl: 'https://maps.example.com/tileflow/native/manifest.json',
  },
  theme: 'system',
  initialView: {center: [-3.7038, 40.4168], zoom: 12},
  mapOptions: {dragPan: true, touchZoom: true},
  testID: 'streets-map',
} satisfies MapProps;
```

This is data checked against the declarations, not a map-rendering example.

## Safe source snapshots and ref

`MapRef.getSourceState()` is a synchronous query for the last source snapshot, or `undefined`
before the first source replacement. It must not trigger acquisition or a native command.
It is intentionally narrower than the MapLibre ref: there is no renderer handle, camera setter,
feature query, screenshot method, resource visibility mutation or disposal command.

`MapSourceState` preserves Core's `loading`, `ready` and `error` states and generation number.
Every ready snapshot has the logical map name and a concrete `{name, colorScheme}` theme, without
a renderer discriminator or direct-style state. Error snapshots carry only the existing Core
`code`, `field` and `kind`; the diagnostic `kind` classifies a terminal or cancelled failure.

The internal projection copies and freezes this small diagnostic surface. It never forwards the
manifest, style body, resource URLs, exception instance, message or cause. Source readiness still
means that a source has been resolved; it does not prove that a renderer has loaded it or produced a
frame. A ref is a contract for the later component, not an instantiated object exported today.

## Event types

The declarations distinguish source state, renderer loading, rendered readiness and theme
transitions. None of these renderer events is emitted by a component in this phase.

- `onLoad`: a `load` event for the current generation and safe selection after the renderer accepts
  its style. This is not proof of a fully rendered frame.
- `onError`: either a `source-error` with the existing safe Core diagnostic or a `renderer-error`
  with only its generation. No native event, raw message or remote cause is exposed.
- `onReadinessChange`: a `readiness-change` event with `loading`, `ready` or `error`. Only the
  renderer owner can establish rendered readiness; a resolved manifest cannot do so.
- `onThemeChange`: a `theme-change` event with `preloading`, `applying`, `ready` or `error`.
  A committed `ready` transition requires a concrete current theme.

Theme transitions retain the established distinction between the current and target theme. A
failed selection may have no valid target. Error details use `onError`, not an exception attached
to a theme event. A renderer error does not by itself establish that manifest acquisition failed.
The future renderer owner must discard stale-generation events and own native lifecycle cleanup.

## Internal Appearance adaptation

`native-appearance.ts` binds a small injected broker to React Native's public
`Appearance.getColorScheme()` and `Appearance.addChangeListener()` APIs. It is built for internal
use but is not a package export and is not reachable from the contract entry. It never calls
`Appearance.setColorScheme()`. Private bridges also import React Native; none loads from the package
root.

A broker activates only when selecting `system`. Its first active subscription reads the current
scheme and installs one native listener; concurrent system-theme subscribers share that listener.
Default and concrete themes neither read nor subscribe and cannot be overwritten by an appearance
update.

`light` and `dark` produce a frozen `available` state with that exact scheme. `null`, `undefined`,
`unspecified`, unexpected data or a failed native read produce `unavailable`. No fallback theme is
invented, and a previous dark/light value is not silently retained when the scheme becomes unknown.
The future owner can then preserve Core's explicit missing-scheme diagnostic for system selection.
A subscription failure also remains unavailable rather than pretending to track changes.

Repeated identical states are coalesced. An event received during activation takes precedence over
a stale initial read. Each release function is idempotent; the last release removes the native
listener once, and callbacks from retired subscriptions cannot notify a later activation.
The next activation reads again. Observer exceptions do not own the subscription or prevent other
observers from receiving a current state. The component owner must release its previous subscription
when source/theme ownership changes.

This helper has no manifest acquisition, style switching or source-controller capability. It only
reports appearance to the future owner of those operations.

## Camera ownership

`MapCameraProps` has two mutually exclusive modes, fixed for the lifetime of one real native
instance. In initial mode, `initialView` is an optional partial seed and `view` is forbidden. In
controlled mode, `view` is a complete `MapView` and `onViewChange` is required; `initialView` is
forbidden. Supplying only an `onViewChange` callback in initial mode observes the camera without
making it controlled. Omitting both view props selects initial mode with the shared defaults.

`MapView` is the immutable canonical `{center, zoom, bearing, pitch}` from Core. Coordinates are
`[longitude, latitude]`. Initial composition delegates to `resolveTileflowNativeInitialView()`:
explicit seed values precede the adapter's `mapOptionsView`, then `manifestView`, then shared
defaults. The controller does not interpret native Camera props or duplicate Core's validation.
All controlled values are required, so no missing field can silently use a default.

The seed is applied once. Later valid `initialView` changes are ignored for movement; supplied
invalid views still fail validation rather than corrupting the last valid state. A genuine
unmount/remount creates a new instance and uses its seed again. Source and theme changes do not
reapply the seed or change camera ownership. Controlled `view` remains authoritative; an initial
camera preserves its last live view. Camera activity never changes a source generation or acquires
a manifest.

`onViewChange` receives only a frozen `{type: 'view-change', view}` with a separately owned, frozen
coordinate tuple. It carries no native event, gesture token, renderer ref or source identity.
Repeated equal views are coalesced. Programmatic applications of props do not echo through this
callback. In initial mode the callback is optional and does not cause reconciliation.

In controlled mode, gestures can move the camera according to `mapOptions`. The application should
adopt emitted views by updating its `view` prop. While a gesture is active or awaiting post-gesture
settlement, new controlled values update authority and callbacks without issuing competing commands.
Ending the gesture does not interpret a prop that has not arrived yet as rejection. The owner first
delivers the subsequent committed props, then confirms settlement. If the latest prop equals the
final observed view, no return command is issued; otherwise one command applies that prop value.
Both synchronous adoption and adoption delivered after the callback count before settlement.
Updates received after settlement retain ordinary controlled-update behavior.

No public duration, easing, animation, bounds, padding or imperative camera method is introduced.
The ref remains the source-state query described above.

## Internal camera adapter boundary

`createMapCameraController()` is internal and pure. Its constructor performs no command; `mount()`
validates and applies the initial view once, and `update()` processes subsequent camera props.
Repeated `mount()` calls on that controller behave like updates, not new native instances. The
owner creates one controller per real native view and disposes it when that view is destroyed.
The package does not implement that native owner yet.

The injected `apply({token, view})` returns an immediate cancellation handle and a `finished`
promise. Resolution acknowledges that the target was applied, not merely enqueued. The adapter
must preserve command ordering, honor retirement/cancellation and correlate programmatic
observations with the supplied token through `observeCommand()`. Tokens are opaque instance-local
identities with monotonic sequences; old or foreign tokens are ignored. A command superseded
before its handle is returned is cancelled when the handle arrives. All late promise rejections
are observed, and retired results cannot change live state or report a new failure.

User-driven observations are separate: `startGesture()` returns a token used by `changeGesture()`
and `endGesture()`, each receiving a complete canonical view. End closes that observation epoch
before notifying the parent and leaves settlement pending. Delayed observations from that epoch
cannot change the live view. A new gesture retires pending programmatic work and any older
settlement. The future adapter must classify native callbacks correctly; it cannot treat every
region callback as a gesture or infer origin using a delay. This protocol does not claim that raw
MapLibre events already carry these tokens.

The internal `settleGesture(token)` confirms the prop-delivery boundary for that completed gesture.
The future component owner must retain its token, call `endGesture()`, and arrange a post-callback
React commit opportunity. After React has processed the callback's updates, the owner delivers the
current camera props through `update()` and only then calls `settleGesture()` with the same token.
This confirmation is required even when the parent kept the same props or the final view event was
coalesced. A callback returning, a resolved promise, a microtask or an animation frame does not by
itself establish that React has committed those props. No such scheduling is implemented here.

Settlement compares once, consumes its token before dispatching any command, and never emits an
additional `onViewChange`. Repeated, foreign or retired confirmations are no-ops. A confirmation
inside that gesture's final notification is ignored; the owner must confirm after prop delivery.
A new gesture, explicit style restoration or disposal retires the pending confirmation, including
when it happens reentrantly during the final callback. If the owner never confirms, controlled
reconciliation remains pending rather than guessing a timeout. In initial mode confirmation just
retires the pending token and preserves the live view. This method is not a public prop or ref API.

After replacing a style/source on the same native view, the owner calls the internal
`restoreAfterStyleChange()`. It reaffirms the latest controlled prop or last uncontrolled live view,
never the original seed. This explicit call retires the old observation epoch and settlement and
emits a command even when the stored view is equal, because the renderer may have reset its camera.
It neither accepts source data nor touches source/theme selection. No public set-camera escape
hatch exists.

Input failures throw an internal `CameraControllerError` with a fixed code and message. Codes are
`CAMERA_INPUT_INVALID`, `CAMERA_MODE_CHANGE`, `CAMERA_NOT_MOUNTED` and `CAMERA_DISPOSED`. Failed active
commands report only `CAMERA_COMMAND_FAILED` to the injected owner callback. There are no caller
values, native messages or remote causes. Failed updates preserve the last valid mode, view and
observer. This unit does not convert these internal diagnostics into a new public `onError` event.
The future owner must handle them at its existing lifecycle boundary.

Disposal is idempotent and cancels the active command. Late observations, completions, settlement
confirmations and style restoration callbacks are ignored. Further explicit `mount()`/`update()`
calls fail safely.
Observer exceptions and reentrant updates/disposal cannot publish an obsolete result, block cleanup
or start an echo loop. No timers, subscriptions, source acquisition or native imports are owned by
the camera controller.

## Internal Hosted sessions and native admission

`createHostedNativeSessionController()` is internal, not a package export or public Hosted client.
One real Map context owns one controller. Non-session transport bindings never bootstrap or acquire
Tileflow authority; concurrent Hosted Maps never share session identities, counters, tickets or callbacks.

The controller is the sole admission authority. Every eligible protected ticket receives one
logical `acquire()` result; bounded bridge batching does not change accounting. The 10,000-request
and six-hour rotation boundary, single-flight refresh, strict bootstrap response validation,
Surface continuity and secret-free controller snapshots remain in that controller. Its conservative
transport budget uses the existing local validity deadline rather than inventing a fresh lifetime.

The private native adapter now supplies independent context-bound bootstrap, asynchronous ticket
admission, cancellation and ownership-aware MapLibre networking. Android wraps the previous
`ModuleProvider`/`HttpRequest`; iOS uses a MapLibre-scoped `NSURLProtocol` and an independent
`URLSession`. Unowned traffic delegates without Tileflow authority. Only the reserved non-secret
context discriminator is removed before HTTP; the native grant is carried only in
`X-Tileflow-Native-Grant`, after exact resource, origin, port, class and tileset checks.

Installation and retirement must be explicitly awaited. Native expiry and liveness checks occur
before network start and each permitted same-origin redirect. Backgrounding, replacement, disposal
and ownership loss invalidate pending work; late completions cannot revive it. Observing a response
does not confirm or undo server-owned commercial completion.

This is a test-only exact-resource catalog, not automatic style/TileJSON closure projection.
The later public renderer must supply the complete owned resource graph and real Map lifecycle.
There is still no component, hook, public Hosted client or runtime API. Read the
[private native admission guide](docs/native-admission.md) for installation order, fixed limits,
security/lifecycle details, native dependencies, and the explicit source-checkout harness.

## Validation boundary

The authored tests cover the type-only entry, exact peers/private status, isolated appearance
lifecycle, safe source projection, camera ownership, real-controller admission accounting,
bootstrap wire lifecycle, native engine/provider/protocol behavior and actual packed contents.
Compile-only consumers reject mixed camera modes, incomplete controlled views and owned props.
Clocks, bridge barriers and native schedulers are injected for deterministic concurrency tests;
those tests do not replace a real RN bridge and renderer.

The source-checkout harness mounts upstream MapLibre Maps through the real private admission bridge
in an existing development host. It is not a public Tileflow renderer and is excluded from package
exports and packed files. No test source, build pin or harness file is evidence that native checks
have run or passed. Build/type/package checks, Android tests, CocoaPods/SPM resolution, XCTest and
Hermes/device qualification remain required before acceptance. No Expo plugin, production Metro
configuration, full renderer readiness, mobile service availability or app-store support is implied.
