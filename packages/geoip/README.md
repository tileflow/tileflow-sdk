# `@tileflow/geoip`

Bounded IP geolocation for Tileflow. Source availability does not by itself announce public service
availability.

The examples describe the public client contract and can run with a supplied development fixture.
The client accepts no API key or private server credentials.

Anonymous access uses `geolocate()` or common options without `mapId`. It is free best-effort
access with shared limits and no availability guarantee. In an explicit `NODE_ENV=development`
runtime, the client warns once per module instance to make this choice visible. Unknown environments
stay silent. No signup is needed. Anonymous access suits development, previews, and small production
uses that can retain a fallback. Pass a Map when production availability needs to be independent of
anonymous shared capacity; this does not add a new SLA.

```ts
import {geolocate} from '@tileflow/geoip';

const response = await geolocate();
```

Managed lookups include a public map identifier. Each useful managed result, including partial
location data, consumes one shared API unit; `unavailable` consumes zero. Managed GeoIP uses the
existing shared API allowance, not a separate commercial balance. A hard protection cap of 100,000
managed results per Team and commercial period applies in addition to shared limits, independently
of anonymous best-effort access.

```ts
import {geolocate} from '@tileflow/geoip';

const response = await geolocate({
  mapId: 'map_1234567890abcdef',
});

if (response.status === 'available') console.log(response.location.countryCode);
```

`geolocate()` is anonymous. To run a deterministic development fixture, provide `fetch` without
`mapId`:

```ts
const response = await geolocate({
  fetch: async () =>
    Response.json({
      schemaVersion: 1,
      status: 'available',
      location: {countryCode: 'PT'},
      usage: {units: 0},
    }),
});
```

The client sends exactly one `POST` request to `/v1/geoip`: `{}` for anonymous access or `{mapId}`
for managed access. An invalid or denied Map never falls back to anonymous. It omits credentials,
rejects redirects, never retries, and does not access
camera, GPS, or browser location APIs. Requests and responses are strictly bounded; documented
response fields are retained and additive future fields are ignored.

IP geolocation is an approximate network-connection signal. It cannot provide a precise or GPS
location and must not be treated as proof of physical presence. A backend call describes the
backend connection, not its browser users. A normal absence is a `200`
response: `available` may contain partial data, and `unavailable` contains none. Operational
failures use 5xx responses and a GeoIP error. `GEOIP_ANONYMOUS_LIMITED` (429) means the request
was not admitted; it differs from a successful `unavailable` response. The service uses `no-store`
for successes, failures, and preflights.

## Optional initial viewport

The [repository example](https://github.com/tileflow/tileflow-sdk/blob/main/packages/geoip/examples/initial-viewport.ts) composes an explicit managed lookup
with a camera adapter. It applies a position only when there is no explicit viewport or later user
interaction; missing position, `unavailable`, and errors preserve the existing fallback. Run its
deterministic fixture through `runInitialViewportExample` in its package test.

Use `@tileflow/geoip/contract` for response schemas, or `@tileflow/geoip/client` for transport
without importing the root facade.

When the service returns `GEOIP_USAGE_UNCONFIRMED`, a managed lookup may have consumed one unit.
Do not repeat that request automatically.
