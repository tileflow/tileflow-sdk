# `@tileflow/coordinates`

Portable, versioned CRS discovery and coordinate-transformation contracts. This package provides
schemas, types, validation, and a portable HTTP client. It does not execute transformations, install
an engine, or register CLI commands.

```ts
import {CoordinatesContractError, parseCoordinatesJsonRequest} from '@tileflow/coordinates';

try {
  const request = parseCoordinatesJsonRequest(
    'transform',
    JSON.stringify({
      from: 'EPSG:4258',
      to: 'EPSG:25832',
      positions: [[12, 55]],
    }),
  );
  console.log(JSON.stringify(request));
} catch (error) {
  if (!(error instanceof CoordinatesContractError)) throw error;
  console.error(JSON.stringify(error.toJSON()));
}
```

The root exposes the client and contract helpers; `@tileflow/coordinates/contract` exposes the
contract helpers. Imports are safe in Node, browsers, and SSR; they do not load native libraries or
access the network.

## HTTP client

`createCoordinatesClient({apiKey, apiUrl?, fetch?, signal?})` creates a client with `search`,
`describe`, `operations`, and `transform` methods. Each validates its request and response through
the exported contract helpers, sends one POST request to `/v1/coordinates/{command}`, and never
retries automatically. The client uses the supplied `fetch` or the browser-compatible global
implementation; it does not load a native runtime. Per-client and per-request abort signals are
supported. Client failures are `CoordinatesContractError` documents with fixed safe messages.

The default endpoint is `https://api.tileflow.dev`; local HTTP endpoints are limited to loopback.
Creating a client does not establish service availability or activate a Hosted capability.

## Validation

| Export                                                       | Purpose                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `parseCoordinatesRequest(command, value)`                    | Validate and normalize a request; preserve nonfinite-number rejection before JSON serialization. |
| `parseCoordinatesJsonRequest(command, text)`                 | Parse a bounded JSON request with stable failures.                                               |
| `validateCoordinatesTransformRequest(value, from, to)`       | Additionally check resolved CRS identities, profile eligibility, and dimensionality.             |
| `parseCoordinatesResponse(command, request, value, context)` | Validate shape and request/response consistency, including errors.                               |
| `CoordinatesContractError`                                   | Expose `code`, `reason`, `details`, and a versioned `toJSON()` failure.                          |
| `coordinates*Schema`                                         | Low-level Zod schemas for typed composition and inspection.                                      |

Response context contains `mode: 'local' | 'hosted'`. It may also identify a known `releaseId`,
`artifactId`, and full `provenance`; known provenance requires its release ID. The helper checks
these expectations. They describe the validator's trusted runtime context, not extra request fields.
Use the helpers for stable failure envelopes; direct Zod parsing returns Zod validation errors.

Validation does not authenticate an engine or prove geodetic correctness. The execution adapter
must verify the release manifest, resolve references against trusted candidates, and perform actual
CRS/operation-area, grid-coverage, and execution-domain checks.

## Requests

All objects reject unknown fields. IDs use canonical `EPSG:<positive integer>` form; bare numbers
are search terms only. No coercion, custom CRS, raw pipeline, epoch, Map, credential, or native
operation index belongs in these bodies. `schemaVersion` defaults to `1`. Optional fields are
omitted rather than set to null. `requiredReleaseId` is optional; it requests an exact execution
release and never permits substitution.

| Command      | Fields beyond common version/release fields                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `search`     | Optional `query`, `filters`, `deprecated`, `limit`, `cursor`.                                                       |
| `describe`   | Required `id`; optional `formats`.                                                                                  |
| `operations` | Required `from`, `to`; optional `areaOfInterest`, `limit`, `cursor`.                                                |
| `transform`  | Required `from`, `to`, `positions`; optional `areaOfInterest`, `operationRef`, `allowBallpark`, `requireBestKnown`. |

