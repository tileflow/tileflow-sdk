# @tileflow/geoip

Get approximate geography for the calling network connection. Use it as an optional hint, such as
an initial map viewport, not as GPS, a precise location, or proof of physical presence. A server-side
call locates the server connection, not its browser users.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/geoip@alpha
```

Use a browser or server runtime with `fetch`. The client accepts no API key or private credential.
Installing it does not enable a hosted environment; applications must retain a fallback when the
service is unavailable.

## Look up a connection

Anonymous access needs no signup and has shared, best-effort limits. Handle a missing or partial
location without blocking the application:

<!-- docs:check -->

```ts
import {GeoIpError, geolocate} from '@tileflow/geoip';

export async function getCountryHint(): Promise<string | undefined> {
  try {
    const response = await geolocate({signal: AbortSignal.timeout(3000)});
    return response.status === 'available' ? response.location.countryCode : undefined;
  } catch (error) {
    if (error instanceof GeoIpError) console.warn('GeoIP hint unavailable:', error.code);
    else console.warn('GeoIP hint unavailable.');
    return undefined;
  }
}
```

Keep the application's existing locale or viewport when this function returns `undefined`. Even
an `available` result can lack the particular field you need. Do not overwrite an explicit user
choice or a camera the user has already moved.

For managed access, pass a public Map ID:

<!-- docs:check -->

```ts
import {geolocate} from '@tileflow/geoip';

const response = await geolocate({
  mapId: 'map_1234567890abcdef',
  signal: AbortSignal.timeout(3000),
});

if (response.status === 'available') console.log(response.location.countryCode);
```

Replace the example ID with your managed map. It is a public identifier, not a key. A denied or
invalid Map never falls back to anonymous access. Managed capacity is separate from anonymous
shared limits; it does not add an availability guarantee or SLA.

Each useful managed result, including partial data, reports one shared API unit; `unavailable`
reports zero. The service also applies its managed protection limits. Treat response usage as usage,
not as a price. In an explicit `NODE_ENV=development` runtime, anonymous use warns once per module
instance; unknown environments stay silent.

## Test without calling the service

Inject a deterministic response. This tests your application's handling of the contract, not the
availability or accuracy of the live service:

<!-- docs:check -->

```ts
import {geolocate} from '@tileflow/geoip';

const response = await geolocate({
  fetch: async () =>
    Response.json({
      schemaVersion: 1,
      status: 'available',
      location: {countryCode: 'PT'},
      usage: {units: 0},
    }),
});

console.log(response);
```

## Responses and failures

The client sends one `POST /v1/geoip`: `{}` for anonymous access or `{mapId}` for managed access.
It omits credentials, rejects redirects, and never retries automatically. It does not access GPS,
the camera, or browser location APIs. Use `signal` to bound work and `fetch` or `apiUrl` for a custom
runtime or test endpoint. HTTP development endpoints must be loopback origins.

A successful `unavailable` response is HTTP 200 and contains no location. `GEOIP_ANONYMOUS_LIMITED`
(429) means the request was not admitted, not that the lookup found nothing. Operational failures
throw `GeoIpError`, which exposes `status`, nullable `code`, and nullable `requestId`. Local invalid
input or malformed remote documents can throw ordinary errors. Additive future response fields are
ignored; retained fields and response size remain bounded.

`GEOIP_USAGE_UNCONFIRMED` means a managed lookup may already have consumed a unit. Do not repeat it
automatically. The service's response contract uses `no-store` for successes, failures, and
preflights.

## Integrate an initial viewport

The [initial viewport example](https://github.com/tileflow/tileflow-sdk/blob/main/packages/geoip/examples/initial-viewport.ts)
applies a managed hint only when there is no explicit viewport or later user interaction. Missing
position, `unavailable`, and errors preserve the fallback camera. Its package test runs a fixture
without a live lookup.

Use `@tileflow/geoip/contract` for response schemas and `@tileflow/geoip/client` for transport.
For a published release, prefer its installed README and declarations over newer source on `main`.
