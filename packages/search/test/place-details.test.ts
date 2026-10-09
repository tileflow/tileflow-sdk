import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autocomplete,
  geocode,
  geocodeReverse,
  GeocodingError,
  resolvePlace,
  searchNearby,
} from '../src/client';
import {
  autocompleteRequestSchema,
  autocompleteResponseSchema,
  geocodingForwardRequestSchema,
  geocodingResultSchema,
  searchOperationUnits,
} from '../src/contract';

const attribution = [{text: 'Synthetic fixture'}];
const source = {id: 'synthetic', revision: 'fixture-1'};
const place = {
  address: {street: 'Synthetic Street', houseNumber: '12', city: 'Example City'},
  kind: 'place',
  label: 'Example Café, 12 Synthetic Street, Example City',
  name: 'Example Café',
  position: [-3.7, 40.4],
  distanceMeters: 120,
  categories: [{id: 'coffee_shop', name: 'Coffee Shop', primary: true}],
  foodTypes: [{id: 'spanish', name: 'Spanish', primary: true}],
};
const details = {
  contacts: {
    phones: [{value: '+34 600 000 000'}],
    websites: [{value: 'https://example.test/cafe', label: 'Menu'}],
  },
  openingHours: [{display: ['Mon-Fri: 08:00 - 20:00'], openNow: true}],
  timeZone: {name: 'Europe/Madrid', utcOffsetSeconds: 7_200},
  accessPoints: [{position: [-3.7001, 40.4001]}],
};

function respond(body: unknown, requests: Request[] = []) {
  return {
    apiKey: 'team_test_key',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(body);
    },
  };
}

test('prices each operation by what it returns', () => {
  assert.equal(searchOperationUnits('categories'), 0);
  assert.equal(searchOperationUnits('autocomplete'), 10);
  assert.equal(searchOperationUnits('autocomplete', ['place']), 25);
  for (const operation of ['forward', 'reverse', 'resolve', 'nearby'] as const) {
    assert.equal(searchOperationUnits(operation), 25);
    assert.equal(searchOperationUnits(operation, ['timeZone']), 75);
  }
});

test('accepts only known, unique place details and only places in autocomplete', () => {
  assert.equal(
    geocodingForwardRequestSchema.safeParse({query: 'café', include: ['contacts', 'openingHours']})
      .success,
    true,
  );
  for (const include of [[], ['contacts', 'contacts'], ['photos'], ['place']]) {
    assert.equal(geocodingForwardRequestSchema.safeParse({query: 'café', include}).success, false);
  }
  assert.equal(
    autocompleteRequestSchema.safeParse({query: 'caf', include: ['place']}).success,
    true,
  );
  for (const include of [[], ['contacts'], ['place', 'place']]) {
    assert.equal(autocompleteRequestSchema.safeParse({query: 'caf', include}).success, false);
  }
});

test('reads distance, food types and requested details strictly', () => {
  assert.deepEqual(geocodingResultSchema.parse({...place, ...details}), {...place, ...details});
  for (const invalid of [
    {...place, distanceMeters: -1},
    {...place, foodTypes: []},
    {...place, contacts: {phones: []}},
    {...place, contacts: {faxes: [{value: '+34 600 000 001'}]}},
    {...place, openingHours: [{display: []}]},
    {...place, timeZone: {name: 'Europe/Madrid', utcOffsetSeconds: 1.5}},
    {...place, accessPoints: [{position: [200, 0]}]},
  ]) {
    assert.equal(geocodingResultSchema.safeParse(invalid).success, false);
  }
});

