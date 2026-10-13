import assert from 'node:assert/strict';
import test from 'node:test';
import {isochrone, match, matrix, nearest, route, RoutingError} from '../src/index';

const routeRequest = {
  locations: [
    [-80.2195, 25.7655],
    [-80.1312, 25.7795],
  ] as [number, number][],
  mode: 'driving' as const,
};
const answer = {
  schemaVersion: 1,
  network: {releaseId: 'routing-v1-example'},
  attribution: '© OpenStreetMap contributors',
  traffic: 'none',
};
const routeAnswer = {
  ...answer,
  routes: [
    {
      distance: 13023,
      duration: 744.6,
      hasTolls: false,
      hasHighways: true,
      hasFerries: false,
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
  ...answer,
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

const truckRoute = {
  ...routeRequest,
  mode: 'truck' as const,
  vehicle: {heightMeters: 4.1, weightTonnes: 18, axleCount: 3, hazardousMaterials: false},
  avoid: ['tolls' as const, 'ferries' as const],
  traffic: 'none' as const,
};

test('route and isochrone send truck dimensions, avoidances and traffic as given', async () => {
  const routed = fakeFetch(() =>
    Response.json({...routeAnswer, routes: [{...routeAnswer.routes[0], hasTolls: true}]}),
  );
  const answer = await route(truckRoute, {apiKey: 'k', fetch: routed.fetcher});
  assert.deepEqual(JSON.parse(String(routed.calls[0]!.init.body)), truckRoute);
  assert.deepEqual(
    [answer.traffic, answer.routes[0]!.hasTolls, answer.routes[0]!.hasHighways],
    ['none', true, true],
  );

  const reached = fakeFetch(() => Response.json(isochroneAnswer([20])));
  const request = {
    location: [-80.13, 25.78] as [number, number],
    mode: 'truck' as const,
    minutes: [20],
    vehicle: {lengthMeters: 16.5},
    avoid: ['highways' as const],
    traffic: 'none' as const,
  };
  await isochrone(request, {apiKey: 'k', fetch: reached.fetcher});
  assert.equal(reached.calls[0]!.url, 'https://api.tileflow.dev/v1/routing/isochrone');
  assert.deepEqual(JSON.parse(String(reached.calls[0]!.init.body)), request);
});

test('travel options outside the contract never reach the network', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(routeAnswer));
  for (const invalid of [
    {mode: 'driving', vehicle: {heightMeters: 4}},
    {mode: 'truck', vehicle: {heightMeters: 12}},
    {mode: 'truck', vehicle: {axleCount: 2.5}},
    {mode: 'truck', vehicle: {colour: 'red'}},
    {avoid: ['tolls', 'tolls']},
    {avoid: ['stairs']},
    {traffic: 'live'},
  ])
    await assert.rejects(
      route({...routeRequest, ...invalid} as never, {apiKey: 'k', fetch: fetcher}),
      /Invalid Tileflow route request/,
      JSON.stringify(invalid),
    );
  await assert.rejects(
    isochrone(
      {location: [-80.13, 25.78], mode: 'walking', minutes: [5], vehicle: {heightMeters: 4}},
      {apiKey: 'k', fetch: fetcher},
    ),
    /Invalid Tileflow isochrone request/,
  );
  assert.equal(calls.length, 0);
});

test('answers without their traffic or road-use flags are refused', async () => {
  const {traffic: _traffic, ...withoutTraffic} = routeAnswer;
  const {hasTolls: _hasTolls, ...withoutTolls} = routeAnswer.routes[0]!;
  for (const body of [
    withoutTraffic,
    {...routeAnswer, traffic: 'live'},
    {...routeAnswer, routes: [withoutTolls]},
  ]) {
    const {fetcher} = fakeFetch(() => Response.json(body));
    await assert.rejects(
      route(routeRequest, {apiKey: 'k', fetch: fetcher}),
      (error) => error instanceof RoutingError && error.code === null,
    );
  }
});

const littleHavana: [number, number] = [-80.2195, 25.7655];
const southBeach: [number, number] = [-80.1312, 25.7795];
const orlando: [number, number] = [-81.3792, 28.5383];
const fortLauderdale: [number, number] = [-80.1373, 26.1224];
const matrixRequest = {
  sources: [littleHavana, southBeach],
  targets: [southBeach, fortLauderdale],
  mode: 'driving' as const,
};
const matrixAnswer = (
  durations: Array<Array<number | null>>,
  distances: Array<Array<number | null>> = durations.map((row) =>
    row.map((value) => (value === null ? null : value * 15)),
  ),
) => ({...answer, durations, distances, usage: {units: 4}});

test('matrix posts sources, targets and options and keeps unreachable pairs as null', async () => {
  const {calls, fetcher} = fakeFetch(() =>
    Response.json(
      matrixAnswer([
        [744, 12_100],
        [0, null],
      ]),
    ),
  );
  const request = {...matrixRequest, avoid: ['tolls' as const], traffic: 'none' as const};
  const grid = await matrix(request, {apiKey: 'k', fetch: fetcher});
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/routing/matrix');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), request);
  assert.deepEqual(grid.durations, [
    [744, 12_100],
    [0, null],
  ]);
  assert.deepEqual(grid.distances[1], [0, null]);
  assert.equal(grid.usage.units, 4);
});

test('matrix answers have one row per source and one column per target', async () => {
  for (const body of [
    matrixAnswer([[744, 12_100]]),
    matrixAnswer([[744], [0]]),
    matrixAnswer(
      [
        [744, 12_100],
        [0, 11_400],
      ],
      [[11_160, 181_500]],
    ),
    matrixAnswer([
      [744, 12_100],
      [0, -1],
    ]),
  ]) {
    const {fetcher} = fakeFetch(() => Response.json(body));
    await assert.rejects(
      matrix(matrixRequest, {apiKey: 'k', fetch: fetcher}),
      (error) => error instanceof RoutingError && error.code === null,
    );
  }
});

test('matrix requests outside the limits never reach the network', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(matrixAnswer([[1]])));
  for (const invalid of [
    {...matrixRequest, sources: []},
    {...matrixRequest, sources: Array(26).fill(littleHavana)},
    {...matrixRequest, targets: Array(26).fill(southBeach)},
    {...matrixRequest, mode: 'cycling'},
    {...matrixRequest, vehicle: {weightTonnes: 12}},
    {...matrixRequest, alternatives: 1},
  ])
    await assert.rejects(
      matrix(invalid as never, {apiKey: 'k', fetch: fetcher}),
      /Invalid Tileflow matrix request/,
    );
  assert.equal(calls.length, 0);
});

