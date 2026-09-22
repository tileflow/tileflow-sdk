# @tileflow/react-native

`@tileflow/react-native` is a private workspace package for the first mounted Tileflow React Native `Map`. It is pre-release and not listed in the public release catalog. The package targets exactly React 19.2.0, React Native 0.83.10 and `@maplibre/maplibre-react-native` 11.3.10, with MapLibre Native Android 13.2.0 and iOS 6.26.0 through the pinned integration described below.

The package exports a mounted `Map` and its public types from the ordinary package root. Importing the package does not install native networking, read application configuration, create a Map, start a session, acquire admission, schedule timers or perform network I/O. Those effects begin only inside a mounted component lifecycle.

Tileflow `Map` is **Tileflow-only**. Its `source` is the existing Tileflow descriptor object:

```tsx
import {Map} from '@tileflow/react-native';

export function StoreMap() {
  return (
    <Map
      source={{
        map: 'stores',
        manifestUrl: 'https://maps.example.com/tileflow/manifest.json',
      }}
      theme="light"
      style={{flex: 1}}
      testID="store-map"
    />
  );
}
```

There is no public renderer discriminator, arbitrary `mapStyle`, credential prop, Hosted client, Provider, admission API, native handle or MapLibre ref. An application that needs a wholly unmanaged MapLibre map should use `@maplibre/maplibre-react-native` directly.

## Mounted ownership

One mounted Tileflow `Map` owns one current source generation, one private Hosted binding/session/controller when required, one native admission context and one upstream MapLibre Map. Multiple mounted Maps may share only the acknowledged process-level networking installation; they never share contexts, sessions, grants, generations, abort state, callbacks or renderer ownership.

The upstream native Map is not created until the source is resolved and its private admission context has been acknowledged. Hosted session delivery also requires the application configuration and bootstrap path to be ready. Non-session sources do not read mobile application configuration or acquire Hosted authority.

Changing a theme keeps the same native Map, context and session. Replacing the logical source retires the previous owner before the replacement can open another context. Ordinary changes to callback identity, `children`, `style`, `testID` or unchanged semantic props do not recreate the source/session/native owner.

Application-owned MapLibre children that are valid children of the upstream Map remain composable. Tileflow still owns the Map style, networking, camera lifecycle callbacks and readiness callbacks.

## Source and theme

Native sources keep the explicit shape:

```ts
{
  map: 'stores',
  manifestUrl: 'https://maps.example.com/tileflow/manifest.json',
}
```

There is no implicit native manifest discovery. `theme` accepts one concrete published theme or `system`. A `system` selection subscribes to React Native Appearance only while that selection is mounted. Theme application is transactional: a new concrete style is prepared and applied on the same Map, becomes current only after native readiness, and attempts to restore the previous accepted style if the replacement fails.

`onThemeChange` reports only the safe public selection shape. It does not expose style URLs, style JSON, configuration, session authority or native error messages.

## Camera

The existing mount-stable camera contract is preserved. Use either an initial camera seed or complete controlled camera ownership for the lifetime of one mounted Map:

```tsx
<Map source={source} initialView={{center: [-9.14, 38.72], zoom: 11}} />
```

or:

```tsx
<Map
  source={source}
  view={{center, zoom, bearing, pitch}}
  onViewChange={(event) => setView(event.view)}
/>
```

Controlled mode requires a complete view and `onViewChange`. Programmatic camera operations are private. Native command receipts are correlated internally and are not inferred from delayed region callbacks. Gesture changes are the only camera changes emitted publicly; their controlled settlement occurs after the subsequent React commit. Theme/style restoration preserves the current camera owner.

No public imperative camera API or raw upstream Map ref is exported.

## Readiness

`onLoad` means that the current native style was accepted for the mounted generation. It is not a rendered-frame receipt.

`onReadinessChange({status: 'ready'})` requires all of the following for the current generation:

- current native style acceptance;
- a committed positive native layout/view barrier;
- a fully rendered native map/frame after that barrier;
- foreground lifecycle state.

Readiness is invalidated by source/style transactions, layout changes, camera gesture/command epochs and backgrounding. Resume requires fresh native evidence; JavaScript animation frames, sleeps and arbitrary timers are not readiness proof.

## Bounded resource preparation

Before native rendering, the mounted owner prepares a bounded closure for the current style. It covers the owned style document, one TileJSON edge per tile source, tile templates, sprite leaves, glyph templates, native-v1 managed font faces and supported base-asset URLs represented by the accepted contracts.