Search filters are `name`, `area`, `datum`, `ellipsoid`, `kind`, and `unit`. Text fields contain at
most 200 characters. `deprecated` is `exclude` by default, or `include`/`only`; exact describe lookup
remains available for deprecated records. Area text matches catalog metadata, not political
containment. Search without query/filters requests a bounded catalog page. Pages default to 50
items, with a maximum of 50. Cursors are opaque and bind the query and catalog release; keep them
unchanged. A continuation never silently switches catalog revisions.

`formats` contains any distinct subset of `wkt2`, `projjson`, and `legacy-proj`; omission requests
metadata only. Standard exports use `format`, `content`, `lossy`, and `unavailableReason`. PROJJSON
content is serialized standard JSON, not an open extension object on the Coordinates envelope.
Legacy export can be lossy or unavailable. Structured CRS metadata includes official and normalized
axes/units, areas, datum, ellipsoid, prime meridian, and execution-profile eligibility. Eligibility
does not guarantee any particular operation or resource is available.

Transform accepts 1–50 finite, homogeneous `[x,y]` or `[x,y,z]` positions. Requests are bounded to
32 KiB. Geographic x/y are longitude/latitude in degrees relative to the CRS prime meridian;
projected x/y are easting/northing in the CRS's declared linear units. Static geocentric positions
are Cartesian `[X,Y,Z]` in declared units; Z is not height. Real height uses the declared 3D CRS
unit and datum. Official EPSG axes, directions, abbreviations, meridians and units remain metadata.

Execute 2D→2D or 3D→3D CRS pairs. Mixed CRS dimensions fail with
`COORDINATES_CRS_DIMENSION_MISMATCH`. A 3D CRS needs three ordinates. Between horizontal 2D CRS,
an optional z is preserved numerically and reported as `auxiliary-preserved`, never promoted into a
height datum. No height is implicitly supplied or dropped. Vertical-only, dynamic/epoch, time-dependent
4D and unprovable axis profiles are excluded; catalog descriptions can still exist.

Explicit-axis releases identify `coordinateModel` as `geographic`, `projected` or `geocentric`.
Descriptions and transform axes expose `normalization.publicToOfficial`: public ordinate `i`
multiplied by `scale` supplies the indicated `officialAxis`. This mapping handles verified order,
sign and angular-unit changes. Polar axes retain their meridian-qualified directions. A profile
without a verified reversible mapping fails with `UNSUPPORTED_AXIS_PROFILE`. Older execution
releases retain their recorded numeric convention.

AOI is `[west,south,east,north]` in geographic degrees, with antimeridian wrapping when west exceeds
east. It guides candidate selection. A point outside AOI is not invalid for that reason; actual
CRS/operation areas, grids, domain, and quality policy must still be checked independently.

## Selection and successful responses

Responses include `schemaVersion:1`, `ok:true`, `command`, `releaseId`, `provenance`, `warnings`,
`usage`, and `result`. Provenance identifies engine, catalog, grid set, policy, numeric convention,
and runtime artifact. Committed Hosted transforms and unconfirmed completion failures also carry
`invocationId`, a server-owned correlation reference. It is not an idempotency key or a retry token.
Release IDs and operation references are opaque, release-bound content
identities. Their syntax is not proof of authenticity; the adapter validates their binding.

Automatic transforms default to `allowBallpark:false` and `requireBestKnown:true`. Missing resources
for the best-known operation cause failure, not an invisible downgrade. Relaxing best-known does
not allow ballpark; the controls are independent.

An explicit `operationRef` authorizes that operation even if it is not best-known, without another
`requireBestKnown:false`. It must still match release, source/target and direction, and be valid
for every point and resource. Ballpark still requires `allowBallpark:true`. An inverse is a new
request with swapped CRS and its own resolved reference; `hasInverse` alone does not rebind a token.

The batch also includes `axes.from` and `axes.to`, each with official and normalized axes and unit
names/SI factors. Agents can interpret the numbers without a separate describe call. These describe
CRS axes; an auxiliary z on a 2D CRS has no invented height unit or datum.

Each transform result contains:

