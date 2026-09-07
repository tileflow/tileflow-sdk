import assert from 'node:assert/strict';
import test from 'node:test';
import {
  geocodingForwardRequestSchema,
  geocodingForwardResponseSchema,
  geocodingLimits,
  geocodingReverseRequestSchema,
  geocodingReverseResponseSchema,
  reverseGeocodingKindSchema,
} from '../src/contract';

const queryId = 'gq_11111111-1111-4111-8111-111111111111';

test('normalizes one bounded forward request', () => {
  assert.deepEqual(
    geocodingForwardRequestSchema.parse({
      bounds: [-10, 37, -8, 40],
      language: 'pt-PT',
      limit: 5,
      query: '  Rua Tileflow 42, Lisboa  ',
    }),
    {
      bounds: [-10, 37, -8, 40],
      language: 'pt-PT',
      limit: 5,
      query: 'Rua Tileflow 42, Lisboa',
      retention: 'temporary',
    },
  );
  assert.equal(geocodingLimits.defaultLimit, 5);
  assert.equal(geocodingLimits.maximumLimit, 10);
  assert.equal(geocodingLimits.maximumQueryCharacters, 200);
});

test('defaults retention and accepts both retention modes', () => {
  assert.equal(geocodingForwardRequestSchema.parse({query: 'Lisboa'}).retention, 'temporary');
  assert.equal(
    geocodingForwardRequestSchema.parse({query: 'Lisboa', retention: 'persistent'}).retention,
    'persistent',
  );
});

test('accepts 200 query characters and rejects 201 without truncation', () => {
  const maximum = 'x'.repeat(200);

  assert.equal(geocodingForwardRequestSchema.parse({query: maximum}).query, maximum);
  assert.equal(geocodingForwardRequestSchema.safeParse({query: `${maximum}x`}).success, false);
});

test('rejects unknown fields, controls, wrapping bounds and invalid coordinates', () => {
  for (const request of [
    {query: 'Lisboa', provider: 'photon'},
    {query: 'Lisboa\u0000'},
    {query: 'Lisboa', bounds: [10, 37, -8, 40]},
    {query: 'Lisboa', bounds: [-10, 40, -8, 37]},
    {query: 'Lisboa', bounds: [-10, 37, -8, 40], proximity: [-9.1393, 38.7223]},
    {query: 'Lisboa', proximity: [181, 0]},
    {query: 'Lisboa', language: 'EN_us'},
    {query: 'Lisboa', limit: 11},
    {query: 'Lisboa', retention: 'session'},
    {query: ' '.repeat(4)},
  ]) {
    assert.equal(geocodingForwardRequestSchema.safeParse(request).success, false);
  }
});

test('accepts a strict normalized success including zero candidates', () => {
  const empty = geocodingForwardResponseSchema.parse({
    attribution: [{text: 'Synthetic fixture'}],
    queryId,
    results: [],
    schemaVersion: 1,
    source: {id: 'synthetic', revision: 'fixture-1'},
    usage: {units: 1},
  });
  assert.equal(empty.results.length, 0);

  const unknownRevision = geocodingForwardResponseSchema.parse({
    ...empty,
    source: {id: 'synthetic', revision: null},
  });
  assert.equal(unknownRevision.source.revision, null);

  const result = geocodingForwardResponseSchema.parse({
    attribution: [
      {
        text: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
      },
    ],
    queryId,
    results: [
      {
        address: {city: 'Lisboa', country: 'Portugal', countryCode: 'PT'},
        bounds: [-9.14, 38.722, -9.1385, 38.7227],
        kind: 'address',
        label: 'Rua Tileflow 42, Lisboa, Portugal',
        position: [-9.1393, 38.7223],
        sourceRef: 'node/1003',
      },
    ],
    schemaVersion: 1,
    source: {id: 'openstreetmap', revision: 'example-snapshot'},
    usage: {units: 1},
  });
  assert.equal(result.results[0]?.kind, 'address');
});

