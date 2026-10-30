import assert from 'node:assert/strict';
import test from 'node:test';
import {
  elevateLineString,
  elevateMultiLineString,
  elevation,
  elevationApiUnits,
  elevationBatch,
  ElevationError,
  elevationPoints,
  elevationProfile,
} from '../src/index';

const attribution = '© Mapterhorn (https://mapterhorn.com/attribution)';
const pointsAnswer = (positions: number[][], unit = 'meters') => ({
  schemaVersion: 1,
  unit,
  dataset: {releaseId: 'mapterhorn-0.0.11', zoom: 12},
  attribution,
  usage: {units: 1},
  positions: positions.map(([lng, lat]) => [lng, lat, lng! < 0 ? null : 1000 + lng!]),
});
const profileAnswer = {
  schemaVersion: 1,
  unit: 'meters',
  dataset: {releaseId: 'mapterhorn-0.0.11', zoom: 12},
  attribution,
  usage: {units: 1},
  interval: 30,
  samples: [
    [6.86, 45.83, 1500, 0],
    [6.8601, 45.8303, 1510, 30],
  ],
  lines: [[0, 1]],
  summary: {
    distance: 30,
    ascent: 10,
    descent: 0,
    minElevation: 1500,
    maxElevation: 1510,
    startElevation: 1500,
    endElevation: 1510,
    maxGrade: 33.3,
    minGrade: 33.3,
  },
};

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return respond(url, init);
  }) as typeof fetch;
  return {calls, fetcher};
}
const body = (init: RequestInit) => JSON.parse(String(init.body)) as {positions: number[][]};

test('points post the validated request with the credential and return the answer', async () => {
  const {calls, fetcher} = fakeFetch((_url, init) =>
    Response.json(pointsAnswer(body(init).positions)),
  );
  const answer = await elevationPoints(
    {positions: [[6.86514, 45.83264]]},
    {apiKey: 'tf_live_example', fetch: fetcher},
  );
  assert.deepEqual(answer.positions, [[6.86514, 45.83264, 1006.86514]]);
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/elevation/points');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.redirect, 'error');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tf_live_example');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('native apps identify themselves and a loopback API is accepted', async () => {
  const {calls, fetcher} = fakeFetch((_url, init) =>
    Response.json(pointsAnswer(body(init).positions)),
  );
  await elevation([1, 2], {
    apiKey: 'tf_public_example',
    apiUrl: 'http://127.0.0.1:8787/',
    app: {id: 'com.example.app', certificateSha256: 'AB:'.repeat(31) + 'AB'},
    fetch: fetcher,
  });
  assert.equal(calls[0]!.url, 'http://127.0.0.1:8787/v1/elevation/points');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['X-Tileflow-App'], 'com.example.app');
  assert.equal(headers['X-Tileflow-App-Certificate'], 'ab'.repeat(32));
  for (const apiUrl of [
    'http://api.example.com',
    'https://user:secret@api.example.com',
    'https://api.example.com/?x=1',
  ])
    await assert.rejects(
      elevation([1, 2], {apiKey: 'tf_live_example', apiUrl, fetch: fetcher}),
      /API URL/u,
    );
});

test('invalid requests never reach the network', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json({}));
  const options = {apiKey: 'tf_live_example', fetch: fetcher};
  await assert.rejects(
    elevationPoints({positions: []}, options),
    /Invalid Tileflow elevation request/u,
  );
  await assert.rejects(elevationPoints({positions: Array(101).fill([0, 0])}, options));
  await assert.rejects(elevationPoints({positions: [[181, 0]]}, options));
  await assert.rejects(elevationProfile({} as never, options), /profile request/u);
  await assert.rejects(elevationBatch([[0, 91]] as never, options), /positions/u);
  assert.equal(calls.length, 0);
});

test('a batch splits into requests of 100 and keeps the order', async () => {
  const {calls, fetcher} = fakeFetch(async (_url, init) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    return Response.json(pointsAnswer(body(init).positions));
  });
  const positions = Array.from(
    {length: 250},
    (_value, index) => [index / 10, 0] as [number, number],
  );
  const batch = await elevationBatch(positions, {apiKey: 'tf_live_example', fetch: fetcher});
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => body(call.init).positions.length).sort((a, b) => a - b),
    [50, 100, 100],
  );
  assert.deepEqual(
    batch.positions.map(([lng]) => lng),
    positions.map(([lng]) => lng),
  );
  assert.equal(batch.units, 3);
  assert.equal(batch.attribution, attribution);
  assert.equal(elevationApiUnits(250), 3);
  const empty = await elevationBatch([], {apiKey: 'tf_live_example', fetch: fetcher});
  assert.deepEqual(empty.positions, []);
  assert.equal(calls.length, 3);
});

