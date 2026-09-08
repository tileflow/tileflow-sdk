# `@tileflow/search`

Headless forward and reverse geocoding for Tileflow.

```ts
import {geocode} from '@tileflow/search';

const response = await geocode(
  {query: 'Rua Tileflow 42, Lisboa', language: 'en', retention: 'temporary'},
  {apiKey: process.env.TILEFLOW_API_KEY!},
);

console.log(response.results);
```

Reverse geocoding returns nearby addresses or geographic places:

```ts
import {geocodeReverse} from '@tileflow/search';

const response = await geocodeReverse(
  {
    position: [-9.1393, 38.7223],
    kinds: ['address', 'place'],
    language: 'en',
    retention: 'temporary',
  },
  {apiKey: process.env.TILEFLOW_API_KEY!},
);
```

`geocode` and `geocodeReverse` each send one authenticated request to Tileflow and never retry
automatically. They validate strict requests and bounded normalized responses. Forward queries
contain at most 200 characters; `bounds` and `proximity` are mutually exclusive. Reverse positions
are `[longitude, latitude]` WGS84 coordinates. Reverse `limit` defaults to 1 and accepts 1–10.
Optional `kinds` are an OR filter containing 1–4 of `address`, `street`, `locality`, or `place`;
order adds no priority and repeated values have no additional effect. Provider selection and raw
provider options are not public.

Reverse results are nearby candidates reasonably corresponding to the position, in provider order.
They do not guarantee containment, administrative membership, parcel or entrance precision,
routability, postal precision, or a validated or deliverable address. A successful empty result
still reports `usage.units: 1`.

Supply `fetch` and `apiUrl` for tests or a custom runtime, and pass an `AbortSignal` to control
cancellation. API URLs require HTTPS except for an explicit loopback HTTP origin used during local
development.

`retention` expresses whether the client intends to store results. It accepts `temporary` (the
default) or `persistent`. `temporary` permits immediate use without a right granted by Tileflow to
retain results permanently. `persistent` requests compatible storage rights for the client; it
neither requests nor promises Tileflow storage. Persistent retention is unavailable
for some territories. The API reports `GEOCODING_TERRITORY_UNSUPPORTED` with HTTP 422 when the
requested mode is unsupported, including AWS HERE-backed geocoding in Japan. This applies equally
to forward and reverse geocoding.

Geocoding requires an enabled Tileflow API environment and a Team key or signed Team capability
with `geocoding:read`; a disabled service returns `GEOCODING_DISABLED`. Each completed query reports
`usage.units: 1`, including a query with no candidates. This is technical usage, not a monetary
price.

Responses include source metadata and one or more attribution entries. Applications must pass every
entry through to end users or documentation and preserve any supplied URL as required by its source
terms. A source revision may be `null` when no reliable revision is available.

The package does not support autocomplete UI, structured address input, batches, or address
validation.

Use `@tileflow/search/contract` for the request and result schemas, or
`@tileflow/search/client` for transport without importing the root facade.
