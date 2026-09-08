# `@tileflow/search`

Headless geocoding and location selection for Tileflow.

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

Location selection starts with suggestions and resolves one selected token:

```ts
import {autocomplete, resolveSuggestion} from '@tileflow/search';

const suggestions = await autocomplete(
  {query: 'Hospital La Paz', language: 'en'},
  {apiKey: process.env.TILEFLOW_API_KEY!},
);

async function resolveUserSelection(token: string) {
  const response = await resolveSuggestion(
    {token, retention: 'temporary'},
    {apiKey: process.env.TILEFLOW_API_KEY!},
  );
  console.log(response.result);
}
```

Call `resolveUserSelection` only after an explicit user selection. The package provides no UI.

`geocode` and `geocodeReverse` each send one authenticated request to Tileflow and never retry
automatically. They validate strict requests and bounded normalized responses. Forward queries
contain at most 200 characters; `bounds` and `proximity` are mutually exclusive. Reverse positions
are `[longitude, latitude]` WGS84 coordinates. Reverse `limit` defaults to 1 and accepts 1–10.
Optional `kinds` are an OR filter containing 1–4 of `address`, `street`, `locality`, or `place`;
order adds no priority and repeated values have no additional effect. Provider selection and raw
provider options are not public.

`autocomplete` accepts the same text, language, `bounds`, and `proximity` rules as forward
geocoding. Its `limit` defaults to 5 and accepts 1–10. Suggestions are ephemeral opaque tokens;
they can expire, and an expired token requires fresh suggestions. Suggestions do not promise a
match for every named location and do not provide category or discovery queries. `autocomplete`
rejects `retention` and returns no usage record. Each completed `resolveSuggestion` returns one
existing result and `usage.units: 1`; replaying a resolution is another request and unit.

Applications may debounce autocomplete calls and cancel superseded calls or ignore stale results.
The client has no shared interaction state and never retries automatically. Do not expose
privileged credentials in browser code.

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
to forward, reverse, and suggestion resolution. It does not apply to autocomplete. Retain only a
resolved candidate with its source and attribution; do not retain a suggestion token or label.

Geocoding requires an enabled Tileflow API environment and a Team key or signed Team capability
with `geocoding:read`; a disabled service returns `GEOCODING_DISABLED`. Each completed forward,
reverse, or suggestion resolution reports `usage.units: 1`. Forward and reverse also count empty
results. Autocomplete consumes zero units. These are usage units, not monetary prices.

Suggestion resolution can report `GEOCODING_INVALID_SUGGESTION` (400),
`GEOCODING_SUGGESTION_EXPIRED` (410), `GEOCODING_UPSTREAM_THROTTLED` (429), or
`GEOCODING_PICK_LIMIT_EXCEEDED` (429). The client never retries automatically.

Responses include source metadata and one or more attribution entries. Applications must pass every
entry through to end users or documentation and preserve any supplied URL as required by its source
terms. A source revision may be `null` when no reliable revision is available.

The package does not provide autocomplete UI, structured address input, category discovery,
batches, or address validation.

Use `@tileflow/search/contract` for the request and result schemas, or
`@tileflow/search/client` for transport without importing the root facade.
