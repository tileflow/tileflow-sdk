# Private native resource admission

This guide describes the source-checkout transport in `@tileflow/react-native`. It is **not a public API** or a published Hosted client. The package stays private; its root runtime exports nothing and installs no networking. There is no Tileflow `Map` component, hook, renderer lifecycle owner, annotation API or location API.

The internal transport supports already context-discriminated requests with a small, explicit resource catalog. **Full style/TileJSON closure projection** is not implemented. A remote style's child URLs are not automatically discovered, rewritten or authorized. Do not point an application at an arbitrary Hosted style and assume this unit protects the entire resource graph.

## Exact native dependencies

The source targets React 19.2.0, React Native 0.83.10, MapLibre React Native 11.3.10, MapLibre Native Android 13.2.0 and MapLibre Native iOS 6.26.0. Android's HTTP dependency is OkHttp 4.12.0. These pins and the existence of source tests are **not evidence** of a successful build, a mounted device Map or app-store acceptance. The local host must qualify this exact combination.

Android's library build uses the host's Android Gradle and Kotlin plugins, Java 17, and the host's SDK settings. It does not install a build system. `react-native.config.cjs` identifies `TileflowNativeAdmissionPackage` for autolinking; creating the module does not install the MapLibre provider. A conflicting native dependency version fails resolution instead of silently selecting another version.

On iOS, the `TileflowNativeAdmission` pod depends on the exact React and MapLibre React Native pods. MapLibre Native itself is the **existing pinned Swift Package Manager product**, not a second MapLibre CocoaPod. The deployment target is React Native 0.83.10's minimum, iOS 15.1.

In the existing development host's Podfile, retain its React Native post-install work and MapLibre setup. After the existing MapLibre post-install call, invoke the Tileflow helper loaded by the local podspec:

```ruby
# Fragment inside the existing post_install block; installer is its parameter.
$MLRN.post_install(installer)
tileflow_native_admission_post_install(installer)
```

The helper requires the MapLibre distribution reference with `exactVersion` 6.26.0, reuses it for the Tileflow pod and its test targets, and rejects conflicting products or versions. It does not add a shell phase, download a second SDK or change a version pin. Enable the pod's `Admission` test specification in a local test host when running XCTest. Autolinking alone does not opt into CocoaPods test specifications.

## Explicit installation and removal

Initialize upstream MapLibre and any compatible pre-existing network customization first. Explicitly install the internal Tileflow transport **before creating a native Map view or using MapLibre offline storage**. On iOS, sessions copy their configuration: changing it cannot retrofit a previously created session. Use a cold development-host launch for qualification, not a hot reload over an older MapLibre session.

Android captures the previous `ModuleProvider`, wraps `createHttpRequest()`, and delegates library loading and unowned requests to that provider. iOS adds `TFNativeAdmissionURLProtocol` only to `MLNNetworkConfiguration.sessionConfiguration`; it never calls app-global protocol registration. Unowned iOS requests remain in the prior protocol chain. Direct context requests delegate without acquiring session authority.

Installation and removal return native acknowledgements, not fire-and-forget flags. Partial installation rolls back only state still owned by the attempted installation. Removing an owner never overwrites a later provider or session configuration. Native work checks ownership before admission delivery, network start and response completion; incompatible mutation fails protected work closed. This is an explicit installation-order contract, not a promise to support arbitrary third-party replacement or concurrent mutation of upstream global configuration.

Retirement is idempotent. It invalidates the context, cancels queued/admitted/native work and discards late completions. The acknowledgement establishes that native logical retirement and owned cancellation have been processed; it is not a promise that every operating-system socket or cancellation callback has already drained. Installation teardown preserves its actual removal/ownership-loss receipt for repeated calls.

## One Map, one admission owner

`createNativeAdmissionOwner()` creates one session controller per registered Map context. Concurrent Maps have distinct context identities, controllers, queues, tickets and callbacks, even when they request identical original URLs. A context discriminator is transient and non-secret. It is not session authority and cannot be used to share admissions.

Changes of source or theme on the **same real Map** retain its context. Replacing that real Map retires the old context before opening another. The source-checkout harness demonstrates both operations; a later production renderer must own these lifecycle calls itself.

The test-only catalog approves exact canonical HTTPS URLs, resource classes and applicable tileset IDs. Every protected ticket is checked against that catalog and then against the controller's approved origins, ports, Map identity, scopes and tilesets. Unknown, malformed, duplicate, stale or retired reserved discriminators are rejected, not delegated as third-party traffic. Only `__tf_native_context` is removed before HTTP; other URL identity is preserved, and conflicting reserved parameters are rejected.

One bounded bridge message may contain several tickets. The TypeScript owner invokes **one logical `acquire()` per eligible protected ticket**, in ticket order. It never acquires once for a whole batch, preallocates grants or counts network chunks. Direct requests do not call `acquire()`. Native sequence numbers and queue reservations identify transport work only; they are not authoritative commercial counters.

The existing controller retains exact 10,000-request and six-hour rotation semantics. The 10,000th acquisition still belongs to its current session; the next acquisition rotates. Bootstrap and refresh remain single-flight, preserve the current session where permitted, and allow only the exact bounded restart response to replace it. A native cancellation does not refund an acquisition already made. Response observation does not confirm, undo or retry commercial completion; that remains server-owned.

## Independent bootstrap and conservative expiry