const trace: [number, number][] = [
  [-80.1327, 25.7808],
  [-80.1324, 25.784],
  [-80.1318, 25.7922],
];
const road = {
  names: ['Washington Avenue'],
  wayId: 11_446_118,
  class: 'secondary',
  surface: 'paved-smooth',
  lanes: 2,
  speedLimit: {kmh: 56, source: 'tagged'},
  toll: false,
  bridge: false,
  tunnel: false,
  roundabout: false,
  length: 1180,
};
const matchAnswer = (points: unknown[], roads: unknown[] = [road]) => ({
  ...answer,
  distance: 1270,
  duration: 82,
  geometry: {type: 'LineString', coordinates: trace},
  points,
  roads,
  usage: {units: 5},
});

test('match posts the trace and returns matched points and roads with tagged speed limits', async () => {
  const {calls, fetcher} = fakeFetch(() =>
    Response.json(
      matchAnswer(
        [{location: trace[0], distance: 1.2}, null, {location: trace[2], distance: 3.4}],
        [road, {...road, names: [], class: 'residential', surface: undefined, speedLimit: null}],
      ),
    ),
  );
  const request = {
    trace,
    timestamps: [1_760_000_000, 1_760_000_012, 1_760_000_012],
    accuracy: 15,
    mode: 'truck' as const,
    vehicle: {heightMeters: 3.8},
  };
  const matched = await match(request, {apiKey: 'k', fetch: fetcher});
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/routing/match');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), request);
  assert.equal(matched.points[1], null);
  assert.deepEqual(
    matched.roads.map((each) => each.speedLimit?.kmh ?? null),
    [56, null],
  );
});

test('match answers have one point per trace position and only tagged speed limits', async () => {
  for (const body of [
    matchAnswer([{location: trace[0], distance: 1.2}, null]),
    matchAnswer([null, null, null], [{...road, speedLimit: {kmh: 56, source: 'inferred'}}]),
    matchAnswer([null, null, null], []),
  ]) {
    const {fetcher} = fakeFetch(() => Response.json(body));
    await assert.rejects(
      match({trace, mode: 'driving'}, {apiKey: 'k', fetch: fetcher}),
      (error) => error instanceof RoutingError && error.code === null,
    );
  }
});

test('match requests outside the limits never reach the network', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(matchAnswer([null, null, null])));
  for (const invalid of [
    {trace: [trace[0]]},
    {trace: Array(101).fill(trace[0])},
    {trace, timestamps: [10, 20]},
    {trace, timestamps: [10, 30, 20]},
    {trace, accuracy: 0},
    {trace, accuracy: 101},
    {trace: [littleHavana, orlando]},
    {trace, avoid: ['tolls']},
    {trace, traffic: 'none'},
    {trace, vehicle: {heightMeters: 4}},
  ])
    await assert.rejects(
      match({...invalid, mode: 'driving'} as never, {apiKey: 'k', fetch: fetcher}),
      /Invalid Tileflow match request/,
      JSON.stringify(invalid),
    );
  assert.equal(calls.length, 0);
});