test('lines gain a third coordinate where the position has an elevation', async () => {
  const {fetcher} = fakeFetch((_url, init) => Response.json(pointsAnswer(body(init).positions)));
  const options = {apiKey: 'tf_live_example', fetch: fetcher};
  const line = {
    type: 'LineString' as const,
    coordinates: [
      [1, 0, 99],
      [-1, 0],
    ],
  };
  assert.deepEqual(await elevateLineString(line, options), {
    type: 'LineString',
    coordinates: [
      [1, 0, 1001],
      [-1, 0],
    ],
  });
  // The input is not changed.
  assert.deepEqual(line.coordinates, [
    [1, 0, 99],
    [-1, 0],
  ]);
  assert.deepEqual(
    await elevateMultiLineString(
      {
        type: 'MultiLineString',
        coordinates: [
          [
            [1, 0],
            [2, 0],
          ],
          [
            [3, 0],
            [4, 0],
          ],
        ],
      },
      options,
    ),
    {
      type: 'MultiLineString',
      coordinates: [
        [
          [1, 0, 1001],
          [2, 0, 1002],
        ],
        [
          [3, 0, 1003],
          [4, 0, 1004],
        ],
      ],
    },
  );
});

test('a profile returns the API answer after checking its lines', async () => {
  const {calls, fetcher} = fakeFetch(() => Response.json(profileAnswer));
  const request = {
    line: {
      type: 'LineString' as const,
      coordinates: [
        [6.86, 45.83],
        [6.8601, 45.8303],
      ],
    },
    interval: 30,
  };
  const answer = await elevationProfile(request, {apiKey: 'tf_live_example', fetch: fetcher});
  assert.equal(answer.summary.ascent, 10);
  assert.equal(calls[0]!.url, 'https://api.tileflow.dev/v1/elevation/profile');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), request);
  const broken = fakeFetch(() => Response.json({...profileAnswer, lines: [[0, 5]]}));
  await assert.rejects(
    elevationProfile(request, {apiKey: 'tf_live_example', fetch: broken.fetcher}),
    (error: unknown) => error instanceof ElevationError && /invalid response/u.test(error.message),
  );
  const feet = fakeFetch(() => Response.json(profileAnswer));
  await assert.rejects(
    elevationProfile({...request, unit: 'feet'}, {apiKey: 'tf_live_example', fetch: feet.fetcher}),
    ElevationError,
  );
});

test('error codes are trusted only with their documented status', async () => {
  const respond = (status: number, code: string, headers: Record<string, string> = {}) =>
    fakeFetch(() =>
      Response.json(
        {code, error: 'Too many Elevation requests.', requestId: 'req_1'},
        {status, headers},
      ),
    ).fetcher;
  await assert.rejects(
    elevation([0, 0], {
      apiKey: 'tf_live_example',
      fetch: respond(429, 'ELEVATION_RATE_LIMITED', {'Retry-After': '7'}),
    }),
    (error: unknown) =>
      error instanceof ElevationError &&
      error.code === 'ELEVATION_RATE_LIMITED' &&
      error.status === 429 &&
      error.retryAfterSeconds === 7 &&
      error.requestId === 'req_1',
  );
  await assert.rejects(
    elevation([0, 0], {apiKey: 'tf_live_example', fetch: respond(500, 'ELEVATION_RATE_LIMITED')}),
    (error: unknown) =>
      error instanceof ElevationError && error.code === null && error.status === 500,
  );
  await assert.rejects(
    elevation([0, 0], {apiKey: 'tf_live_example', fetch: respond(401, 'ELEVATION_ACCESS_DENIED')}),
    (error: unknown) => error instanceof ElevationError && error.code === 'ELEVATION_ACCESS_DENIED',
  );
});

test('oversized answers and network failures are Elevation errors; aborts keep their reason', async () => {
  const large = fakeFetch(
    () => new Response('{}', {headers: {'Content-Length': String(600 * 1024)}}),
  );
  await assert.rejects(
    elevation([0, 0], {apiKey: 'tf_live_example', fetch: large.fetcher}),
    (error: unknown) => error instanceof ElevationError && /invalid response/u.test(error.message),
  );
  const offline = fakeFetch(() => {
    throw new TypeError('network down');
  });
  await assert.rejects(
    elevation([0, 0], {apiKey: 'tf_live_example', fetch: offline.fetcher}),
    (error: unknown) => error instanceof ElevationError && error.status === 0,
  );
  const controller = new AbortController();
  const reason = new Error('reader left');
  controller.abort(reason);
  const aborted = fakeFetch(() => {
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(
    elevation([0, 0], {
      apiKey: 'tf_live_example',
      fetch: aborted.fetcher,
      signal: controller.signal,
    }),
    (error: unknown) => error === reason,
  );
});