test('rejects provider leakage and unsafe or malformed results', () => {
  const base = {
    attribution: [{text: 'Synthetic fixture'}],
    queryId,
    results: [],
    schemaVersion: 1,
    source: {id: 'synthetic', revision: 'fixture-1'},
    usage: {units: 1},
  };

  for (const response of [
    {...base, provider: 'photon'},
    {...base, query: 'secret'},
    {...base, usage: {units: 0}},
    {...base, queryId: 'query-1'},
    {...base, attribution: [{text: 'Source', url: 'http://example.com'}]},
    {...base, attribution: [{text: 'Source', url: 'https://example.com/\n'}]},
    {
      ...base,
      results: [
        {
          address: {},
          kind: 'place',
          label: 'Place',
          position: [200, 0],
          properties: {osm_id: 1},
        },
      ],
    },
  ]) {
    assert.equal(geocodingForwardResponseSchema.safeParse(response).success, false);
  }
});

test('normalizes one strict reverse request with reverse defaults', () => {
  assert.deepEqual(
    geocodingReverseRequestSchema.parse({
      language: 'pt-PT',
      position: [-9.1393, 38.7223],
    }),
    {
      language: 'pt-PT',
      limit: 1,
      position: [-9.1393, 38.7223],
      retention: 'temporary',
    },
  );
  assert.equal(geocodingLimits.defaultReverseLimit, 1);
});

test('accepts exact WGS84 reverse boundaries in longitude-latitude order', () => {
  assert.deepEqual(
    geocodingReverseRequestSchema.parse({position: [-180, -90]}).position,
    [-180, -90],
  );
  assert.deepEqual(geocodingReverseRequestSchema.parse({position: [180, 90]}).position, [180, 90]);

  for (const position of [
    [-181, 0],
    [181, 0],
    [0, -91],
    [0, 91],
    [38.7223, -181],
    [-9.1393],
    [-9.1393, 38.7223, 12],
    ['-9.1393', 38.7223],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ]) {
    assert.equal(geocodingReverseRequestSchema.safeParse({position}).success, false);
  }
});

test('accepts one or many common reverse kinds and excludes administrative and unknown filters', () => {
  assert.deepEqual(reverseGeocodingKindSchema.options, ['address', 'street', 'locality', 'place']);
  assert.deepEqual(
    geocodingReverseRequestSchema.parse({position: [0, 0], kinds: ['address']}).kinds,
    ['address'],
  );
  assert.deepEqual(
    geocodingReverseRequestSchema.parse({
      position: [0, 0],
      kinds: ['address', 'street', 'locality', 'place'],
    }).kinds,
    ['address', 'street', 'locality', 'place'],
  );
  assert.deepEqual(
    geocodingReverseRequestSchema.parse({
      position: [0, 0],
      kinds: ['address', 'address'],
    }).kinds,
    ['address', 'address'],
  );

  for (const kinds of [[], ['district'], ['county'], ['region'], ['country'], ['unknown']]) {
    assert.equal(geocodingReverseRequestSchema.safeParse({position: [0, 0], kinds}).success, false);
  }
});

test('rejects unsupported reverse options and preserves every output kind', () => {
  for (const request of [
    {position: [0, 0], provider: 'photon'},
    {position: [0, 0], radius: 10},
    {position: [0, 0], limit: 0},
    {position: [0, 0], limit: 11},
    {position: [0, 0], language: 'EN_us'},
    {position: [0, 0], retention: 'session'},
  ]) {
    assert.equal(geocodingReverseRequestSchema.safeParse(request).success, false);
  }

  const results = [
    'address',
    'street',
    'locality',
    'district',
    'county',
    'region',
    'country',
    'place',
    'unknown',
  ].map((kind) => ({address: {}, kind, label: kind, position: [0, 0]}));
  const response = geocodingReverseResponseSchema.parse({
    attribution: [{text: 'Synthetic fixture'}],
    queryId,
    results,
    schemaVersion: 1,
    source: {id: 'synthetic', revision: null},
    usage: {units: 1},
  });

  assert.deepEqual(
    response.results.map(({kind}) => kind),
    results.map(({kind}) => kind),
  );
  assert.equal(geocodingReverseResponseSchema, geocodingForwardResponseSchema);
});
