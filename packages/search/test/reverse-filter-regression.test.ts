import assert from 'node:assert/strict';
import test from 'node:test';
import {geocodeReverse, GeocodingError} from '../src/client';

const resultKinds = [
  'address',
  'street',
  'locality',
  'district',
  'county',
  'region',
  'country',
  'place',
  'unknown',
] as const;

test('rejects reverse results outside the requested kind filter', async () => {
  await assert.rejects(
    request(['address'], ['place']),
    (error) => error instanceof GeocodingError && /invalid response/u.test(error.message),
  );
});

test('preserves valid filtered result order and empty responses', async () => {
  const ordered = await request(['address', 'place'], ['place', 'address']);
  assert.deepEqual(
    ordered.results.map(({kind}) => kind),
    ['place', 'address'],
  );

  const empty = await request(['address'], []);
  assert.deepEqual(empty.results, []);
});

test('accepts every output kind when no reverse filter is requested', async () => {
  const result = await request(undefined, resultKinds);

  assert.deepEqual(
    result.results.map(({kind}) => kind),
    resultKinds,
  );
});

function request(
  kinds: ('address' | 'street' | 'locality' | 'place')[] | undefined,
  responseKinds: readonly (typeof resultKinds)[number][],
) {
  return geocodeReverse(
    {position: [0, 0], limit: 10, ...(kinds ? {kinds} : {})},
    {
      apiKey: 'team_test_key',
      fetch: async () =>
        Response.json({
          attribution: [{text: 'Synthetic fixture'}],
          queryId: 'gq_11111111-1111-4111-8111-111111111111',
          results: responseKinds.map((kind) => ({
            address: {},
            kind,
            label: kind,
            position: [0, 0],
          })),
          schemaVersion: 1,
          source: {id: 'synthetic', revision: 'fixture-1'},
          usage: {units: 1},
        }),
    },
  );
}