The native bootstrap uses its own OkHttp client or ephemeral URLSession configuration, separate from MapLibre and from the protected-resource channel. It sends only the expected POST body (`mapId`, `sessionId`, normalized `surfaceId`) to the canonical HTTPS API origin's `/v1/sessions/start` endpoint. The publishable credential is carried in `X-Tileflow-Mobile-Client`, never a query parameter. Cookies, ambient credentials and automatic redirects are disabled on this channel.

Each context binds the first validated bootstrap endpoint and credential; subsequent attempts cannot change either. The native registry checks the context's Map identity, bounded request identifiers, request body and lifecycle before sending. Retiring a context cancels its bootstrap without cancelling another Map's operation. The response travels through a bounded native promise, not an event. Only TypeScript parses session authority and admits protected tickets. Native bootstrap guards retain the original engine identity rather than reading a mutable module installation from a network thread.

The internal controller's `transportBudget(authority)` returns a conservative remaining budget anchored to its existing local `validUntil`. Native does not calculate a fresh lifetime from `expiresAt` and `serverTime`. It anchors the budget at the earlier native ticket-enqueue time, subtracts a safety margin, caps it by the transport deadline and rechecks it immediately before network start and each redirect. Clock rollback, replacement, disposal and expiry invalidate the budget.

Neither a synchronous network hook, the main thread nor an OkHttp interceptor waits for JavaScript. The interceptor's final liveness check is synchronous and nonblocking; acquisition is asynchronous. Backgrounding cancels protected work. Suspended JavaScript cannot authorize stale work: native deadline checks use native elapsed/continuous time, and resumed acquisition revalidates without requiring a JavaScript timer to have fired.

## Authority and diagnostics

`X-Tileflow-Native-Grant` is the only resource-grant carrier. Grant material does not belong in URLs, cache identities, logs, exceptions, events, snapshots or public state. The controller's authority property is non-enumerable; transport serialization is private and ephemeral. Do not log bridge calls, native requests or raw bootstrap responses. The adapter does not use upstream `TransformRequestManager.addHeader`.

Protected redirects are observed by the adapter itself. Automatic forwarding is disabled. Same-origin targets must still match the exact approved catalog, path/class, tileset and context, and the original ticket must remain valid. Cross-origin targets are rejected without forwarding the grant. Redirects do not acquire another admission for the same ticket. The iOS adapter does not depend on MapLibre forwarding `didReceiveResponse` to its configuration delegate.

Native observation events contain only bounded identifiers and HTTP status. They are not public renderer readiness or success events. Errors use fixed codes/messages rather than a native exception, response body or cause. An HTTP response does not prove a rendered frame, service availability or commercial completion.

## Fixed bounds

| Boundary                                                                   | Limit                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Live Map contexts per installation                                         | 16                                                     |
| Exact resources in one test catalog                                        | 128                                                    |
| Native engine ingress per installation, reserved before scheduler dispatch | 2,048                                                  |
| Protected work per context                                                 | 128                                                    |
| Tickets in one bridge batch                                                | 8                                                      |
| Resource URL                                                               | 2,048 characters, including room for the discriminator |
| Admission bridge payload                                                   | 524,288 bytes                                          |
| Grant                                                                      | 24,576 characters                                      |
| Protected transport deadline                                               | 30 seconds from enqueue                                |
| Validity safety margin                                                     | 1 second                                               |
| Protected redirects                                                        | 3                                                      |
| Protected response body                                                    | 8,388,608 bytes                                        |
| Pending bootstrap bridge work                                              | 32                                                     |
| Bootstrap request / response                                               | 2,048 / 65,536 bytes                                   |
| Bootstrap deadline                                                         | 30 seconds                                             |

A cancelled bridge operation retains its capacity reservation until native completion; an unread delivered bootstrap body also retains a bounded slot until consumed, cancelled or retired. Native ingress is reserved before posting to the main scheduler, so cancellation churn cannot bypass its limit while that scheduler is paused. Repeated cancellation does not enqueue repeated cleanup.

Native network capacity is separate from logical admission. Android retains its physical slot through its terminal OkHttp callback. iOS reports logical failure promptly but retains a created URLSession and its capacity until `didBecomeInvalidWithError`; a request cancelled before session creation releases only after its queued start is processed. Native teardown does not create additional capacity by forgetting sessions still awaiting invalidation. These are transport bounds, not product quotas, admission counters or billing guarantees.

## Local qualification

The source tests cover JS admission accounting, deterministic barriers around 9,999/10,000/10,001 and six-hour concurrency, expiry after acquisition, mixed results, context isolation, lifecycle cancellation, native protocol/provider ownership, redirects, bootstrap bounds and package inertness. Additional regressions exercise setters that mutate before throwing, duplicate installation, retained teardown receipts, ingress before main-queue drain, cancellation churn and delayed native invalidation. The archive test checks the actual packed source and metadata, not just the manifest allowlist.

The [local native harness](https://github.com/tileflow/tileflow-sdk/tree/na/native-sdk-integration/packages/react-native/harness) is deliberately excluded from the packed package and runtime exports. It uses an existing development host and fixture endpoints, the real TypeScript controller, the real RN bridge and upstream native Maps. No generated project, runner, external service or deployment is supplied.

Before accepting this unit, run the JS/type/package checks, Android unit and integration tests, CocoaPods/SPM resolution and XCTest, then the harness in the pinned native host. Exercise cold installation, identical URLs across Maps, an unchanged third-party request, style continuity, replacement, cancellation at each phase, background/resume, ownership mutation and redirection. Inspect only redacted observations and controlled fixture assertions. Qualify native callback ordering and retention with memory/thread diagnostics as well as renderer behavior. Source inspection and authored tests do not constitute execution evidence.
