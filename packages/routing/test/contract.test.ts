import assert from 'node:assert/strict';
import test from 'node:test';
import {
  routingDirectDistance,
  routingErrorCodes,
  routingErrorStatus,
  routingIsochroneRequestSchema,
  routingIsochroneResponseSchema,
  routingLanguages,
  routingManeuvers,
  routingRouteRequestSchema,
  routingRouteResponseSchema,
} from '../src/contract';

const littleHavana: [number, number] = [-80.2195, 25.7655];
const southBeach: [number, number] = [-80.1312, 25.7795];
const orlando: [number, number] = [-81.3792, 28.5383];

test('a route request takes two to five positions, a mode and nothing else', () => {
  assert.ok(
    routingRouteRequestSchema.safeParse({locations: [littleHavana, southBeach], mode: 'driving'})
      .success,
  );
  for (const invalid of [
    {locations: [littleHavana], mode: 'driving'},
    {locations: Array(6).fill(littleHavana), mode: 'driving'},
    {locations: [littleHavana, southBeach], mode: 'flying'},
    {locations: [littleHavana, southBeach], mode: 'driving', costing: 'auto'},
    {locations: [[-181, 0], southBeach], mode: 'driving'},
    {locations: [littleHavana, southBeach], mode: 'driving', language: 'xx-XX'},
    {locations: [littleHavana, southBeach, littleHavana], mode: 'driving', alternatives: 1},
  ])
    assert.equal(
      routingRouteRequestSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
});

test('each mode limits the straight-line distance through the positions', () => {
  assert.ok(routingDirectDistance(littleHavana, orlando) > 300_000);
  assert.ok(
    routingRouteRequestSchema.safeParse({locations: [littleHavana, orlando], mode: 'driving'})
      .success,
  );
  for (const mode of ['walking', 'cycling'])
    assert.equal(
      routingRouteRequestSchema.safeParse({locations: [littleHavana, orlando], mode}).success,
      false,
    );
});

test('an isochrone asks for one to four rising whole minutes up to an hour', () => {
  assert.ok(
    routingIsochroneRequestSchema.safeParse({
      location: southBeach,
      mode: 'walking',
      minutes: [5, 10, 15],
    }).success,
  );
  for (const minutes of [[], [0], [61], [10, 5], [5, 5], [1, 2, 3, 4, 5], [2.5]])
    assert.equal(
      routingIsochroneRequestSchema.safeParse({location: southBeach, mode: 'walking', minutes})
        .success,
      false,
    );
});

test('answers carry attribution, the network and usage', () => {
  const routeAnswer = {
    schemaVersion: 1,
    network: {releaseId: 'routing-v1-example'},
    attribution: '© OpenStreetMap contributors',
    routes: [
      {
        distance: 1409,
        duration: 1003.8,
        geometry: {type: 'LineString', coordinates: [littleHavana, southBeach]},
        legs: [
          {
            distance: 1409,
            duration: 1003.8,
            steps: [
              {
                maneuver: 'depart',
                instruction: 'Walk east.',
                distance: 1409,
                duration: 1003.8,
                location: littleHavana,
              },
              {
                maneuver: 'arrive',
                instruction: 'You have arrived.',
                distance: 0,
                duration: 0,
                location: southBeach,
              },
            ],
          },
        ],
      },
    ],
    usage: {units: 10},
  };
  assert.ok(routingRouteResponseSchema.safeParse(routeAnswer).success);
  const {usage: _usage, ...withoutUsage} = routeAnswer;
  assert.equal(routingRouteResponseSchema.safeParse(withoutUsage).success, false);
  assert.equal(
    routingRouteResponseSchema.safeParse({...routeAnswer, attribution: 'Someone else'}).success,
    false,
  );
  const square = [
    [-80.2, 25.7],
    [-80.1, 25.7],
    [-80.1, 25.8],
    [-80.2, 25.7],
  ];
  assert.ok(
    routingIsochroneResponseSchema.safeParse({
      schemaVersion: 1,
      network: {releaseId: 'routing-v1-example'},
      attribution: '© OpenStreetMap contributors',
      isochrones: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {minutes: 5},
            geometry: {type: 'Polygon', coordinates: [square]},
          },
        ],
      },
      usage: {units: 30},
    }).success,
  );
});

test('the published lists are complete and every error code has its status', () => {
  assert.equal(routingLanguages.length, 33);
  assert.ok(routingLanguages.includes('en-US'));
  assert.equal(routingManeuvers.length, 30);
  for (const code of routingErrorCodes) assert.equal(typeof routingErrorStatus[code], 'number');
});
