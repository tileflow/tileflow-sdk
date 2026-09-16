# Local native admission harness

`AdmissionHarness.tsx` is the smallest source-checkout harness for the real TypeScript controller, RN native bridge and upstream MapLibre networking seam. It must run in an **existing development host**, not in Node, Expo Go or a generated remote runner. It creates no server, cloud resource, simulator or build infrastructure. **No native acceptance result** is recorded or implied by these source files.

## Host prerequisites

Use React 19.2.0, React Native 0.83.10, MapLibre React Native 11.3.10, Android Native 13.2.0 or iOS Native 6.26.0, and the matching built Core workspace. Autolink the private package. On iOS retain the host's React Native and MapLibre CocoaPods setup and call `tileflow_native_admission_post_install(installer)` after `$MLRN.post_install(installer)`; enable the pod's `Admission` test specification in the test host. Do not add a second MapLibre Native CocoaPod.

Use the host's existing Metro configuration with source-checkout access to this package and its peers. The harness imports `../src` deliberately. It is excluded from the npm pack allowlist and public exports and is not a consumer example for a released package. Typecheck it separately with the local compiler against `harness/tsconfig.json` before attempting a native build.

Initialize upstream MapLibre and prior compatible customization before invoking the harness, but do not create a Map view, offline store or cached MapLibre session first. Start from a cold app launch rather than a hot reload. The explicit install acknowledgement must precede rendering `Screen`.

## Existing fixture inputs

Supply `createAdmissionHarness()` with a Hosted `binding`, `styleUrl`, a distinct `alternateStyleUrl`, `thirdPartyStyleUrl`, and an `observe(event)` callback. Obtain the binding and fixture endpoints from the local orchestrator's already available test environment. Do not embed production credentials, create new services or disable TLS validation for this harness.

Both protected style URLs must be exact canonical HTTPS resources approved by the test binding's style scope. The third-party URL must be on a separate origin and contain no Tileflow discriminator or authority. Use styles with no child resource URLs; this unit does not project their closure. For example, each fixture can return a self-contained style of this form:

```json
{
  "version": 8,
  "sources": {},
  "layers": [{"id": "background", "type": "background"}]
}
```

The two protected Maps intentionally request the same original style URL. Their transient discriminators differ and are stripped before HTTP. The third-party Map requests its original URL unchanged. The native bootstrap must use the independent channel, without a grant header or resource interception.

## Drive the harness explicitly

Call and await `createAdmissionHarness(input)` from the host's existing development entry, outside React render/effects. Register or render its returned `Screen` in the host using the host's existing application registration name. Do not construct the owner in an effect that React development checks may tear down and replay.

The returned controls are private harness operations:

| Control              | Expected operation to qualify                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `Screen`             | Mounts two protected upstream Maps and one third-party Map.                                           |
| `changeFirstStyle()` | Switches between the two approved fixture URLs while retaining the first Map's React key and context. |
| `retireFirst()`      | Awaits native retirement of the first context and removes its view; the second remains independent.   |
| `replaceFirst()`     | Retires the old context, opens a new one and changes the React key for the replacement real Map.      |
| `stop()`             | Removes the views, disposes the owner and returns the native removal/ownership-loss acknowledgement.  |

Await `stop()` before unmounting the harness or ending the local run. A React unmount alone is not its asynchronous teardown acknowledgement. Repeated calls return the same stop promise. A style-ready callback means that MapLibre loaded the style; it is not a commercial receipt or proof of a rendered frame.

The observer receives only a Map label, a bounded kind and, for owned HTTP observations, a status code. Never attach the full input, native event, request, headers, exception, bootstrap reply or authority to a result report. Record fixture assertions such as `grantPresent`, `contextRemoved` and `thirdPartyUnchanged`, not credential or grant values.

## Required runtime scenarios

First establish the baseline with cold caches: two independent session/controller identities for the protected Maps, matching original URLs at the fixture, the exact grant header on eligible protected requests, and no grant or discriminator on the third-party request. Verify both native response observation and MapLibre style completion rather than treating either as a substitute for the other.

Use existing fixture barriers to hold bootstrap or resource completion while retiring/replacing a context. Release the barrier afterwards and verify that the first Map has no late callback and that the second still completes. Exercise retirement before queue drain, during JS acquisition, after admission and during native completion; deterministic engine tests cover the scheduling boundaries the renderer does not expose directly.

Pause JavaScript while protected native work is waiting, then background/resume the app. No protected request may start with authority whose conservative deadline has passed. Resume must revalidate rather than depend on a JavaScript timeout. Use the deterministic controller/batch tests for the 9,999/10,000/10,001 and six-hour boundaries; do not wait six hours or add sleeps to those tests.

Exercise same-origin redirects to another cataloged resource, an uncataloged path, a conflicting context, another port and another origin. Record that unsafe targets receive no forwarded grant. In a dedicated native test invocation, replace the installed provider/configuration and check that removal preserves the replacement and reports ownership loss. Restart the host afterwards; the contract does not support arbitrary mutation chains.

Run the Android provider/engine/bootstrap/lease tests and the iOS engine/protocol/bootstrap/rollback tests in addition to this harness. Qualify cancellation churn and native memory cleanup with held native callbacks, not merely successful promise rejection. Inspect the actual packed package and an isolated root import separately; a successful harness does not prove packaging or publication safety.

## Record execution, not inference

A local receipt should identify the repository commit, host OS/device, resolved dependency versions, exact commands actually executed, fixture scenario and secret-free assertions. Record failures and missing scenarios explicitly. Do not mark tests, builds, CI, native integration or product acceptance as passed because source exists, a typecheck succeeds or a Map becomes visible.
