# Private native resource admission

This guide describes the private native networking boundary used by the mounted Tileflow `Map` in `@tileflow/react-native`. The transport, session controller, resource catalog, configuration reader and native bridge are **not a public API**. The package root exports the Tileflow `Map` and public Map types only; it does not export grants, credentials, session objects, admission handles, native renderer handles or request interception controls.

The mounted owner prepares a **bounded Style/TileJSON resource closure** before native rendering. It covers the current owned style document, one TileJSON edge per tile source, tile templates, sprite leaves, glyph templates, native-v1 managed font faces and supported base assets represented by the current contracts. It does not recursively trust arbitrary remote graphs. Ambiguous, unsafe, oversized or incomplete protected graphs fail closed, while foreign/unowned resources remain unchanged.

## Exact native dependencies

The source targets React 19.2.0, React Native 0.83.10, MapLibre React Native 11.3.10, MapLibre Native Android 13.2.0 and MapLibre Native iOS 6.26.0. Android's HTTP dependency is OkHttp 4.12.0. These pins and the existence of source tests are **not evidence** of a successful build, device run, Hosted service or app-store acceptance; qualify the exact revision in the intended host.

Android's library build uses the host's Android Gradle/Kotlin plugins and SDK settings. `react-native.config.cjs` autolinks `TileflowNativeAdmissionPackage`, which registers the private admission, document, configuration and surface modules. The library depends on the autolinked `:maplibre_maplibre-react-native` project and rejects conflicting MapLibre Native versions rather than selecting another version silently.

On iOS, the `TileflowNativeAdmission` pod depends on the exact React and MapLibre React Native pods. MapLibre Native itself is the existing pinned Swift Package Manager product, not a second MapLibre CocoaPod. Retain the host's React Native post-install work and MapLibre setup, then invoke:

```ruby
$MLRN.post_install(installer)
tileflow_native_admission_post_install(installer)
```

The helper requires the MapLibre distribution reference with `exactVersion` 6.26.0 and reuses that product for the Tileflow pod/test targets. It does not add another SDK or change the pin.

## Installation ownership

Tileflow owns the MapLibre networking seam in explicit installation order. Android captures the previous `ModuleProvider`, wraps `createHttpRequest()` and delegates unowned traffic to the previous provider. iOS adds `TFNativeAdmissionURLProtocol` only to MapLibre's session configuration and uses an independent internal URLSession; it never registers an application-global protocol.

Installation/removal are acknowledged operations. Partial installation rolls back only state still owned by that attempt. A later incompatible provider/configuration replacement makes protected work fail closed; removal never overwrites a later owner. This is not a guarantee for arbitrary third-party mutation chains.

The process-level installation may be shared by mounted Maps, but that is the only shared ownership. Each real Map owns a distinct source generation, Hosted binding/session/controller, native context, catalog, queue, tickets and callbacks. One Map's retirement or cleanup failure cannot spend, remove or reuse another Map's authority.

## Mounted Map lifecycle

A native Map is created only after source resolution and context acknowledgement. If the resolved manifest uses Hosted session delivery, application configuration must first yield a binding whose canonical API origin exactly matches the manifest. Non-session delivery does not read the mobile credential or bootstrap Hosted authority.

Theme transactions keep the same native Map, context, session and camera. Resource additions are append-only and become usable only after native `extendContext` acknowledgement. Glyph templates may extend their finite font-stack allowlist across themes by an acknowledged union; the template URL, origin, class and scope cannot change. A logical source/Map replacement retires the previous context before opening the next one.

Retirement is idempotent and cancels queue, JavaScript wait, admitted work, document acquisition and late native completions. Removal acknowledgements are retryable. Strict Mode unmount/remount therefore cannot revive the old generation or share its context with the replacement.

## Resource identity and projection

Every protected resource is canonical HTTPS and belongs to one explicit class: `style`, `tilejson`, `tile`, `sprite`, `glyph` or `font`. Tile and TileJSON entries also preserve exact tileset identity. Tile templates use only the bounded native placeholder grammar. Glyph templates require both `{fontstack}` and `{range}` and a finite exact font-stack set.

Style preparation resolves relative URLs through Core's native URL policy. A style may discover at most one bounded TileJSON document for a declared tile source; TileJSON cannot recursively point to another TileJSON. Sprite base URLs are admitted through their concrete JSON/PNG 1x/2x leaves before the style receives its transient context discriminator. Native-v1 font-face arrays preserve family/style/weight attributes while only their admitted URL is rewritten.

Owned URLs must match the exact Hosted origin/path rules and the session policy's scope/tileset set. A resource on a foreign origin remains unmodified. An URL on an owned origin but outside a known resource path fails closed instead of inheriting authority merely because its origin matches.

