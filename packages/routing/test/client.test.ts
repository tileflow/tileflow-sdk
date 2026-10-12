import assert from 'node:assert/strict';
import test from 'node:test';
import {isochrone, route, RoutingError} from '../src/index';

const routeRequest = {
  locations: [
    [-80.2195, 25.7655],
    [-80.1312, 25.7795],
  ] as [number, number][],
  mode: 'driving' as const,
};
const routeAnswer = {
  schemaVersion: 1,
  network: {releaseId: 'routing-v1-example'},
  attribution: '© OpenStreetMap contributors',
  routes: [
    {
      distance: 13023,
      duration: 744.6,
      geometry: {type: 'LineString', coordinates: routeRequest.locations},
      legs: [
        {
          distance: 13023,
          duration: 744.6,
          steps: [
            {
              maneuver: 'depart',
              instruction: 'Drive east.',
              distance: 13023,
              duration: 744.6,
              location: routeRequest.locations[0],
            },
            {
              maneuver: 'arrive',
              instruction: 'You have arrived.',
              distance: 0,
              duration: 0,
              location: routeRequest.locations[1],
            },
          ],
        },
      ],
    },
  ],
  usage: {units: 10},
};
const square = [
  [-80.2, 25.7],
  [-80.1, 25.7],
  [-80.1, 25.8],
  [-80.2, 25.7],
];
const isochroneAnswer = (minutes: number[]) => ({
  schemaVersion: 1,
  network: {releaseId: 'routing-v1-example'},
  attribution: '© OpenStreetMap contributors',
  isochrones: {
    type: 'FeatureCollection',
    features: minutes.map((value) => ({
      type: 'Feature',
      properties: {minutes: value},
      geometry: {type: 'Polygon', coordinates: [square]},
    })),
  },
  usage: {units: 30},
});

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return respond(url, init);
  }) as typeof fetch;
  return {calls, fetcher};
}

test('route posts the validated request with the credential and returns the answer', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(routeAnswer));
  const answer = await route(routeRequest, {apiKey: 'tf_live_example', fetch: fetcher});
  assert.equal(answer.routes[0]!.distance, 13023);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/routing/route');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.redirect, 'error');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tf_live_example');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), routeRequest);
});

test('native apps identify themselves and a loopback API is accepted', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(routeAnswer));
  await route(routeRequest, {
    apiKey: 'tf_public_example',
    apiUrl: 'http://127.0.0.1:8787/',
    app: {id: 'com.example.app', certificateSha256: 'AB:'.repeat(31) + 'AB'},
    fetch: fetcher,
  });
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8787/v1/routing/route');
  assert.equal(headers['X-Tileflow-App'], 'com.example.app');
  assert.equal(headers['X-Tileflow-App-Certificate'], 'ab'.repeat(32));
  for (const apiUrl of [
    'http://api.example.com',
    'https://user:secret@api.example.com',
    'https://api.example.com?x=1',
  ])
    await assert.rejects(
      route(routeRequest, {apiKey: 'k', apiUrl, fetch: fetcher}),
      /Invalid Tileflow API URL/,
    );
});

test('isochrone checks that each requested time comes back in order', async () => {
  const good = fakeFetch(() => Response.json(isochroneAnswer([5, 10])));
  const answer = await isochrone(
    {location: [-80.13, 25.78], mode: 'walking', minutes: [5, 10]},
    {apiKey: 'k', fetch: good.fetcher},
  );
  assert.deepEqual(
    answer.isochrones.features.map((feature) => feature.properties.minutes),
    [5, 10],
  );
  const shuffled = fakeFetch(() => Response.json(isochroneAnswer([10, 5])));
  await assert.rejects(
    isochrone(
      {location: [-80.13, 25.78], mode: 'walking', minutes: [5, 10]},
      {apiKey: 'k', fetch: shuffled.fetcher},
    ),
    (error) => error instanceof RoutingError && error.code === null,
  );
});

test('invalid requests never reach the network', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(routeAnswer));
  await assert.rejects(
    route({...routeRequest, mode: 'flying' as never}, {apiKey: 'k', fetch: fetcher}),
    /Invalid Tileflow route request/,
  );
  await assert.rejects(
    isochrone({location: [0, 0], mode: 'walking', minutes: [90]}, {apiKey: 'k', fetch: fetcher}),
    /Invalid Tileflow isochrone request/,
  );
  await assert.rejects(
    route(routeRequest, {apiKey: ' k', fetch: fetcher}),
    /Invalid Tileflow API key/,
  );
  assert.equal(calls.length, 0);
});

test('service errors keep their code only with their documented status', async () => {
  const error = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    fakeFetch(() => Response.json(body, {status, headers})).fetcher;
  const noRoute = await route(routeRequest, {
    apiKey: 'k',
    fetch: error(422, {
      code: 'ROUTING_NO_ROUTE',
      error: 'No route connects these locations.',
      requestId: 'req_1',
    }),
  }).catch((e) => e);
  assert.ok(noRoute instanceof RoutingError);
  assert.deepEqual(
    [noRoute.code, noRoute.status, noRoute.requestId, noRoute.message],
    ['ROUTING_NO_ROUTE', 422, 'req_1', 'No route connects these locations.'],
  );

  const limited = await route(routeRequest, {
    apiKey: 'k',
    fetch: error(
      429,
      {code: 'ROUTING_RATE_LIMITED', error: 'Too many Routing requests.'},
      {'Retry-After': '30'},
    ),
  }).catch((e) => e);
  assert.deepEqual([limited.code, limited.retryAfterSeconds], ['ROUTING_RATE_LIMITED', 30]);

  const denied = await route(routeRequest, {
    apiKey: 'k',
    fetch: error(401, {code: 'ROUTING_ACCESS_DENIED', error: 'The credential cannot use Routing.'}),
  }).catch((e) => e);
  assert.equal(denied.code, 'ROUTING_ACCESS_DENIED');

  const mismatched = await route(routeRequest, {
    apiKey: 'k',
    fetch: error(500, {code: 'ROUTING_NO_ROUTE', error: 'Wrong status.'}),
  }).catch((e) => e);
  assert.deepEqual([mismatched.code, mismatched.status], [null, 500]);
});

test('answers outside the contract, too large or redirected are refused', async () => {
  for (const respond of [
    () => Response.json({...routeAnswer, usage: undefined}),
    () => Response.json({...routeAnswer, routes: [routeAnswer.routes[0], routeAnswer.routes[0]]}),
    () =>
      new Response('x'.repeat(5 * 1024 * 1024), {headers: {'content-type': 'application/json'}}),
    () => new Response('{"broken"', {headers: {'content-type': 'application/json'}}),
  ]) {
    const {fetcher} = fakeFetch(respond);
    await assert.rejects(
      route(routeRequest, {apiKey: 'k', fetch: fetcher}),
      (error) => error instanceof RoutingError && error.code === null,
    );
  }
});

test('aborting rejects with the signal reason; network failures have status 0', async () => {
  const controller = new AbortController();
  const hanging = (async (_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) =>
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {once: true}),
    )) as typeof fetch;
  const pending = route(routeRequest, {apiKey: 'k', fetch: hanging, signal: controller.signal});
  const reason = new Error('user left');
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  const offline = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(
    route(routeRequest, {apiKey: 'k', fetch: offline}),
    (error) => error instanceof RoutingError && error.status === 0,
  );
});
