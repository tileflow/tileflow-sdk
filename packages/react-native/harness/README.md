# Local mounted Map harness

`AdmissionHarness.tsx` is a source-checkout harness for the mounted Tileflow `Map`. It runs only inside an **existing development host**. It creates no server, simulator, cloud resource, runner or build infrastructure. **No native acceptance result** is recorded or implied by these source files.

The harness imports the package root from source and mounts two independent Tileflow Maps inside React `StrictMode`. Each Map therefore exercises the same public component and private source, configuration, session, admission, renderer, camera and readiness ownership used by an application. The harness does not import private admission/session controllers and cannot inspect credentials, grants, native handles or protected request headers.

## Host prerequisites

Use the package's exact peer matrix: React 19.2.0, React Native 0.83.10 and MapLibre React Native 11.3.10, with MapLibre Native Android 13.2.0 or iOS 6.26.0. Autolink the private package in the existing host. On iOS retain the host's React Native and MapLibre CocoaPods/SPM setup and call `tileflow_native_admission_post_install(installer)` after `$MLRN.post_install(installer)`. Do not add another MapLibre Native dependency.

Use the host's existing Metro setup with source-checkout access to this package and its peers. This directory is excluded from package exports and packed files and is not a released consumer example.

Hosted fixture Maps require the application-level native configuration documented in `../docs/native-configuration.md`. Direct/non-session fixture Maps must work without reading that configuration. Never embed a production credential in this harness or its source tree.

## Inputs

Call `createAdmissionHarness()` with three ordinary Tileflow source descriptors:

- `firstSource` and `secondSource` for two simultaneous Maps;
- `replacementSource` for replacement of the first real Map;
- optional initial themes and an optional complete controlled `initialView`;
- a secret-free `observe(event)` callback.

The source descriptors must use explicit manifest URLs. Fixture manifests and their style/TileJSON/resource closure must be served by infrastructure the development host already uses. The harness does not create a server or add an ambient fetch path.

## Controls

The returned `Screen` mounts the two Maps. The remaining controls are deterministic source-checkout seams:

| Control                            | Purpose                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `setFirstTheme(theme)`             | Drive a concrete/system theme transaction on the same mounted Map. A fixture theme may intentionally fail so rollback can be observed.      |
| `updateFirstSource(source)`        | Change the logical source descriptor while keeping the React slot, exercising source replacement ownership.                                 |
| `replaceFirstSource(source)`       | Replace the first React Map instance with a new key and source.                                                                             |
| `setFirstView(view)`               | Drive the controlled camera contract. Gesture callbacks update the same controlled view so post-commit settlement can occur.                |
| `removeFirst()` / `restoreFirst()` | Exercise teardown and remount while the second Map stays live.                                                                              |
| `stop()`                           | Remove the harness snapshot and release its React subscriptions. The host must still unmount `Screen` to await component teardown normally. |

The observer reports only the Map label and bounded public event kind/status. It never receives request URLs, raw native events, exception causes, credential material, grant material or renderer handles.

## Scenarios for local qualification

Use controlled fixture barriers rather than sleeps. At minimum, exercise:

1. two simultaneous Maps with distinct contexts and sessions where applicable;
2. source replacement while manifest, application configuration, bootstrap/context acknowledgement and style preparation are independently held;
3. theme success and theme failure followed by rollback on the same native view;
4. a system-theme appearance change without changing Map identity;
5. controlled camera commands plus real gesture callbacks and the following React commit;
6. readiness ordering where style acceptance, native layout commit and fully rendered frame arrive in different orders;
7. background/resume while bootstrap, style load or native frame evidence is pending;
8. Strict Mode mount/unmount replay and late callbacks after removal;
9. a second Map remaining usable while the first retires or fails cleanup.

For Hosted fixtures, inspect network behavior only in the host's existing test instrumentation: protected requests must carry authority only after exact resource/catalog admission, while foreign resources remain unchanged. The harness itself deliberately has no access to those headers.

## Record execution, not inference

A local receipt should identify the repository commit, host OS/device, resolved dependency versions, commands actually executed, fixture scenario and secret-free assertions. Record missing scenarios and failures explicitly. A visible Map, successful typecheck or source-level test does not by itself prove native lifecycle, packaging, Hosted availability, publication or device acceptance.
