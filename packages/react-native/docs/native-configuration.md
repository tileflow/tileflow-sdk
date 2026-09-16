# Native application configuration

This guide describes the private application-configuration reader used by the mounted Tileflow
`Map` in `@tileflow/react-native`. The package is still a private pre-release workspace package, but
its root now exports the mounted `Map` and its public types. Mobile credentials remain application
configuration: there is no credential prop, JavaScript setter, provider, public configuration
object or public configuration subpath.

Importing `@tileflow/react-native` does not read configuration, install networking, start a session,
acquire admission or create a native Map. Configuration is read lazily only when a mounted source
resolves to Hosted session delivery. Follow the [package setup](../README.md) and the
[native admission guide](native-admission.md) for the exact native dependencies and installation
order. No Expo config plugin is supplied.

## Prerequisites and identity

Hosted native production requires a claimed Tileflow account/project, a Hosted Map and its scoped,
revocable, publishable mobile application credential. The credential authenticates the distributed
application, not an end user. There is no Tileflow end-user login, account provider or authentication
hook in this integration. Web deployment with allowed-domain authorization is a different mechanism.

Use only the publishable mobile credential, whose exact grammar is `tf_public_` followed by
48 lowercase hexadecimal characters, for a total of 58 ASCII characters. A CLI, deployment,
administration or other privileged credential must never enter application configuration.

The two logical fields are `apiOrigin` and `credential`. `apiOrigin` is the API origin approved by
the application operator, not a value copied automatically from a remote manifest. The native
session contract has no implicit origin. The examples below use `api.example.test` and an
intentionally invalid credential placeholder; replace both in the application build.

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

Place this in the final application plist, not in a pod, framework, MapLibre configuration or
`InfoPlist.strings`. When Xcode generates the plist, ensure the resulting application target still
contains one literal array. Application-owned build substitution may supply each string, but
unresolved placeholders fail validation.

The autolinked `TileflowNativeConfiguration` module reads only `NSBundle.mainBundle` when its
private asynchronous reader is requested. It exports no constants or events. Constructing the
module, importing the package and mounting a non-session Map do not perform that read.

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
a system property, an alias or a second runtime input. Both entries must be literal strings;
references such as `@string/...`, `@array/...`, theme attributes and styled strings are rejected.
Build flavors may deliberately provide their own single final application configuration, but each
resulting application must be checked independently.

`TileflowNativeAdmissionPackage` autolinks the configuration reader alongside the private admission
and surface modules. Constructing those modules does not read configuration or install networking.
The library includes a resource-shrinker keep declaration for the dynamically located array; the
application's optimized release build must retain it. The library ships no default configuration
array or embedded credential.

## Array and origin contract

Both platforms use the same bounded list of exactly two `key=value` strings. Order is irrelevant;
keys are case-sensitive. Split only at the first equals sign. Missing, empty, additional,
wrong-typed or duplicate entries fail closed. Each complete entry is limited to 2,080 UTF-16 code
units.

`apiOrigin` is at most 2,048 UTF-16 code units. Normalization is deliberately limited to the HTTPS
scheme and ASCII hostname, omission of port 443 and removal of one optional root slash. For example,
`HTTPS://API.Example.test:443/` becomes `https://api.example.test`. Port 8443 remains distinct.
The grammar permits ASCII DNS labels or canonical dotted-decimal IPv4; IPv6 literals are outside
this application-configuration grammar.

Ports are decimal 1–65535 without leading zeroes. HTTP, user-info, non-root paths, query strings,
fragments, whitespace, backslashes, percent escapes, wildcards, trailing host dots, Unicode hostname
conversion and shortened/octal/hexadecimal/integer IPv4 forms are rejected. The manifest API URL is
canonicalized under the same rules before comparison. Equality includes scheme, host and non-default
port; there is no suffix or subdomain match.

## Source-to-session boundary

The private binding resolver consumes the current resolved Core source, not an executable config or
a renderer style. Only `map.usageMode === 'session'` can request application configuration. It
requires the declared Hosted `mapId`, a complete `apiUrl` and agreement between the resolved logical
map name and the selected Tileflow source. No Map identity is inferred from a URL.

A missing `usageMode` produces the existing direct binding without evaluating the native
configuration lookup. Local, self-hosted and other non-session Tileflow sources therefore do not
read mobile configuration, create commercial identity, bootstrap or acquire Hosted authority. An
unknown delivery mode or malformed session metadata is an error, not a downgrade. An origin
mismatch fails before a Hosted binding is delivered, so a manifest-selected origin cannot receive
the configured credential.

The resolver itself has no renderer or resource-admission authority. The mounted Map passes the
acknowledged binding into its private admission/session owner only after source resolution. Creating
a resolver does not call `acquire()`, and importing the package does not construct a resolver.

## Mounted ownership, caching and cancellation

The native reader caches one immutable application snapshot, or one safe failure, for the
application process. It does not retain a React context. JavaScript coalesces native reads and copies
the result into a frozen private value. Each mounted Map still owns an independent pending binding,
session controller, admission context, callbacks and renderer lifetime. Shared immutable application
configuration never implies shared grants, counters or source ownership.

Source replacement and Map disposal invalidate that owner's in-flight binding immediately. A late
configuration success or failure cannot deliver authority to a retired owner. Retiring one Map does
not cancel another Map's access to the process-level immutable configuration snapshot. Configuration
is not hot-reloaded; restart the application process after changing native values.

The configuration reader installs no timeout, timer, background poller or service. One unresolved
native read can remain pending, but every Map resolver remains independently disposable. Camera,
resource projection and rendered-readiness logic are owned elsewhere in the mounted Map runtime;
they are not configuration-reader responsibilities.

## Public credential threat model and rotation

A credential distributed inside a mobile application is extractable. Native configuration is not a
secret vault, proof of installation authenticity or end-user authentication. This version does not
authenticate with bundle ID, package name, signing identity or attestation. Origin binding prevents
the SDK from forwarding its configured credential to an origin selected by an untrusted manifest;
it does not stop a party that has copied the publishable credential from making its own requests.
Scope, revocation and server-side authorization remain necessary.

The credential crosses only the private reader/binding/bootstrap path. It is not a native grant and
is not a resource URL, cache key, public ref field, source state, renderer event or diagnostic.
Errors use fixed internal codes/messages rather than configured values or native causes. Do not log
native module responses, credentials, bootstrap bodies or grant material.

For rotation, issue a new credential with the intended Map scope, update the same native entries,
rebuild and distribute the application, then retire the old credential according to the rollout
policy. Revoking an old credential may stop installed versions that still contain it. Do not repair
that failure with a JavaScript override or a second credential source.

A future Expo plugin, if introduced, would write these same native values rather than create another
runtime configuration channel. No plugin, deployment operation, account-management API or end-user
login is part of this Stage C unit.

## Validation boundary

The authored source tests cover grammar, exact origin matching, lazy reads, safe failures, stale
results, immutable snapshots, direct-source exclusion, independent resolvers and the absence of a
public credential surface. Native tests cover parser boundaries, duplicate/wrong-typed values,
resource literals, caching and reentrancy. Package tests protect autolinking, exact peers, private
configuration declarations and archive contents.

Those sources are not execution evidence. Local qualification must additionally exercise the final
iOS Info.plist and Android resource extraction, resource shrinking, bridge registration, cold starts,
concurrent mounted Maps, direct versus session sources, replacement/disposal and corrected/revoked
credentials in the pinned native host.