test('asks for contacts and hours only where a text search or selected place supplies them', async () => {
  for (const call of [
    () => geocode({query: 'café', include: ['contacts']}, respond({})),
    () => geocodeReverse({position: [-3.7, 40.4], include: ['openingHours']}, respond({})),
  ]) {
    await assert.rejects(call(), (error) => {
      assert.ok(error instanceof GeocodingError);
      assert.equal(error.code, 'GEOCODING_FILTER_UNSUPPORTED');
      assert.equal(error.status, 422);
      return true;
    });
  }

  const requests: Request[] = [];
  const body = {
    attribution,
    queryId: 'gq_11111111-1111-4111-8111-111111111111',
    results: [{...place, ...details}],
    schemaVersion: 1,
    source,
    usage: {units: 75},
  };
  const result = await geocode(
    {query: 'café', bounds: [-3.8, 40.3, -3.6, 40.5], include: ['contacts', 'openingHours']},
    respond(body, requests),
  );
  assert.deepEqual(result.results[0]?.openingHours, details.openingHours);
  assert.ok(requests[0]);
  assert.deepEqual((await requests[0].json()).include, ['contacts', 'openingHours']);

  const reverse = await geocodeReverse(
    {position: [-3.7, 40.4], include: ['timeZone']},
    respond({...body, results: [{...place, timeZone: details.timeZone}]}),
  );
  assert.equal(reverse.results[0]?.timeZone?.name, 'Europe/Madrid');
});

test('rejects a response whose units do not match the requested details', async () => {
  const body = {
    attribution,
    queryId: 'gq_11111111-1111-4111-8111-111111111111',
    results: [place],
    schemaVersion: 1,
    source,
    usage: {units: 25},
  };
  await assert.rejects(
    geocode(
      {query: 'café', bounds: [-3.8, 40.3, -3.6, 40.5], include: ['contacts']},
      respond(body),
    ),
    /invalid response/u,
  );
  await assert.rejects(
    geocode({query: 'café'}, respond({...body, usage: {units: 75}})),
    /invalid response/u,
  );
  await assert.rejects(
    resolvePlace(
      {token: 'opaque-token_1', include: ['timeZone']},
      respond({
        attribution,
        result: place,
        schemaVersion: 1,
        source,
        usage: {units: 25},
      }),
    ),
    /invalid response/u,
  );
  await assert.rejects(
    searchNearby(
      {position: [-3.7, 40.4], include: ['openingHours']},
      respond({
        attribution,
        provider: 'aws',
        results: [],
        schemaVersion: 1,
        source,
        usage: {units: 25},
      }),
    ),
    /invalid response/u,
  );
});

test('returns address lines with plain suggestions and places only when asked', async () => {
  const plain = {
    attribution,
    schemaVersion: 1,
    source,
    suggestions: [
      {
        kind: 'place',
        label: 'Example Café',
        addressLabel: 'Example Café, 12 Synthetic Street, Example City',
        token: 'opaque-token_1',
      },
    ],
    usage: {units: 10},
  };
  const result = await autocomplete({query: 'exam'}, respond(plain));
  assert.equal(result.suggestions[0]?.addressLabel, plain.suggestions[0]?.addressLabel);

  const withPlaces = {
    ...plain,
    suggestions: [{...plain.suggestions[0], place}],
    usage: {units: 25},
  };
  assert.equal(autocompleteResponseSchema.safeParse(withPlaces).success, true);
  const requests: Request[] = [];
  const detailed = await autocomplete(
    {query: 'exam', include: ['place']},
    respond(withPlaces, requests),
  );
  assert.deepEqual(detailed.suggestions[0]?.place?.position, place.position);
  assert.ok(requests[0]);
  assert.deepEqual((await requests[0].json()).include, ['place']);

  for (const [request, body] of [
    [{query: 'exam'}, {...withPlaces, usage: {units: 10}}],
    [
      {query: 'exam', include: ['place']},
      {...plain, usage: {units: 25}},
    ],
    [
      {query: 'exam', include: ['place']},
      {...withPlaces, usage: {units: 10}},
    ],
  ] as const) {
    await assert.rejects(autocomplete(request, respond(body)), /invalid response/u);
  }
});
