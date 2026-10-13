# @tileflow/routing

Routes, isochrones, travel-time matrices, map matching and nearest-road lookups for driving,
walking, cycling and trucks, computed by Tileflow on a routable network built from the same
OpenStreetMap data as Tileflow World. Routes follow the streets the map draws and use the names it
shows. The client uses `fetch` and has no renderer or global state.

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
- `mode`: `driving`, `walking`, `cycling` or `truck`.
- `alternatives` (optional, 0–2): only between two positions. Fewer come back when no distinct
  alternative exists.
- `language` (optional): writes the instructions in one of `routingLanguages`.
- `vehicle`, `avoid` and `traffic` (optional): see
  [Route a truck around tolls](#route-a-truck-around-tolls).

**Answer:** routes, fastest first. Each route has:

- `distance` in metres and `duration` in seconds;
- `hasTolls`, `hasHighways` and `hasFerries`: whether the route uses a toll road, a highway or a
  ferry;
- a GeoJSON `LineString` `geometry`;
- `legs` of `steps`. Each step has a `maneuver`, an `instruction`, the street `names` and, on
  highways, the `exit` number and the destinations it is signed `toward`.

Durations are estimates without traffic; see [Travel times and traffic](#travel-times-and-traffic).

## Route a truck around tolls

<!-- docs:check -->

```ts
import {route} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const answer = await route(
  {
    locations: [
      [-80.2878, 25.8195],
      [-80.1918, 26.1224],
    ],
    mode: 'truck',
    vehicle: {heightMeters: 4.1, weightTonnes: 18, axleCount: 3, hazardousMaterials: false},
    avoid: ['tolls'],
  },
  {apiKey},
);

const [fastest] = answer.routes;
if (fastest?.hasTolls) console.log('No reasonable route avoids every toll road.');
```

`vehicle` describes the truck. It is accepted only with `mode: 'truck'`, and every field is
optional:

| Field                | Unit and range |
| -------------------- | -------------- |
| `heightMeters`       | 1–10 metres    |
| `widthMeters`        | 1–5 metres     |
| `lengthMeters`       | 1–40 metres    |
| `weightTonnes`       | 0.5–100 tonnes |
| `axleLoadTonnes`     | 0.5–40 tonnes  |
| `axleCount`          | whole, 2–20    |
| `hazardousMaterials` | `true`/`false` |

The route respects these dimensions where OpenStreetMap records a limit. A road without a recorded
height, weight or hazardous-materials restriction is treated as unrestricted, so check clearances
that matter on the ground.

`avoid` lists `tolls`, `highways` and `ferries`, each at most once, in any mode. **Avoidance is a
strong preference, not an exclusion:** when no reasonable route avoids a road kind, the answer
still uses it. Check `hasTolls`, `hasHighways` and `hasFerries` on each route rather than assuming
the avoidance held.

Isochrones and matrices take the same `vehicle`, `avoid` and `traffic` options. Map matching takes
`vehicle` only.

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

## Calculate a travel-time matrix

A matrix gives the duration and distance from every source to every target, for example to find
the nearest of several depots or to feed your own route optimizer.

<!-- docs:check -->

```ts
import {matrix} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const depots: [number, number][] = [
  [-80.2878, 25.8195],
  [-80.3698, 25.6866],
];
const stops: [number, number][] = [
  [-80.1312, 25.7795],
  [-80.1918, 25.7617],
  [-80.2683, 25.942],
];

const answer = await matrix({sources: depots, targets: stops, mode: 'driving'}, {apiKey});

answer.durations.forEach((row, depot) => {
  row.forEach((seconds, stop) => {
    const minutes = seconds === null ? 'no route' : `${Math.round(seconds / 60)} min`;
    console.log(`depot ${depot} → stop ${stop}: ${minutes}`);
  });
});
```

**Request:** one to 25 `sources` and one to 25 `targets`, a `mode`, and optionally `vehicle`,
`avoid` and `traffic`. The straight-line distance between every source and every target must be
within the mode's limit: 200 km for `driving` and `truck`, 20 km for `cycling` and 10 km for
`walking` (`routingLimits.maximumMatrixDistanceMeters`).

**Answer:** `durations` in seconds and `distances` in metres, with one row per source and one
column per target, in request order: `durations[source][target]`. A cell is `null` when no route
connects that pair. The client rejects an answer whose rows or columns do not match the request.

## Match a GPS trace to roads

Map matching snaps a recorded trace to the roads it most likely followed and describes each road,
including its speed limit where OpenStreetMap records one.

<!-- docs:check -->

```ts
import {match} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const answer = await match(
  {
    trace: [
      [-80.1327, 25.7808],
      [-80.1324, 25.784],
      [-80.1318, 25.7922],
    ],
    timestamps: [1760000000, 1760000012, 1760000031],
    accuracy: 10,
    mode: 'driving',
  },
  {apiKey},
);

for (const road of answer.roads) {
  const name = road.names[0] ?? road.class;
  const limit = road.speedLimit ? `${road.speedLimit.kmh} km/h` : 'no tagged speed limit';
  console.log(`${name}: ${Math.round(road.length)} m, ${limit}`);
}
```

**Request:**

- `trace`: 2 to 100 positions in the order they were recorded. Consecutive positions must be within
  2 km of each other, and the straight-line distance through them may not exceed 200 km.
- `timestamps` (optional): seconds since the Unix epoch, one per position, never decreasing.
- `accuracy` (optional): GPS accuracy in metres, 1–100. The default suits a phone outdoors.
- `mode` and, for `truck`, an optional `vehicle`.

**Answer:**

- `distance`, `duration` and the matched `geometry`;
- `points`: one entry per trace position, in order, with the matched `location` and its `distance`
  in metres from the recorded position, or `null` when that position was not matched;
- `roads`: the roads of the matched path, in order, with consecutive pieces of one road merged.

Each road has its `names`, OpenStreetMap `wayId`, `class` (from `routingRoadClasses`), `surface`,
`lanes`, `toll`, `bridge`, `tunnel`, `roundabout`, `length` in metres and `speedLimit`.

**Speed limits are the values tagged in OpenStreetMap, or `null`.** A limit is
`{kmh, source: 'tagged'}` only where OpenStreetMap records one; otherwise it is `null`. The service
does not infer limits from the road class or the country's defaults. A tagged value can be missing,
outdated or different from the signs on the ground.

## Find the nearest road

<!-- docs:check -->

```ts
import {nearest} from '@tileflow/routing';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const answer = await nearest({location: [-80.1312, 25.7795], mode: 'driving'}, {apiKey});

console.log(answer.road.names[0] ?? answer.road.class, answer.distance, answer.location);
console.log(answer.road.speedLimit?.kmh ?? 'no tagged speed limit');
```

The request takes one `location` and a `mode`. The answer has the nearest point of a road that
mode can use as `location`, its `distance` in metres from the requested position, and the `road`
with the same attributes as map matching, including the tagged `speedLimit` or `null`.

## Travel times and traffic

**Durations and ETAs do not include traffic.** They are estimated from the road network alone, so
they do not reflect congestion, incidents or the time of day.

Every answer states this in `traffic: 'none'`. Route, isochrone and matrix requests accept an
optional `traffic` field, and `'none'` is its only accepted value (`routingTrafficKinds`).

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

`ROUTING_NO_ROUTE` means that no road the mode can use is near a position, or that no route
connects the positions in that mode. In a matrix answer, a pair that no route connects is a `null`
cell. The client never retries; repeat an operation only after an explicit user action.

Invalid requests are rejected before any network call. Each answer must match its request: the
requested number of legs, isochrone times, matrix rows and columns, and matched trace points.

## Browser and app credentials

A publishable credential is restricted to your origins or app identifiers and can be used in client
code. Native apps pass `app: {id, certificateSha256}` so a publishable credential can admit them.
Server credentials must stay on your server.

## Contract

`@tileflow/routing/contract` exports the request and answer schemas, limits, modes, avoidances,
traffic kinds, road classes and surfaces, maneuvers, languages and error codes. Use them to validate
data that crosses your own boundaries.
