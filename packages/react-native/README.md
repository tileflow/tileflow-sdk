# @tileflow/react-native

Pre-release TypeScript contracts, camera/session ownership and internal appearance adaptation for Tileflow on React Native.
This is a **private workspace** package. It is not in the publication catalog and does not export a `Map` component.
Its package entry exports types only; importing that entry does not load React Native, MapLibre,
Core's runtime, a renderer, or a network adapter.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Work in the source checkout

Use this package with the matching Core workspace, not as a published mobile SDK. After installing
the repository dependencies and building Core, the focused checks are:

```sh
pnpm --filter @tileflow/core build
pnpm --filter @tileflow/react-native verify
```

The initial peer matrix is exact: React **19.2.0**, React Native **0.83.10**, and
`@maplibre/maplibre-react-native` **11.3.10**. Development dependencies use the same versions.
The package does not establish support for another version, Expo Go, another architecture or an
app-store build. Declaring these peers is not evidence that this package has mounted a native map.

Package builds use the existing TypeScript/tsup conventions. License preparation copies the
repository's Apache-2.0 license at pack time; no native libraries or third-party implementation
sources are vendored. The internal Core dependency follows the workspace protocol used by the
other adapters. This private package consumes source-checkout capabilities, not a promise that an
older published Core release has every declaration used here.

## Contract pieces

`MapProps` combines `MapBaseProps` (source, presentation, lifecycle callbacks and ref) with the
exclusive camera modes in `MapCameraProps`. These are complete type contracts for that bounded
surface, not a callable `Map`, placeholder component or JSX renderer.

The source is the existing `TileflowNativeSource` union:

- `{kind: 'tileflow', map, manifestUrl}` requires an explicit manifest URL and accepts an optional
  concrete theme or `system`.
- `{kind: 'maplibre', style}` accepts the existing direct style URL/JSON type and rejects `theme`.
  It remains unmanaged and has no manifest or Tileflow theme identity.

Omitted Tileflow themes use the manifest default. The future renderer owner supplies the current
appearance for `system`; Core's selection rules are unchanged. Source validation, bounded manifest
acquisition, generation ownership and URL policy remain in
[Core's native contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-resource-urls.md).
This package does not add an acquisition adapter or issue requests.

Presentation uses React `children` and ref types plus React Native's `style` and `testID` types.
Children are opaque React nodes here; this does not introduce a Tileflow annotation or popup API.

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
    kind: 'tileflow',
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
A ready Tileflow snapshot has `kind: 'tileflow'`, the logical map name and a concrete
`{name, colorScheme}` theme. A direct ready snapshot has `kind: 'maplibre'` and does not invent those
fields. Error snapshots carry only the existing Core `code`, `field` and `kind`.

The internal projection copies and freezes this small diagnostic surface. It never forwards the
manifest, style body, resource URLs, exception instance, message or cause. Source readiness still
means that a source has been resolved; it does not prove that a renderer has loaded it or produced a
frame. A ref is a contract for the later component, not an instantiated object exported today.

## Event types

The declarations distinguish source state, renderer loading, rendered readiness and theme
transitions. None of these renderer events is emitted by a component in this phase.

| Callback            | Contract                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onLoad`            | A `load` event for the current generation and safe selection after the renderer accepts its style. This is not proof of a fully rendered frame.                         |
| `onError`           | Either a `source-error` with the existing safe Core diagnostic or a `renderer-error` with only its generation. No native event, raw message or remote cause is exposed. |
| `onReadinessChange` | A `readiness-change` event with `loading`, `ready` or `error`. Only the renderer owner can establish rendered readiness; a resolved manifest cannot do so.              |
| `onThemeChange`     | A `theme-change` event with `preloading`, `applying`, `ready` or `error`. A committed `ready` transition requires a concrete current theme.                             |

Theme transitions retain the established distinction between the current and target theme. A
failed selection may have no valid target. Error details use `onError`, not an exception attached
to a theme event. A renderer error does not by itself establish that manifest acquisition failed.
The future renderer owner must discard stale-generation events and own native lifecycle cleanup.

## Internal Appearance adaptation

`native-appearance.ts` is the only module with a React Native value import. It binds a small
injected broker to the public `Appearance.getColorScheme()` and `Appearance.addChangeListener()`
APIs. It is built for internal use but is not a package export and is not reachable from the
contract entry. It never calls `Appearance.setColorScheme()`.

A broker activates only for a Tileflow source selecting `system`. Its first active subscription
reads the current scheme and installs one native listener; concurrent system-theme subscribers
share that listener. Default/concrete themes and direct MapLibre sources neither read nor
subscribe and cannot be overwritten by an appearance update.

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

## Internal Hosted session state

`createHostedNativeSessionController()` is an internal build artifact for the future owner of one
real native Map instance. It is not a package export or a public Hosted client. Direct/unmanaged
MapLibre bindings return no Tileflow authority and never bootstrap a session. A Hosted binding owns
one session identity; separate controller instances never share that identity, counters or work.

The controller receives its fetch adapter, clock and session-ID factory as dependencies. Bootstrap
posts only `mapId`, `sessionId` and normalized `surfaceId` to the trusted canonical HTTPS API origin,
using `X-Tileflow-Mobile-Client` for the exact publishable credential. It adds no query authority,
Origin, Referer, Authorization, Cookie or browser attribution. The response is streamed and bounded
to 65,536 actual UTF-8 bytes, must be `201`/`no-store`, and is rejected unless its native bindings,
server times, resource origins/scopes and tileset inventory satisfy the bounded server contract.

`acquire()` is the internal transport-facing barrier. Bootstrap and refresh work is single-flight,
refresh preserves the session and server-returned Surface, and only the exact commercial restart
response may replace the session once. Six-hour and 10,000-eligible-request rotation is evaluated
at this acquisition boundary before authority is returned. Backgrounding does not create a new
session; resume and every acquisition re-evaluate lifetime and rotation without depending on a
timer firing while JavaScript is suspended. Server time bounds grant lifetime, and a detected local
clock rollback forces fresh authority rather than extending an existing grant.

The sensitive native grant is available only on the internal authority returned to the future
transport, where it will be carried as `X-Tileflow-Native-Grant`. Its property is non-enumerable so
ordinary serialization does not copy it. Observable controller state and subscriber callbacks are
frozen diagnostic snapshots containing only status, stable error code/kind and non-secret
identities; they contain no credential, grant, resource URL, raw response or native exception.
Replacement and disposal abort owned work, disposal is idempotent, and late completions cannot
revive retired state.

This unit does not install the grant on renderer requests. It adds no Map component, hook, MapLibre
import, request interceptor, URL rewrite, Swift/Kotlin bridge, annotation/UI surface or public
`createTileflowMobileClient` API. Per-map transport ownership and native renderer integration remain
separate qualification work.

## Validation boundary

The tests cover the type-only entry, exact peers/private status, isolated appearance lifecycle,
safe source projection, delegated view composition, camera ownership, internal Hosted session
state and package graph boundaries. Compile-only consumers use the built public declarations and
reject mixed camera modes, incomplete controlled views and owned props/lifecycle callbacks. Camera
command promises, prop delivery and observations are injected; session fetch, clock and identity
inputs are also injected so lifecycle, rotation, cancellation and adversarial response behavior can
be deterministic without timer-based tests.

These checks do not run a native renderer or establish Hermes/device acceptance for a React Native
component. This package supplies no Swift/Kotlin bridge, Expo plugin, Metro configuration, native
transport/interceptor, public Hosted client, annotations, location, screenshots or UI. Full renderer
readiness and mobile service availability are not implied by this contract foundation.
