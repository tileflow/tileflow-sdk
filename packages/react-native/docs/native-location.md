# Application-owned foreground location

`@tileflow/react-native` does not own device location. A Tileflow `Map` renders normally without a
location permission, provider, hook or native location module. The application decides whether to
request foreground permission, which provider to use, when observation starts and stops, what fix is
displayed, whether recentering is offered, and what status or error UI is appropriate.

This guide describes a source-checkout recipe built only from the existing public `Map`, controlled
camera and annotation contracts. It is not a new Tileflow runtime API and it does not add a location
provider to the package.

## Boundary

The package deliberately does not provide any of the following:

- a Tileflow location component, hook, provider or permission API;
- an iOS or Android location permission declaration;
- a dependency on Expo Location, a geolocation package or another location provider;
- a background task, background permission or location-history store;
- a credential/session field for device location;
- a location analytics event or precise-coordinate telemetry path;
- a GeoIP fallback for device location;
- implicit permission requests or tracking when `Map` mounts.

The application must configure any native permission strings, manifest entries and provider setup
required by the provider it chooses. Those application settings are separate from Tileflow's native
Hosted credential configuration.

## Source-checkout recipe

`../harness/ForegroundLocationExample.tsx` is a compile-only example owned by this package. Its
provider boundary is injected:

```ts
export type ApplicationForegroundLocationAdapter = Readonly<{
  requestPermission(): Promise<
    'granted-precise' | 'granted-approximate' | 'denied' | 'unavailable'
  >;
  observe(listener: (update: ApplicationLocationObservation) => void): () => void;
}>;
```

No concrete provider is imported. The adapter is application code: it translates the provider's
permission and foreground observation APIs into this small recipe-specific shape. The example and
its state helper live under `harness/`, are absent from package exports, and are excluded from
packed runtime files.

## Explicit application state

The recipe models these states without unmounting the Map:

| State                 | Meaning                                                      | Location annotation          |
| --------------------- | ------------------------------------------------------------ | ---------------------------- |
| `idle`                | The application has not requested permission.                | none                         |
| `requesting`          | An explicit application action started a permission request. | none                         |
| `granted-precise`     | Foreground policy allows precise observation.                | one marker after a valid fix |
| `granted-approximate` | Foreground policy allows approximate observation.            | one marker after a valid fix |
| `denied`              | The permission request was denied.                           | none                         |
| `unavailable`         | Permission/provider setup failed or emitted invalid data.    | none                         |
| `revoked`             | A previously granted observation reported revocation.        | removed immediately          |

Construction is inert: it neither requests permission nor starts observation. The example's **Use
my location** control is the only permission-request trigger. A rejected provider promise is reduced
to the application-level `unavailable` state; raw provider exceptions are not forwarded into Map
props or Tileflow callbacks.

## Validate before Map props

The adapter output is treated as untrusted runtime data even though the TypeScript adapter is typed.
The recipe accepts only a plain record with exactly `longitude`, `latitude` and `accuracy` data
properties. Longitude must be finite and within `[-180, 180]`, latitude finite and within
`[-90, 90]`, and accuracy finite and nonnegative. Accessors, extra provider fields, invalid
prototypes and non-finite values fail closed.

Only a validated fix is converted to an annotation:

```ts
{
  id: 'application-foreground-location',
  kind: 'marker',
  ariaLabel: 'Current location',
  coordinate: [longitude, latitude],
  data: {accuracyMeters: accuracy, precision: 'precise'},
}
```

Approximate permission uses the same stable ID and an `Approximate current location` label. The
stable ID lets the existing annotation reconciler update one marker host instead of recreating a
new marker for every fix. Revocation, denial or provider failure removes the annotation by returning
an empty annotation collection.

The marker uses the existing accessible Tileflow annotation wrapper. This recipe does not add a
location-specific native marker component.

## Foreground observation lifetime

Observation starts only when both conditions are true:

1. the application is in the foreground; and
2. its current permission state is `granted-precise` or `granted-approximate`.

`AppState` is application-side orchestration in the example. Moving to background synchronously
retires the current observation token and calls the provider cleanup. Returning to foreground
starts a new observation only if the last application permission policy still allows it. Denied,
revoked and unavailable states do not restart observation automatically.

The React effect owns a replayable `mount()` epoch. Its cleanup immediately retires the current
observation and any pending permission/provider callback without terminally disposing the
controller. A StrictMode setup replay may therefore mount the same controller again; if the retained
settled permission state is granted and the application is foregrounded, observation restarts
without another permission prompt. If cleanup interrupted an in-flight permission request, that
request is retired and the last settled application state is restored instead of accepting its late
result. A real unmount or adapter replacement uses the same cleanup boundary, so late callbacks are
inert even though no timing heuristic distinguishes them from a replay. The recipe does not persist
fixes or observation history.

`dispose()` remains a separate terminal operation for an owner that will never mount again. The
React example does not use terminal disposal for ordinary effect cleanup.

## Recenter is explicit

A new fix changes only the application-owned annotation. It does **not** change camera state.

The example keeps the existing complete controlled `Map` view. An explicit **Recenter** action copies
the latest validated coordinate into that controlled view while preserving zoom, bearing and pitch.
The recipe uses no camera animation API or duration, so it introduces no animated movement for
reduced-motion users. Applications that later add their own animated camera affordance must apply
their own reduced-motion policy before doing so.

Gestures continue to update the same controlled view through `onViewChange`; receiving another
location fix never overwrites that user-driven camera state.

## Privacy and product scope

The sample keeps only the latest in-memory fix needed for its marker. It does not store history,
send coordinates to analytics, derive a device fix from GeoIP, start background tracking or attach
location to Tileflow sessions/admission. Status and error presentation are application UI.

Location also does not change the interaction presentation boundary. Tileflow annotations and
semantic targets remain primitives and data; the application still owns any popup, callout,
tooltip, sheet, panel, modal or other selection presentation.

## Qualification

The source files describe the intended application contract; they are not evidence that a provider,
permission prompt, simulator/device scenario, native build, package publication or Hosted service
was executed. Typecheck the source-checkout harness and qualify the chosen provider in the
application that owns its permission and privacy policy.
