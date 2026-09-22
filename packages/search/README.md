# @tileflow/search

Headless forward/reverse geocoding, autocomplete, category discovery, Nearby POIs and explicit
selected-place resolution. It uses `fetch` and has no renderer or global interaction state.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/search@alpha
```

Use Node.js 22 or another runtime with `fetch`. Live requests require enabled Tileflow Search and a
Team credential with `geocoding:read`. Keep privileged credentials on your application server.
Browser and mobile interfaces call their own authorized server endpoint.

Managed operations require paid Starter or a separate, finite Search evaluation grant. A Starter
trial or complimentary assignment alone does not authorize Search. Free Teams can read categories.
Installing this package does not enable the service or grant access.

## Find nearby places

Run this example on your server with `TILEFLOW_API_KEY` set securely. It lists the current categories,
then makes one explicit Nearby request using a discovered ID:

<!-- docs:check -->

```ts
import {listCategories, searchNearby} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');
const options = {apiKey};
const catalog = await listCategories(options);
const category = catalog.categories.find(({name}) => name.toLowerCase().includes('coffee'));
if (!category) throw new Error('Choose a category from the current catalog.');

const page = await searchNearby(
  {
    position: [-9.1393, 38.7223],
    radiusMeters: 1000,
    includeCategories: [category.id],
    countries: ['PT'],
    language: 'en',
    limit: 20,
  },
  options,
);

console.log(page.results, page.attribution, page.usage.units);
```

Coordinates are WGS84 `[longitude, latitude]`. Results preserve native AWS proximity ordering.
A POI's optional `name` is its establishment title; `label` and `address` describe its location.
Categories and business-chain labels appear only when supplied. Missing metadata does not establish
opening status, freshness or completeness. Co-located businesses are not merged.

Display every attribution entry with results, preserving supplied URLs. Results and opaque references
are temporary. Do not build a permanent place catalog, cache results, or persist provider references.

## Request another page or resolve a selection

Save the original request in the current interaction. Another page repeats that request with the
returned `nextCursor`; no page is fetched automatically. A successful empty page can have a cursor.
Each explicit page costs 25 API units. There is no total-count or snapshot-consistency promise.

<!-- docs:check -->

```ts
import {type NearbyRequest, resolvePlace, searchNearby} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');
const options = {apiKey};
const original: NearbyRequest = {position: [-9.1393, 38.7223], radiusMeters: 1000};

export function requestPage(cursor?: string) {
  return searchNearby({...original, ...(cursor ? {cursor} : {})}, options);
}

export function resolveSelectedPlace(token: string) {
  return resolvePlace({token}, options);
}
```

Invoke these handlers only after explicit user actions. Use a returned POI token for resolution;
map feature IDs, click coordinates and raw AWS Place IDs are not selection tokens. A result without
a token can be displayed but cannot be resolved. Selection and pagination references cannot be
interchanged or moved between Teams. Changed query, language, filters or limit invalidates a cursor.

`resolvePlace` and `resolveSuggestion` perform the same single resolution operation. Neither fetches
other results or retries automatically. An expired reference requires an explicit fresh search.

## Geocode text, reverse a position, or offer suggestions

<!-- docs:check -->

```ts
import {autocomplete, geocode, geocodeReverse, resolveSuggestion} from '@tileflow/search';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');
const options = {apiKey};

export const findAddress = (query: string) => geocode({query, language: 'en'}, options);
export const reversePosition = (position: [number, number]) =>
  geocodeReverse({position, kinds: ['address', 'place']}, options);
