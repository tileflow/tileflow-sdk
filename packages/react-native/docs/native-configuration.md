# Native application configuration

This guide describes the private application-configuration reader and source-to-session binding in
`@tileflow/react-native`. The package is still private and exports type contracts, not a mounted
Tileflow Map. Configuration alone does not load a map, acquire a session, project a resource graph
or install the networking owner. Follow the [package setup](../README.md) and the
[native admission guide](native-admission.md) for the existing native dependencies and installation
order. No Expo config plugin is supplied.

## Prerequisites and identity

Hosted native production requires a claimed Tileflow account/project, a Hosted Map and its scoped,
revocable, publishable mobile application credential. The credential authenticates the distributed
application, not an end user. There is no Tileflow end-user login, account provider or authentication
hook in this integration. Web deployment with allowed-domain authorization is a different mechanism.

Use only the publishable mobile credential, whose exact grammar is `tf_public_` followed by
48 lowercase hexadecimal characters, for a total of 58 ASCII characters. A CLI, deployment,
administration or other privileged credential must never enter application configuration.

The two logical fields are `apiOrigin` and `credential`. The origin is the API origin approved by
the application's operator, not a value copied automatically from a remote manifest. The native
session contract has no implicit origin; supply it explicitly even for an official Hosted API.
The examples below use `api.example.test` and an intentionally invalid credential placeholder.
Replace both with the application's actual approved configuration before using Hosted delivery.

## Configure iOS

In the **application target's Info.plist**, add one `TileflowMobileConfiguration` key of type Array.
Its two String elements are `apiOrigin=...` and `credential=...`:

```xml
<key>TileflowMobileConfiguration</key>
<array>
  <string>apiOrigin=https://api.example.test</string>
  <string>credential=YOUR_PUBLISHABLE_MOBILE_CREDENTIAL</string>
</array>
```

Place this in the existing application plist dictionary, not in a pod, framework or MapLibre
configuration. When Xcode generates the application's Info.plist, configure the application target
so its final plist contains this array; a scalar build-setting substitution is not an array.
An application-owned build-time substitution may supply each string, but unresolved placeholders
fail validation. Do not put the key in `InfoPlist.strings`: a localized definition is rejected,
even when its contents match the main plist. There is no localization precedence.

The autolinked `TileflowNativeConfiguration` module reads only `NSBundle.mainBundle` when its
private asynchronous reader is requested. It publishes no constants or events. The existing
CocoaPods source glob includes its implementation and private header; the package's pinned
MapLibre SPM integration is unchanged.

## Configure Android

In the application's `android/app/src/main/res/values/tileflow.xml`, add one literal String Array:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string-array name="tileflow_mobile_configuration" translatable="false">
    <item>apiOrigin=https://api.example.test</item>
    <item>credential=YOUR_PUBLISHABLE_MOBILE_CREDENTIAL</item>
  </string-array>
</resources>
```

The array belongs to the application package. Do not use AndroidManifest metadata, BuildConfig,
a system property, a second string resource or an array alias as another input. Both entries must
be literal strings: references such as `@string/...`, `@array/...`, theme attributes and styled
strings are rejected. Do not provide locale or device-configuration variants of these values.
Build flavors may deliberately provide their own single final application configuration; inspect
each resulting application independently.

The existing `TileflowNativeAdmissionPackage` autolinks the reader alongside admission. Constructing
the native module does not read configuration or install networking. The library includes a raw
resource-shrinker keep declaration for the dynamically located array; verify retention in the
application's actual optimized release build. The library contains no default configuration array
or embedded credential.

## Array and origin contract

Both platforms use the same bounded list of exactly two `key=value` strings. Order is irrelevant;
keys are case-sensitive. Split only at the first equals sign. Neither key can repeat, including
identical repetitions. Missing, empty, additional, wrong-typed or duplicate entries fail closed.
Each complete entry is limited to 2,080 UTF-16 code units. The array representation keeps repeated
field definitions observable after native resource compilation instead of silently selecting a
last dictionary value.

Define the native top-level key/resource only once in each final application target. A runtime
reader cannot reconstruct top-level plist keys or resource definitions that a build tool has
already overwritten during merging. Review the final plist/resource table and its source overlays;
this reader is not a build-system duplicate-definition checker. It has no runtime fallback or
precedence path for conflicting sources.

`apiOrigin` is at most 2,048 UTF-16 code units. Normalization is deliberately limited to the case of
the HTTPS scheme and ASCII hostname, omission of port 443, and removal of one optional root slash.
For example, `HTTPS://API.Example.test:443/` becomes `https://api.example.test`.
Port 8443 remains distinct. The grammar permits ASCII DNS labels or canonical dotted-decimal IPv4.
DNS labels are 1–63 characters, the host is at most 253 characters, and the final DNS label starts
with a letter. Internationalized hostnames must already use their ASCII form. IPv6 literals are
outside this configuration grammar; general resource URL support is a separate Core contract.

