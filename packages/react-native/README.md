# @tileflow/react-native

Pre-release TypeScript contracts and internal appearance adaptation for Tileflow on React Native.
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

`MapBaseProps` combines the required source, optional theme, presentation, event callbacks and
ref type. It is a base contract, **not a complete `MapProps` interface**. There is no callable
`Map`, placeholder component or JSX renderer in this package.

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
import type {MapBaseProps} from '@tileflow/react-native';

const definition = {
  source: {
    kind: 'tileflow',
    map: 'streets',
    manifestUrl: 'https://maps.example.com/tileflow/native/manifest.json',
  },
  theme: 'system',
  mapOptions: {dragPan: true, touchZoom: true},
  testID: 'streets-map',
} satisfies MapBaseProps;
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

| Callback | Contract |
| --- | --- |
| `onLoad` | A `load` event for the current generation and safe selection after the renderer accepts its style. This is not proof of a fully rendered frame. |
| `onError` | Either a `source-error` with the existing safe Core diagnostic or a `renderer-error` with only its generation. No native event, raw message or remote cause is exposed. |
| `onReadinessChange` | A `readiness-change` event with `loading`, `ready` or `error`. Only the renderer owner can establish rendered readiness; a resolved manifest cannot do so. |
| `onThemeChange` | A `theme-change` event with `preloading`, `applying`, `ready` or `error`. A committed `ready` transition requires a concrete current theme. |

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

## Portable view composition boundary

`MapView` and `MapInitialViewInputs` alias Core's immutable resolved view and composition inputs.
The internal `resolveMapInitialView()` delegates directly to `resolveTileflowNativeInitialView()`:
explicit `view` values take precedence over `mapOptionsView`, then `manifestView`, then the shared
defaults. Coordinate order, validation, errors and tuple cloning are unchanged.

These are renderer-neutral data types, not native Camera props. Initial-versus-controlled camera
ownership is not part of `MapBaseProps`: no `initialView`, controlled `view`, camera-change callback
or imperative camera method is frozen by this package. Gesture reconciliation, source changes and
switching ownership require a separate component contract. This does not affect the independent
source, appearance or initial-view composition helpers implemented here.

## Validation boundary

The tests cover the type-only entry, exact peers/private status, isolated appearance lifecycle,
safe source projection, delegated view composition and package graph boundaries. Compile-only
consumers use the built public declarations and reject owned props/lifecycle callbacks. The
standalone entry test installs global traps and has no installed mobile peers.

These checks do not run a native renderer or establish Hermes/device acceptance for a React Native
component. This package supplies no Swift/Kotlin bridge, Expo plugin, Metro configuration, transport,
Hosted client, sessions, annotations, location, screenshots or UI. Full renderer readiness and mobile
service availability are not implied by this contract foundation.