export const suggestPlaces = (query: string) => autocomplete({query, language: 'en'}, options);
export const resolveSelection = (token: string) => resolveSuggestion({token}, options);
```

Text search and Nearby are distinct operations. Suggestions have no position. Resolve only the
selected suggestion. Reverse results are candidates in provider order, without containment,
entrance precision, routability, deliverability or address-validation guarantees.

## Limits and temporary use

Forward/autocomplete text accepts 1–200 characters. Their limit defaults to 5 and accepts 1–10;
reverse defaults to 1 and accepts 1–10. Reverse kinds are an OR of `address`, `street`, `locality`
and `place`. Forward/autocomplete `bounds` and `proximity` are mutually exclusive.

Nearby requires `position`, defaults to 20 results and accepts 1–100. Optional `radiusMeters` accepts
1–21,000,000. A bbox is `[west, south, east, north]`, with west < east and south < north; wrapping
antimeridian boxes are unsupported. Position alone uses native provider scope and makes no hard
extent promise. Combined radius+bbox is currently rejected with `GEOCODING_FILTER_UNSUPPORTED`.

Use literal current category IDs, including spaces and punctuation. Include/exclude lists accept up
to ten IDs each. Inclusion is OR; exclusion vetoes matches. No parent-category expansion is implied.
Country filters accept up to 100 ISO alpha-2/alpha-3 codes and intersect spatial/category constraints.
Unknown IDs or countries are rejected. Language requests use provider fallback, without a translation
or localization completeness guarantee. Nearby does not accept text queries or an ordering selector.

Nearby requests are bounded to 32 KiB and responses to 512 KiB. Cursors accept at most 8192 characters;
selection tokens at most 2048. Oversized/invalid pages fail as a whole. The SDK parses strict schemas
and never drops malformed results to manufacture a valid success.

Forward, reverse and resolution accept only `retention: 'temporary'`, also the default. Persistent
retention, Advanced features and caller-selected provider options are rejected before provider work.

## Usage and errors

| Completed operation                   | Shared API units |
| ------------------------------------- | ---------------: |
| Category discovery                    |                0 |
| Autocomplete                          |               10 |
| Forward, reverse, explicit resolution |               25 |
| Each Nearby page                      |               25 |

Valid empty responses consume the same units. Three autocomplete calls and one resolution consume
55 units. These are part of Starter's shared API allowance, with no separate Search credits or
commercial search session. Hovering, displaying results and moving a map do not call Search.

`GeocodingError` exposes `status`, nullable `code`, nullable `requestId` and nullable bounded
`retryAfterSeconds`. The client never retries, including after throttling. Use `signal` for
cancellation. Network failures can leave server completion uncertain.

| Code                                                             | Action                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GEOCODING_PLAN_UNAVAILABLE`                                     | Use paid Starter or request an eligible evaluation.                 |
| `GEOCODING_EVALUATION_REQUIRED` / `GEOCODING_EVALUATION_EXPIRED` | Ask the Team's operator to review evaluation access.                |
| `GEOCODING_EVALUATION_EXHAUSTED`                                 | Stop requests; review evaluation limits.                            |
| `GEOCODING_PICK_LIMIT_EXCEEDED` / `GEOCODING_UPSTREAM_THROTTLED` | Respect `retryAfterSeconds`; retry only deliberately.               |
| `GEOCODING_INVALID_CURSOR` / `GEOCODING_INVALID_SUGGESTION`      | Check the Team and original query; start a fresh search explicitly. |
| `GEOCODING_CURSOR_EXPIRED` / `GEOCODING_SUGGESTION_EXPIRED`      | Request fresh results explicitly.                                   |
| `GEOCODING_USAGE_UNCONFIRMED`                                    | Completion may already be charged. Inspect usage before repeating.  |
| `GEOCODING_DISABLED`                                             | Search is disabled; installation does not activate it.              |

Rejected or failed operations do not return a completed usage record. Never translate an unconfirmed
completion into zero units. Confirmed server completion is not undone by a later disconnection.
API URLs require HTTPS, except explicit loopback HTTP during development. `fetch` can be injected
for local tests. Request and response schemas are exported from `@tileflow/search/contract`;
transport is available from `@tileflow/search/client`.

## Integrate an independent search interaction

Each widget owns its timer, abort controller, request generation and selection state. Debounce input;
suppress requests while IME composition is active; launch the final input on `compositionend`.
Increment the generation and abort previous work on input, selection, dismissal or a view change.
Apply a response only if its generation still matches, even if abort did not stop the transport.

Use an accessible combobox/listbox for suggestions: arrow keys change the active option, Enter or a
touch/click explicitly selects it, and Escape dismisses it. Give the input a label, maintain focus
and active-option semantics, and announce loading, empty results and errors through a polite status
region. Preserve attribution beside displayed results. Do not resolve on hover or focus changes.

An explicit category action can call Nearby. Moving a map offers a “Search this area” button; only
pressing it submits the new bounds. A late reply must not move the camera after a newer selection or
view change. Keep independent generations for independent widgets. The SDK's tests demonstrate
cancellation and stale-suggestion handling; it does not supply a UI component or client credentials.

For a published package, its installed README and declarations describe that release; a link to
GitHub `main` can describe newer source.
