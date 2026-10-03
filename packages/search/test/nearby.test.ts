import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeocodingError,
  listCategories,
  resolvePlace,
  resolveSuggestion,
  searchNearby,
} from '../src/client';
import {nearbyLimits, nearbyRequestSchema, nearbyResponseSchema} from '../src/contract';

const source = {id: 'synthetic', revision: null};
const attribution = [{text: 'Synthetic fixture'}];
const success = {
  schemaVersion: 1,
  provider: 'aws',
  results: [],
  nextCursor: 'opaque-next',
  source,
  attribution,
  usage: {units: 25},
};

test('category metadata makes one authenticated GET with zero units', async () => {
  let calls = 0;
  const response = await listCategories({
    apiKey: 'team_test',
    fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.method, 'GET');
      assert.equal(request.body, null);
      assert.equal(request.headers.get('authorization'), 'Bearer team_test');
      assert.ok(request.url.endsWith('/v1/geocoding/categories'));
      return Response.json({
        schemaVersion: 1,
        provider: 'aws',
        categories: [{id: 'category,_with space', name: 'Category'}],
        source,
        attribution,
        usage: {units: 0},
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(response.usage.units, 0);
  assert.equal(response.categories[0].id, 'category,_with space');
});

test('empty pages preserve continuation without automatically fetching another page', async () => {
  const requests: unknown[] = [];
  const options = {
    apiKey: 'team_test',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(await request.json());
      return Response.json(success);
    },
  };
  const first = await searchNearby({position: [0, 0]}, options);
  assert.deepEqual(requests, [{position: [0, 0], limit: 20}]);
  assert.equal(first.usage.units, 25);
  assert.equal(first.nextCursor, 'opaque-next');
  await searchNearby({position: [0, 0], cursor: first.nextCursor}, options);
  assert.equal(requests.length, 2);
  assert.equal((requests[1] as {cursor: string}).cursor, first.nextCursor);
  assert.equal(resolvePlace, resolveSuggestion);
});

test('unsupported spatial intersection, persistence, provider controls and malformed cursors never fetch', async () => {
  let calls = 0;
  for (const query of [
    {position: [0, 0], bounds: [-1, -1, 1, 1], radiusMeters: 100},
    {position: [0, 0], retention: 'persistent'},
    {position: [0, 0], AdditionalFeatures: ['Contact']},
    {position: [0, 0], cursor: 'x'.repeat(8193)},
    {position: [0, 0], query: 'Cafe'},
    {position: [0, 0], radiusMeters: 0},
  ]) {
    await assert.rejects(
      searchNearby(query as never, {
        apiKey: 'team_test',
        fetch: async () => {
          calls++;
          return Response.json(success);
        },
      }),
    );
  }
  assert.equal(calls, 0);
  assert.equal(nearbyRequestSchema.parse({position: [0, 0], limit: 100}).limit, 100);
});

test('100 bounded multibyte POIs and a maximum cursor fit the page; overflow and raw fields fail', async () => {
  const place = {
    kind: 'place',
    position: [0, 0],
    label: '界'.repeat(512),
    name: '界'.repeat(200),
    address: {},
    categories: [{id: 'literal, category', name: '界'.repeat(100)}],
    token: 'a'.repeat(2048),
  };
  const page = {
    ...success,
    results: Array.from({length: 100}, () => place),
    nextCursor: 'a'.repeat(8192),
  };
  assert.equal(nearbyResponseSchema.safeParse(page).success, true);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(page)).byteLength <= nearbyLimits.maximumResponseBytes,
  );
  const response = await searchNearby(
    {position: [0, 0], limit: 100},
    {apiKey: 'test', fetch: async () => Response.json(page)},
  );
  assert.equal(response.results.length, 100);
  assert.equal(
    nearbyResponseSchema.safeParse({...page, results: [{...place, PlaceId: 'private'}]}).success,
    false,
  );
  await assert.rejects(
    searchNearby(
      {position: [0, 0]},
      {apiKey: 'test', fetch: async () => new Response('x'.repeat(512 * 1024 + 1))},
    ),
  );
});

test('typed admission errors expose bounded Retry-After without retrying or asserting zero usage', async () => {
  for (const [value, expected] of [
    ['60', 60],
    ['-1', null],
    ['Infinity', null],
    ['999999999', null],
    ['private', null],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      searchNearby(
        {position: [0, 0]},
        {
          apiKey: 'test',
          fetch: async () => {
            calls++;
            return Response.json(
              {code: 'GEOCODING_EVALUATION_EXHAUSTED', error: 'Search evaluation limit reached'},
              {status: 429, headers: {'Retry-After': value}},
            );
          },
        },
      ),
      (error) =>
        error instanceof GeocodingError &&
        error.code === 'GEOCODING_EVALUATION_EXHAUSTED' &&
        error.retryAfterSeconds === expected,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    searchNearby(
      {position: [0, 0]},
      {
        apiKey: 'test',
        fetch: async () =>
          Response.json(
            {code: 'GEOCODING_USAGE_UNCONFIRMED', error: 'Search completion is unconfirmed'},
            {status: 503},
          ),
      },
    ),
    (error) =>
      error instanceof GeocodingError &&
      error.code === 'GEOCODING_USAGE_UNCONFIRMED' &&
      !('usage' in error),
  );
});