Relative URLs are resolved with Core's native URL policy. Protected resources are appended to the per-Map admission catalog only after native acknowledgement. Resource scope and tileset identity are preserved. Foreign/unowned resources are left unchanged and never receive Tileflow authority. Recursive, ambiguous, oversized or dynamically unbounded protected graphs fail closed.

Glyph templates use a finite set of exact font-stack expansions. A later theme may extend that same template only through an acknowledged append-only finite union; it cannot change the resource scope, origin or identity.

See [Private native resource admission](./docs/native-admission.md) for the transport and security boundaries.

## Hosted mobile application configuration

Hosted native session delivery uses a scoped, revocable, publishable **mobile application credential** configured once in the native application. It authenticates the distributed application, not its end user. The manifest supplies `mapId`, `apiUrl` and `usageMode`; Tileflow requires the manifest API origin to exactly match the configured canonical HTTPS origin before bootstrap.

There is intentionally no credential prop, JS setter, Provider, client object, package-name/bundle-ID authentication or attestation path in this version.

See [Native application configuration](./docs/native-configuration.md) for the exact Android resource and iOS Info.plist keys, credential grammar, origin normalization, rotation/revocation guidance and threat model.

## Map options and presentation

The public `mapOptions` object remains a positive allowlist. It includes the currently supported gesture/control options only. Style inputs, request transformation, headers and upstream lifecycle callbacks remain owned by Tileflow. Runtime validation rejects forged extra keys without reflecting their values.

React Native `style`, `testID` and React children are preserved as presentation/composition inputs and do not become semantic source identity.

## Safe events and ref

The public lifecycle surface remains:

- `onLoad`;
- `onError`;
- `onReadinessChange`;
- `onThemeChange`;
- controlled `onViewChange`;
- `ref.getSourceState()`.

`getSourceState()` returns only the last safe projected source snapshot. Errors use existing bounded codes/fields/kinds. No URL, response body, native event, credential, grant, session object, native handle or raw cause enters public callbacks, refs or serializable state.

## Native integration

Autolinking registers the private Android/iOS modules used by the mounted lifecycle. Android depends on the exact MapLibre React Native project and MapLibre Native 13.2.0. iOS uses the existing MapLibre React Native CocoaPod plus the exact MapLibre Native 6.26.0 Swift Package Manager product.

For the iOS post-install integration, retain the host's normal React Native/MapLibre setup and then call:

```ruby
$MLRN.post_install(installer)
tileflow_native_admission_post_install(installer)
```

Do not add a second MapLibre Native CocoaPod. See [Private native resource admission](./docs/native-admission.md) for installation-order and teardown details.

## Source-checkout harness

`harness/AdmissionHarness.tsx` mounts the real public Tileflow `Map` in an existing development host, including two simultaneous Maps under React `StrictMode`. It provides deterministic source-checkout controls for source replacement, theme transactions, controlled camera updates and teardown. The harness is excluded from exports and packed files and creates no service or runner. See [the harness guide](./harness/README.md).

## Interactions and markers

`Map` accepts portable `annotations`, semantic `interactions`, activation and diagnostic callbacks,
and an optional marker renderer. Annotation data stays typed through a generic `Map`:

```tsx
<Map
  source={source}
  annotations={places}
  interactions={bindings}
  onInteractionEvent={(event) => {
    selectPlace(event.target);
  }}
  renderMarker={({annotation}) => <PlaceMarker place={annotation.data} />}
/>
```

Tileflow owns each stable native marker host, its coordinate, touch activation and accessibility
wrapper. A bounded accessible marker is rendered when `renderMarker` is omitted. Large feature sets
remain in native vector or GeoJSON layers and are selected through semantic rendered-feature
queries rather than thousands of React marker views.

The application owns persistent selection and its presentation. The SDK emits normalized
annotation or POI targets but no popup, callout, tooltip, sheet, panel or modal renderer. See
[Native interaction contract](./docs/native-interactions.md).

## Current boundary

The mounted component does not add location, selection-presentation UI, offline product APIs, an
Expo config plugin, CLI behavior, deployment or publication. The package remains private and
pre-release.

Source and tests describe contracts; they do not establish that a native build, simulator/device run, Hosted service, app-store submission or package publication succeeded. Qualify the exact source revision in the intended host before relying on it.

## Foreground location is application-owned

`Map` does not request location permission, start a provider, track the device or recenter when a
fix arrives. Applications can compose a validated foreground fix through the existing accessible
annotation and controlled-camera contracts while keeping permission, provider lifetime, privacy
policy, status UI and recenter controls outside Tileflow.

See [Application-owned foreground location](./docs/native-location.md) for the package-owned
source-checkout recipe. The recipe is excluded from package exports and packed runtime files and
imports no concrete location provider.
