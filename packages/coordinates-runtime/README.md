# @tileflow/coordinates-runtime

`@tileflow/coordinates-runtime` provisions an explicit coordinate execution release and runs local
CRS search, description, operation discovery, and transformations through that release's native
engine. It requires Node.js 22 or newer.

This source package does not establish registry availability for a package or release. Use the
package registry and its immutable release artifacts to determine what can be installed.

No public native runtime distribution is currently offered. Installing this package supplies the
provisioning and execution adapter, not the native engine/catalog/grid assets. Use an explicitly
provided compatible distribution. The verified production profile is Linux x64 on Debian 12,
glibc 2.36 and Node.js 24; the package’s Node minimum does not broaden that profile. Public macOS,
Windows and other Linux profiles are not supported distributions.

## Execution releases

An execution release contains a release identity, provenance, compatible artifacts, resource
records, and file hashes. A distribution supplies the separate delivery locations for an artifact's
assets. This separation keeps release identity independent of a delivery provider.

The selected artifact may contain multiple assets. Provisioning acquires every declared asset,
checks its byte size and SHA-256 digest, extracts only manifest-declared files, verifies the complete
payload, and records the active release in the selected cache directory. A failed provision does not
make an unchecked payload executable.

`setupCoordinates()` accepts a distribution URL, a local `distribution.json`, or a directory that
contains one. A local archive is accepted when its adjacent distribution identifies that archive.
Pass `allowDevelopment: true` only when using a development distribution. Its receipt identifies the
release, artifact, installed directory, provenance, and acquired assets.

### Native-qualified Linux releases

`native-qualified` is a provider-neutral manifest admission record. It binds the selected artifact,
execution inputs, complete file/resource inventory, native toolchain, and offline evidence to one
qualification subject. The initial supported runtime profile is exactly Debian 12, x64, glibc 2.36,
and Node.js 24. Loading or setup rejects a qualified artifact outside that profile with a structured
runtime-profile reason.

Development artifacts remain unavailable unless `allowDevelopment: true` is passed explicitly.
Environment configuration does not qualify them. macOS DMG admission remains a separate notarized
distribution path. Qualification records contain no cloud account, region, provider, or deployment
identity.

## Builder inputs

SDK release preparation can emit a content-addressed builder input for private release assembly.
It contains the adapter source, proof documents, conformance bundles, build configuration, and the
small exact runtime-package tarball; it never carries grids or a native runtime distribution.
`verifyCoordinatesBuilderInput()` verifies the supplied input offline and, when given an installed
runtime package directory, requires its complete package inventory and source descriptor to match.

A builder input is not an installer, a Hosted endpoint, or a public runtime distribution. A
development input cannot qualify a native release; an eligible input is bound to an exact published
alpha runtime package and an SDK source revision.

## Local execution

`createLocalCoordinates()` opens an explicitly supplied installed directory, or the active release
selected by setup. It verifies the release before loading the native engine. `search`, `describe`,
`operations`, and `transform` accept the request contracts from `@tileflow/coordinates` and return
local responses with release provenance. Call `close()` when finished.

Execution never fetches a release, grid, or replacement artifact. Provisioning is the only operation
that acquires release assets.

For the static geographic/geocentric conversion EPSG:9602, a release may include a versioned
[analytical applicability proof](proofs/README.md). Its descriptor appears in provenance; its JSON
document is a hashed file in every artifact, at `proofs/<proof-id>.json`. Both manifest binding and
document bytes are verified before native execution. The native method independently verifies CRS
compatibility, its mathematical domain and forward/inverse residuals for every position. Missing
proofs do not enable null-area operations. This is a bounded method exception, not a global area or
an accuracy estimate.

The small reference specifications are also included in the npm package. Their presence there does
not authorize execution: the selected execution release must independently register and contain
the exact proof.

```ts
import {createLocalCoordinates, setupCoordinates} from '@tileflow/coordinates-runtime';

const installed = await setupCoordinates({
  source: '/path/to/distribution.json',
  cacheDirectory: '/path/to/coordinates-cache',
  allowDevelopment: true,
});

const coordinates = await createLocalCoordinates({
  directory: installed.directory,
  allowDevelopment: true,
});

try {
  const result = await coordinates.search({query: 'ETRS89'});
  console.log(result);
} finally {
  await coordinates.close();
}
```

`CoordinatesSetupError` serializes a stable setup failure document. Coordinate request and execution
failures use `CoordinatesContractError` from `@tileflow/coordinates`.

## macOS quarantine

On macOS, DMG provisioning uses built-in system tools to preserve quarantine metadata while copying
an offline DMG into the cache and while staging its payload. A verified remote DMG without existing
quarantine metadata is marked through Foundation before it is mounted. This does not require Xcode,
Python, Docker, or a separate runtime helper.

Successful provisioning does not prove public Gatekeeper, signing, notarization, or offline
acceptance. Validate those properties separately on a clean macOS environment before distribution.