Ports are decimal 1–65535 without leading zeroes. HTTP, user-info, paths other than one root slash,
query strings (including an empty `?`), fragments, whitespace, backslashes, percent escapes,
wildcards, trailing host dots, Unicode hostname conversion and shortened/octal/hexadecimal/integer
IPv4 forms are rejected. These exclusions prevent a generic URL parser from repairing configuration
into a different authority. The manifest API URL is canonicalized under the same rules before
comparison; equality includes scheme, host and non-default port. No suffix or subdomain matching is
performed.

## Source-to-session boundary

The private binding resolver consumes the current resolved Core source, not an executable config or
a renderer style. Only `map.usageMode === 'session'` can request application configuration. It
requires a declared `mapId` matching the existing native session grammar and a complete `apiUrl`.
The resolved map's logical name must agree with the selected source. No Map identity is inferred
from a URL. The configuration is not a per-Map scope list: the Hosted service authorizes the mobile
credential's scope for the declared `mapId` during the existing bootstrap.

A missing `usageMode` returns the existing private non-session binding without evaluating the
native configuration lookup. Local, self-hosted and other non-session Tileflow sources do not read
configuration, create commercial identity, bootstrap or acquire authority. An unknown delivery mode
or malformed session metadata is an error, not a downgrade to unauthenticated delivery. An origin
mismatch fails before a Hosted binding is delivered, so it cannot send the credential to a manifest-
selected origin.

The resolver has no network, admission or renderer capability. Its caller later supplies the
result to the existing private session/controller boundary. Creating a resolver or resolving a
binding does not itself call `acquire()`. There is no credential prop, JS global setter, mobile
client constructor or React provider, and no public configuration export or subpath.

## Ownership, caching and cancellation

The native reader caches one immutable application snapshot, or a safe failure, for the application
process. It does not retain a React context. JS coalesces native reads and copies the result into a
frozen private value. Only application data can be shared: each resolver has its own pending
resolution and retirement state, and each future mounted Map must create its own controller,
session, admission context and callbacks. The binding resolver never shares grants or counters.

Replacement/disposal rejects an in-flight resolution immediately. Late success or failure cannot
deliver authority to the retired owner, and retiring one Map does not cancel another Map's access
to shared immutable configuration. Inputs are snapshotted before awaiting the reader. Native bridge
absence, failure or a changed module/method identity fails closed; cached data cannot authorize a
replacement bridge. Configuration is not hot-reloaded. Restart the application process after
changing its native values; a corrected bridge requires a fresh JS runtime.

The configuration reader does not install a timeout or background polling service. One unresolved
native read can remain pending, but a Map's resolver remains independently disposable. Rendering
lifecycle, resource projection, camera control and native readiness are not implemented by this
configuration unit.

## Public credential threat model and rotation

A credential distributed inside a mobile application is extractable. Native configuration is not
a secret vault, proof of installation authenticity or end-user authentication. This version does
not authenticate with bundle ID, package name, signing identity or attestation. Origin binding
prevents the SDK from forwarding its configured credential to an origin selected by an untrusted
manifest; it does not stop someone who has copied the publishable credential from making their own
requests. Scope, revocation and server-side authorization remain necessary.

The credential crosses only the private reader/binding/bootstrap path. It is not a grant and is
not a resource URL, cache key, ref field, public state or renderer event. Private JS snapshots hide
configured values from ordinary enumeration, JSON and inspection, but deliberate access to their
private properties remains possible. Native configuration objects have value-free descriptions.
Errors expose only fixed internal codes/messages, never native causes or configured values. Do not
log private module responses or include native settings, credential strings or debugger inspectors
in screenshots and support reports.

For rotation, issue a new credential with the intended Map scope, update the same native entries,
rebuild and distribute the application, and retire the old credential according to the rollout
policy. Revoking an old credential may stop installed versions that still contain it. Do not repair
that failure with a JS override or a second credential source. Existing short-lived authorities
remain subject to the service's validity/revocation policy; this configuration cache does not claim
to purge grants remotely or confirm commercial consumption.

A future Expo plugin would write these same native values. It must not create another runtime
configuration channel. No plugin, deployment operation, account-management API or end-user login is
provided here.

## Validation boundary

The authored JS tests cover grammar, exact matching, lazy reads, safe failures, stale results,
immutable snapshots, direct-source exclusion and independent resolvers/controllers. Native tests
exercise the parsers, duplicate/wrong-typed values, resource literal boundaries, caching and
reentrancy. Package tests protect autolinking, exact peers, private declarations and archive contents.
None of those sources is execution evidence. Native application verification must additionally
exercise real Info.plist/resource extraction, resource shrinking, bridge registration, cold starts,
concurrent consumers and corrected/revoked credentials under the actual application's build.