- `position` and its executed `operationRef`;
- `selection.mode`, `selection.bestKnown.operationRef`, and `selection.bestKnown.relation`;
- `selection.relaxationsApplied`: `ballpark` and/or `best-known` when actually used;
- `height`: `absent`, `auxiliary-preserved`, `crs-preserved`, `transformed`, or `not-applicable` for
  a conversion involving geocentric coordinates;
- structured attestations for CRS area, operation area, grid coverage, and execution domain.

`best-known` in applied relaxations records departure from the best-known operation. In explicit
mode the reference itself authorizes that departure. The deduplicated `operations` table includes
both executed and referenced best-known operations, even when the latter is unavailable. Metadata
includes accuracy in metres, ballpark, areas, grids/digests/licenses/attribution, method support,
instantiability, inverse support, and height effect. `accuracy:null` means unknown. It is not zero,
a confidence score, or a survey-accuracy guarantee. Numeric equality of z never proves height semantics.

An operation without a catalog area remains unverified unless the execution release explicitly
includes its analytical proof. The supported proof class is only static geographic/geocentric
conversion EPSG:9602. `provenance.applicabilityProofs` identifies its document digest, version, method,
algorithm and numerical tolerances. The operation's `applicability.source` is `analytic-proof`, with
the bound proof and release IDs; each successful point records `analyticalProof` and
`operationArea:'not-provided'`. Catalog `areasOfUse:null` and `accuracy:null` are preserved.

The proof requires compatible static 3D CRS, coherent datum/ellipsoid/units, a verified mathematical
domain and forward/inverse agreement. Undefined longitude, ambiguous normal branches and failed
numerical checks produce `APPLICABILITY_UNDETERMINED`. Source/target CRS areas still apply. No proof
is inferred for other operations, and neither ballpark nor best-known relaxation waives applicability.

The response validator requires exactly one ordered result per input, matching dimensions, valid
references, one coherent release, and no duplicate or unreferenced operation entries. Maximum table
size is 100: at most one executed and one best-known reference per point. A point failure aborts
the batch; no partial-success shape exists.

Local usage is `{mode:'local',units:0}`. Hosted discovery is
`{mode:'hosted',state:'not-consumed',units:0}`; a fully validated N-position Hosted success requires
`{mode:'hosted',state:'committed',units:N}`. These are consumption facts, not prices or authorization
to charge. Reservation/commit/release requires the Hosted implementation.

## Failures and agent output

Failures are strict documents containing `schemaVersion:1`, `ok:false`, `command`, `releaseId`,
`provenance`, `warnings`, `usage`, and `error`. Error fields are `code`, `reason`, `phase`, `details`,
and an optional human `message`. The exported error-code/reason schemas define the closed vocabulary.
Helpers generate fixed safe messages; they do not pass through arbitrary remote diagnostic prose.
Structured details remain available without parsing a message, including `pointIndex`, missing grids,
CRS dimensions, reference mismatch, and expected/actual counts where applicable. No raw positions,
pipelines, credentials, provider bodies, or stack traces belong in the failure document.

Pre-resolution validation failures explicitly use `releaseId:null` and `provenance:null`; no
execution release is invented. A helper without execution context reports `usage:null`. Resolved
selection/execution/consumption failures identify their release, provenance, and consumption state.
Known failed/cancelled Hosted operations report zero consumption. An unconfirmed commit uses
`state:'unconfirmed',units:null`; it must not pretend to be zero. A malformed Hosted response also
leaves consumption unconfirmed to the receiving validator. No helper retries automatically.

For command integrations, JSON mode uses one success document on stdout. On failure, stdout is
empty, stderr contains one failure JSON document, and the exit status is nonzero. Human messages
stay inside that document; banners, progress bars, and appended prose must not corrupt either JSON
stream. Complex requests can be passed unchanged from stdin/file JSON. This package defines the
documents; a CLI adapter owns stream IO and process status.

## Reference data

[`test/fixtures/sources.md`](test/fixtures/sources.md) records forward PROJ/Ordnance Survey values,
source revisions, axis normalization, and numerical tolerances. Schema tests validate their contract
representation, not numerical engine output. Runtime conformance needs separate execution against
these references and must state its verified platform and tolerance.
