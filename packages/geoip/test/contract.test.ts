import assert from 'node:assert/strict';
import test from 'node:test';
import {
  geoIpAvailableResponseSchema,
  geoIpResponseSchema,
  geoIpUnavailableResponseSchema,
} from '../src/contract';

test('accepts an additive available response and retains only documented fields', () => {
  const response = geoIpResponseSchema.parse({
    location: {
      city: '  Lisboa  ',
      countryCode: ' PT ',
      futureLocationField: 'ignored',
      position: [-9.1393, 38.7223],
    },
    futureEnvelopeField: {ignored: true},
    schemaVersion: 1,
    status: 'available',
    usage: {futureUsageField: true, units: 1},
  });

  assert.deepEqual(response, {
    location: {city: 'Lisboa', countryCode: 'PT', position: [-9.1393, 38.7223]},
    schemaVersion: 1,
    status: 'available',
    usage: {units: 1},
  });
});

test('requires usable known location data and exact known values', () => {
  const available = {
    location: {city: 'Lisboa'},
    schemaVersion: 1,
    status: 'available',
    usage: {units: 1},
  };

  assert.deepEqual(geoIpAvailableResponseSchema.parse(available).location, {city: 'Lisboa'});
  assert.deepEqual(
    geoIpUnavailableResponseSchema.parse({
      location: null,
      schemaVersion: 1,
      status: 'unavailable',
      usage: {units: 0},
    }).usage,
    {units: 0},
  );

  for (const response of [
    {schemaVersion: 1, status: 'available', usage: {units: 1}},
    {...available, location: {}},
    {...available, location: {city: undefined}},
    {...available, location: {futureOnly: 'ignored'}},
    {...available, location: {city: 'Lis\u0000boa'}},
    {...available, location: {continentCode: 'XX'}},
    {...available, location: {countryCode: 'XX'}},
    {...available, location: {position: [181, 0]}},
    {...available, usage: {}},
    {...available, status: 'unavailable'},
  ]) {
    assert.equal(geoIpResponseSchema.safeParse(response).success, false);
  }
});