The non-secret `__tf_native_context` discriminator selects one Map context. It is stripped before HTTP and never conveys authority. Unknown, malformed, stale, duplicate or retired reserved context values are rejected rather than delegated as third-party traffic. Other URL identity is preserved.

## Admission accounting

Every eligible protected request produces one logical controller `acquire()` result. A bounded bridge batch may carry several tickets but never shares one acquire, preallocates grants, counts chunks or maintains a native commercial counter. Direct/non-session contexts delegate without commercial acquisition.

The controller preserves the 10,000-request and six-hour rotation semantics: the 10,000th acquisition remains in its session and the next rotates. Bootstrap/refresh are single-flight where allowed. Native cancellation does not refund a logical acquisition already made. HTTP response observation does not confirm or undo server-owned commercial completion.

`X-Tileflow-Native-Grant` is the only protected-resource grant carrier. It is attached only after resource/context/session policy checks and never enters query strings, URLs, cache keys, public state, events, errors or logs.

## Independent bootstrap and expiry

Bootstrap uses an independent OkHttp client or ephemeral URLSession channel. It sends the bounded session-start POST to the configured canonical API origin and carries the publishable mobile credential only in `X-Tileflow-Mobile-Client`. Cookies, ambient credentials and automatic redirects are disabled.

Each context binds its validated bootstrap endpoint/credential. Retiring that context cancels its bootstrap without cancelling another Map. TypeScript alone parses session authority and makes admission decisions.

The controller's private transport budget remains anchored to its existing local `validUntil`. Native never reconstructs a fresh lifetime from server timestamps. The budget is bounded by the earlier ticket-enqueue time, the native wait deadline and a safety margin, and is rechecked immediately before network start and redirects. Backgrounding, clock rollback, source replacement, disposal and expiry invalidate stale authority.

No synchronous network hook, main thread or OkHttp interceptor waits for JavaScript. Suspended JavaScript therefore cannot authorize stale protected work.

## Redirects and observation

Protected redirects are handled by the adapter, not by automatic credential forwarding. Same-origin targets must still satisfy catalog, path/class, tileset, context and ticket validity. Cross-origin, different-port, uncataloged or conflicting-context targets receive no forwarded grant. A redirect does not consume another admission for the same ticket.

iOS does not rely on MapLibre forwarding `didReceiveResponse` to a configuration delegate. The adapter observes its own response. Native observation events contain only bounded identifiers/status and are private; they are not renderer readiness or commercial completion events.

## Renderer readiness

Admission success is not Map readiness. The private surface adapter requires current style acceptance, committed positive native layout and a fully rendered native map/frame after that layout. Background, layout loss, camera gesture/command epochs and style replacement invalidate the evidence. Resume re-arms native evidence; JavaScript animation frames and sleeps are not readiness proof.

Camera commands carry private monotonically correlated tokens. A successful public controller command is acknowledged only after the native target is applied, not merely queued by the upstream React Native bridge. User gestures are classified from native gesture reasons and remain separate from programmatic commands.

## Fixed transport bounds

| Boundary | Limit |
| --- | ---: |
| Live Map contexts per installation | 16 |
| Catalog resources per context | 128 |
| Native engine ingress per installation | 2,048 |
| Protected work per context | 128 |
| Tickets per bridge batch | 8 |
| Resource URL | 2,048 characters including discriminator room |
| Admission bridge payload | 524,288 bytes |
| Grant | 24,576 characters |
| Protected transport deadline | 30 seconds from enqueue |
| Validity safety margin | 1 second |
| Protected redirects | 3 |
| Protected response body | 8,388,608 bytes |
| Pending bootstrap bridge work | 32 |
| Bootstrap request / response | 2,048 / 65,536 bytes |
| Bootstrap deadline | 30 seconds |

Cancellation retains transport capacity until the corresponding native cleanup boundary. Capacity bounds are transport safety limits, not product quotas or billing counters.

## Application configuration

The publishable mobile application credential and trusted API origin are configured through native application configuration only. They are not component props or JavaScript globals. See [Native application configuration](./native-configuration.md) for exact iOS/Android keys, credential grammar, origin normalization, rotation/revocation and the end-user threat-model boundary.

## Local qualification

The source-checkout [mounted Map harness](../harness/README.md) uses the real public Tileflow component in an existing development host and is excluded from package exports/packed files. It creates no service, runner or deployment.

Before accepting a revision, qualify package build/types/tests, the exact Android and iOS native test suites, CocoaPods/SPM integration, two concurrent Maps, Strict Mode replay, source replacement during each asynchronous phase, theme success/rollback, controlled camera gestures/commands, background/resume, readiness ordering, redirects, ownership mutation and teardown retries. Inspect only secret-free fixture assertions and public events. Authored source and tests are not evidence that these checks passed.
