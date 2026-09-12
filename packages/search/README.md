# @tileflow/search

Forward and reverse geocoding, location suggestions, and selected-suggestion resolution. This is a
headless client: it provides no search box, map control, address validation, category discovery, or
batch interface.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/search@alpha
```

Use a runtime with `fetch`, such as Node.js 22 or newer. Live requests need an enabled Tileflow
Geocoding service and a Team key or signed Team capability with `geocoding:read`. Installing the
package does not enable that service. Keep privileged credentials on your server; a browser UI
should call your own authorized endpoint.

## Find a place

Run this in a trusted server process with `TILEFLOW_API_KEY` set securely:

<!-- docs:check -->

```ts
import {GeocodingError, geocode} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

try {
  const response = await geocode(
    {query: 'Praça do Comércio, Lisboa', language: 'en', retention: 'temporary'},
    {apiKey, signal: AbortSignal.timeout(5000)},
  );
  console.log(response.results);
  console.log(response.source, response.attribution);
} catch (error) {
  if (!(error instanceof GeocodingError)) throw error;
  console.error(error.code, error.status, error.requestId);
}
```

A successful response may have no results. Present all returned attribution entries alongside
results, preserving any supplied URLs. A source revision of `null` means no reliable revision is
available, not that provenance can be invented or omitted.

## Reverse-geocode a position

Positions use WGS84 `[longitude, latitude]`, not `[latitude, longitude]`:

<!-- docs:check -->

```ts
import {geocodeReverse} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const response = await geocodeReverse(
  {
    position: [-9.1393, 38.7223],
    kinds: ['address', 'place'],
    language: 'en',
    retention: 'temporary',
  },
  {apiKey},
);

console.log(response.results, response.attribution);
```

Results are nearby candidates in provider order. They do not establish containment, administrative
membership, parcel or entrance precision, routability, deliverability, or address validity.
`kinds` is an OR filter with 1–4 values from `address`, `street`, `locality`, and `place`; ordering
adds no priority. Reverse `limit` defaults to 1 and accepts 1–10.

## Resolve a user-selected suggestion

The server-side example returns suggestions first and exposes a separate selection handler:

<!-- docs:check -->

```ts
import {autocomplete, resolveSuggestion} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');
const options = {apiKey};

const response = await autocomplete({query: 'Hospital La Paz', language: 'en'}, options);
console.log(response.suggestions, response.attribution);

export async function resolveUserSelection(token: string) {
  const resolved = await resolveSuggestion({token, retention: 'temporary'}, options);
  return {result: resolved.result, source: resolved.source, attribution: resolved.attribution};
}
```

Call `resolveUserSelection` only after explicit selection. Do not automatically resolve every
suggestion. Tokens are opaque and ephemeral; an expired token needs fresh suggestions. Suggestions
do not guarantee a match for every place and are not category or discovery queries.

Debounce input and cancel superseded requests, or ignore stale results. The client owns no shared
interaction state. Autocomplete rejects `retention`, returns no usage record, and consumes zero
units. Each completed resolution reports one unit; replaying it is another operation, not a retry
of an idempotent request.

## Request limits and retention

Forward queries contain at most 200 characters. Forward and autocomplete `limit` default to 5 and
accept 1–10. `bounds` and `proximity` are mutually exclusive. Bounds use
`[west, south, east, north]` with west less than east and south less than north; do not pass a wrapped
antimeridian box. Provider selection and raw provider options are not public controls.

`retention` accepts `temporary` (default) or `persistent` for forward, reverse, and resolution.
Temporary results are for immediate use, without a right granted by Tileflow to retain them
permanently. Persistent mode requests compatible storage rights; it does not request or promise
Tileflow storage. Only retain a resolved candidate with its source and attribution, not suggestion
tokens or labels.

Persistent retention is unavailable in some territories. `GEOCODING_TERRITORY_UNSUPPORTED` (422)
means the requested mode is unsupported, including AWS HERE-backed geocoding in Japan. It applies
to forward, reverse, and resolution, not autocomplete. Follow the returned source terms rather
than treating an SDK option as a blanket storage license.

## Handle failures and usage

Requests and normalized responses are strictly bounded. The client never retries automatically.
Use `signal` to cancel work and `fetch` or `apiUrl` for tests. API URLs require HTTPS except for an
explicit loopback HTTP origin during development.

Hosted errors throw `GeocodingError` with `status`, nullable `code`, and nullable `requestId`.
Invalid local inputs and malformed remote documents can throw ordinary errors. A disabled service
reports `GEOCODING_DISABLED`. Suggestion failures include `GEOCODING_INVALID_SUGGESTION` (400),
`GEOCODING_SUGGESTION_EXPIRED` (410), `GEOCODING_UPSTREAM_THROTTLED` (429), and
`GEOCODING_PICK_LIMIT_EXCEEDED` (429). Refresh an expired suggestion rather than replaying its token.

`GEOCODING_USAGE_UNCONFIRMED` means completion may already have been charged; do not automatically
repeat the request. Each completed forward or reverse request reports one unit, including an empty
result; completed resolution also reports one. These are usage units, not monetary prices.

Use `@tileflow/search/contract` for schemas and `@tileflow/search/client` for transport. For a
published release, its installed README and declarations take precedence over newer source on `main`.