const nearestAnswer = {
  ...answer,
  location: [-80.1313, 25.7796],
  distance: 4.7,
  road,
  usage: {units: 1},
};

test('nearest posts one position and a mode and returns the road there', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(nearestAnswer));
  const found = await nearest(
    {location: southBeach, mode: 'walking'},
    {apiKey: 'k', fetch: fetcher},
  );
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/routing/nearest');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    location: southBeach,
    mode: 'walking',
  });
  assert.deepEqual(
    [found.distance, found.road.names[0], found.road.speedLimit],
    [4.7, 'Washington Avenue', {kmh: 56, source: 'tagged'}],
  );

  const {road: _road, ...withoutRoad} = nearestAnswer;
  const empty = fakeFetch(() => Response.json(withoutRoad));
  await assert.rejects(
    nearest({location: southBeach, mode: 'walking'}, {apiKey: 'k', fetch: empty.fetcher}),
    (error) => error instanceof RoutingError && error.code === null,
  );
  await assert.rejects(
    nearest({location: southBeach, mode: 'walking', radius: 10} as never, {
      apiKey: 'k',
      fetch: fetcher,
    }),
    /Invalid Tileflow nearest request/,
  );
  assert.equal(calls.length, 1);
});

const operations = [
  {
    path: 'route',
    body: routeAnswer,
    call: (options: Parameters<typeof route>[1]) => route(routeRequest, options),
  },
  {
    path: 'isochrone',
    body: isochroneAnswer([5]),
    call: (options: Parameters<typeof isochrone>[1]) =>
      isochrone({location: southBeach, mode: 'walking', minutes: [5]}, options),
  },
  {
    path: 'matrix',
    body: matrixAnswer([
      [744, 12_100],
      [0, 11_400],
    ]),
    call: (options: Parameters<typeof matrix>[1]) => matrix(matrixRequest, options),
  },
  {
    path: 'match',
    body: matchAnswer([null, null, null]),
    call: (options: Parameters<typeof match>[1]) => match({trace, mode: 'driving'}, options),
  },
  {
    path: 'nearest',
    body: nearestAnswer,
    call: (options: Parameters<typeof nearest>[1]) =>
      nearest({location: southBeach, mode: 'driving'}, options),
  },
];

test('every operation shares the transport: credentials, errors, redirects, size and aborts', async () => {
  for (const operation of operations) {
    const ok = fakeFetch(() => Response.json(operation.body));
    await operation.call({
      apiKey: 'tf_public_example',
      app: {id: 'com.example.app'},
      fetch: ok.fetcher,
    });
    const headers = ok.calls[0]!.init.headers as Record<string, string>;
    assert.equal(ok.calls[0]!.url, `https://api.tileflow.dev/v1/routing/${operation.path}`);
    assert.deepEqual(
      [ok.calls[0]!.init.method, ok.calls[0]!.init.redirect, headers.Authorization],
      ['POST', 'error', 'Bearer tf_public_example'],
    );
    assert.equal(headers['X-Tileflow-App'], 'com.example.app');

    const noRoute = fakeFetch(() =>
      Response.json(
        {code: 'ROUTING_NO_ROUTE', error: 'No road is near the position.', requestId: 'req_2'},
        {status: 422},
      ),
    );
    const failure = await operation.call({apiKey: 'k', fetch: noRoute.fetcher}).catch((e) => e);
    assert.ok(failure instanceof RoutingError, operation.path);
    assert.deepEqual(
      [failure.code, failure.status, failure.requestId],
      ['ROUTING_NO_ROUTE', 422, 'req_2'],
    );

    const redirected = fakeFetch(() => {
      const response = Response.json(operation.body);
      Object.defineProperty(response, 'redirected', {value: true});
      return response;
    });
    const oversized = fakeFetch(
      () =>
        new Response(JSON.stringify(operation.body), {
          headers: {'content-length': String(5 * 1024 * 1024)},
        }),
    );
    for (const {fetcher} of [redirected, oversized])
      await assert.rejects(
        operation.call({apiKey: 'k', fetch: fetcher}),
        (error) => error instanceof RoutingError && error.code === null,
        operation.path,
      );

    const controller = new AbortController();
    const reason = new Error('user left');
    const hanging = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {once: true}),
      )) as typeof fetch;
    const pending = operation.call({apiKey: 'k', fetch: hanging, signal: controller.signal});
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
  }
});
