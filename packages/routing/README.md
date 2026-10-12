# @tileflow/routing

Routes and isochrones for driving, walking and cycling, computed by Tileflow on a routable network
built from the same OpenStreetMap data as Tileflow World. Routes follow the streets the map draws
and use the names it shows. The client uses `fetch` and has no renderer or global state.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/routing@alpha
```

Use Node.js 22, a browser or another runtime with `fetch`.

Live requests require Tileflow Routing to be enabled for your Team and a credential with the
Routing permission. Installing this package does not enable the service or grant access.

## Calculate a route

<!-- docs:check -->

```ts
import {route} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const answer = await route(
  {
    locations: [
      [-80.2195, 25.7655],
      [-80.1312, 25.7795],
    ],
    mode: 'driving',
    alternatives: 1,
  },
  {apiKey},
);

const [fastest] = answer.routes;
console.log(fastest?.distance, fastest?.duration, answer.usage.units);
for (const step of fastest?.legs[0]?.steps ?? []) console.log(step.instruction);
```

**Request:**

- `locations`: two to five `[longitude, latitude]` positions: an origin, optional stops and a
  destination. Each stretch between consecutive positions is a leg.
- `mode`: `driving`, `walking` or `cycling`.
- `alternatives` (optional, 0–2): only between two positions. Fewer come back when no distinct
  alternative exists.
- `language` (optional): writes the instructions in one of `routingLanguages`.

**Answer:** routes, fastest first. Each route has:

- `distance` in metres and `duration` in seconds;
- a GeoJSON `LineString` `geometry`;
- `legs` of `steps`. Each step has a `maneuver`, an `instruction`, the street `names` and, on
  highways, the `exit` number and the destinations it is signed `toward`.

Durations are estimates without traffic.

## Calculate an isochrone

<!-- docs:check -->

```ts
import {isochrone} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const answer = await isochrone(
  {location: [-80.1918, 25.7617], mode: 'walking', minutes: [5, 10, 15]},
  {apiKey},
);

for (const area of answer.isochrones.features)
  console.log(area.properties.minutes, area.geometry.type);
```

`minutes` holds one to four whole minutes from 1 to 60, rising. The answer is a GeoJSON
`FeatureCollection` with one `Polygon` or `MultiPolygon` per time, in the same order.

## Draw a route on a map

Routes and isochrones are plain GeoJSON, so any map can draw them. With MapLibre:

<!-- docs:check -->

```ts
import type {RoutingRouteResponse} from '@tileflow/routing';

// The two MapLibre map methods this example uses; pass your maplibregl.Map.
type RouteMap = {
  addSource(id: string, source: object): unknown;
  addLayer(layer: object): unknown;
};

export function showRoute(map: RouteMap, answer: RoutingRouteResponse) {
  const fastest = answer.routes[0];
  if (!fastest) return;
  map.addSource('route', {
    type: 'geojson',
    data: {type: 'Feature', properties: {}, geometry: fastest.geometry},
    lineMetrics: true,
  });
  map.addLayer({
    id: 'route',
    type: 'line',
    source: 'route',
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': '#2563eb', 'line-width': 6},
  });
}
```

To colour the route with the map's theme and draw it on progressively, use Core's route inks and
line progress; see the
[route drawing guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/route-drawing.md).
Keep the answer's `attribution` visible with the route. Like the map, routes come from
OpenStreetMap data.

## Errors

Failures throw `RoutingError` with:

- `code`, from `routingErrorCodes`, when the service sent one with its documented status;
- `status`;
- `requestId`;
- `retryAfterSeconds` on rate limits.

`ROUTING_NO_ROUTE` means that no road is near a position or that no route connects them in that
mode. The client never retries; repeat an operation only after an explicit user action.

Invalid requests are rejected before any network call.

## Browser and app credentials

A publishable credential is restricted to your origins or app identifiers and can be used in client
code. Native apps pass `app: {id, certificateSha256}` so a publishable credential can admit them.
Server credentials must stay on your server.

## Contract

`@tileflow/routing/contract` exports the request and answer schemas, limits, maneuvers, languages
and error codes. Use them to validate data that crosses your own boundaries.
