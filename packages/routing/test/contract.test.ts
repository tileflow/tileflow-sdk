import assert from 'node:assert/strict';
import test from 'node:test';
import {
  routingAvoidances,
  routingDirectDistance,
  routingErrorCodes,
  routingErrorStatus,
  routingIsochroneRequestSchema,
  routingIsochroneResponseSchema,
  routingLanguages,
  routingLimits,
  routingManeuvers,
  routingMatchRequestSchema,
  routingMatchResponseSchema,
  routingMatrixRequestSchema,
  routingMatrixResponseSchema,
  routingModes,
  routingNearestRequestSchema,
  routingNearestResponseSchema,
  routingOperations,
  routingRoadClasses,
  routingRoadSurfaces,
  routingRouteRequestSchema,
  routingRouteResponseSchema,
  routingTrafficKinds,
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
  for (const mode of ['driving', 'truck'])
    assert.ok(
      routingRouteRequestSchema.safeParse({locations: [littleHavana, orlando], mode}).success,
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

const answer = {
  schemaVersion: 1,
  network: {releaseId: 'routing-v1-example'},
  attribution: '© OpenStreetMap contributors',
  traffic: 'none',
};

test('answers carry attribution, the network, traffic and usage', () => {
  const routeAnswer = {
    ...answer,
    routes: [
      {
        distance: 1409,
        duration: 1003.8,
        hasTolls: false,
        hasHighways: false,
        hasFerries: false,
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
  const {traffic: _traffic, ...withoutTraffic} = routeAnswer;
  assert.equal(routingRouteResponseSchema.safeParse(withoutTraffic).success, false);
  assert.equal(
    routingRouteResponseSchema.safeParse({...routeAnswer, traffic: 'live'}).success,
    false,
  );
  const {hasFerries: _hasFerries, ...withoutFerries} = routeAnswer.routes[0]!;
  assert.equal(
    routingRouteResponseSchema.safeParse({...routeAnswer, routes: [withoutFerries]}).success,
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
      ...answer,
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

test('trucks may carry dimensions and every mode may avoid tolls, highways and ferries', () => {
  const truck = routingRouteRequestSchema.safeParse({
    locations: [littleHavana, southBeach],
    mode: 'truck',
    vehicle: {heightMeters: 4, weightTonnes: 20, hazardousMaterials: true},
    avoid: ['tolls', 'ferries'],
    traffic: 'none',
  });
  assert.deepEqual(truck.data?.vehicle, {
    heightMeters: 4,
    weightTonnes: 20,
    hazardousMaterials: true,
  });
  const car = routingRouteRequestSchema.safeParse({
    locations: [littleHavana, southBeach],
    mode: 'driving',
    vehicle: {heightMeters: 4},
  });
  assert.equal(car.error?.issues[0]?.message, 'Vehicle dimensions apply only to truck.');
  for (const invalid of [
    {avoid: ['tolls', 'tolls']},
    {avoid: ['stairs']},
    {traffic: 'live'},
    {mode: 'truck', vehicle: {heightMeters: 40}},
    {mode: 'truck', vehicle: {widthMeters: 0.5}},
    {mode: 'truck', vehicle: {weightTonnes: 101}},
    {mode: 'truck', vehicle: {axleCount: 2.5}},
    {mode: 'truck', vehicle: {colour: 'red'}},
  ])
    assert.equal(
      routingRouteRequestSchema.safeParse({
        locations: [littleHavana, southBeach],
        mode: 'driving',
        ...invalid,
      }).success,
      false,
      JSON.stringify(invalid),
    );
  assert.ok(
    routingIsochroneRequestSchema.safeParse({
      location: southBeach,
      mode: 'truck',
      minutes: [10],
      avoid: ['highways'],
    }).success,
  );
  assert.equal(
    routingIsochroneRequestSchema.safeParse({
      location: southBeach,
      mode: 'walking',
      minutes: [10],
      vehicle: {heightMeters: 4},
    }).success,
    false,
  );
});

test('a matrix has up to 25 sources and 25 targets within its mode distance', () => {
  const parsed = routingMatrixRequestSchema.safeParse({
    sources: [littleHavana],
    targets: [southBeach, orlando],
    mode: 'driving',
    avoid: ['tolls'],
    traffic: 'none',
  });
  assert.equal(parsed.data?.targets.length, 2);
  const cycling = routingMatrixRequestSchema.safeParse({
    sources: [littleHavana],
    targets: [orlando],
    mode: 'cycling',
  });
  assert.equal(
    cycling.error?.issues[0]?.message,
    'A source and a target are too far apart for cycling.',
  );
  for (const invalid of [
    {sources: [], targets: [southBeach]},
    {sources: Array(26).fill(littleHavana), targets: [southBeach]},
    {sources: [littleHavana], targets: Array(26).fill(southBeach)},
    {sources: [littleHavana], targets: [southBeach], vehicle: {heightMeters: 4}},
  ])
    assert.equal(
      routingMatrixRequestSchema.safeParse({...invalid, mode: 'driving'}).success,
      false,
      JSON.stringify(invalid).slice(0, 80),
    );
});

test('a trace has 2 to 100 positions, matching timestamps and a bounded accuracy', () => {
  const trace: [number, number][] = [
    [-80.1327, 25.7808],
    [-80.1324, 25.784],
    [-80.1318, 25.7922],
  ];
  assert.equal(
    routingMatchRequestSchema.safeParse({
      trace,
      timestamps: [10, 20, 20],
      accuracy: 15,
      mode: 'driving',
    }).data?.accuracy,
    15,
  );
  assert.ok(
    routingMatchRequestSchema.safeParse({trace, mode: 'truck', vehicle: {heightMeters: 4}}).success,
  );
  for (const invalid of [
    {trace: [trace[0]]},
    {trace: Array(101).fill(trace[0])},
    {trace, timestamps: [10, 20]},
    {trace, timestamps: [10, 30, 20]},
    {trace, timestamps: [-1, 0, 1]},
    {trace, accuracy: 0},
    {trace, accuracy: 101},
    {trace: [littleHavana, orlando]},
    {trace, avoid: ['tolls']},
    {trace, traffic: 'none'},
    {trace, vehicle: {heightMeters: 4}},
  ])
    assert.equal(
      routingMatchRequestSchema.safeParse({...invalid, mode: 'driving'}).success,
      false,
      JSON.stringify(invalid).slice(0, 80),
    );
});

test('a nearest-road request takes one position and a mode and nothing else', () => {
  assert.deepEqual(
    routingNearestRequestSchema.safeParse({location: southBeach, mode: 'walking'}).data,
    {location: southBeach, mode: 'walking'},
  );
  for (const invalid of [
    {location: southBeach, mode: 'walking', radius: 10},
    {location: southBeach, mode: 'walking', avoid: ['tolls']},
    {location: southBeach},
  ])
    assert.equal(routingNearestRequestSchema.safeParse(invalid).success, false);
});

const road = {
  names: ['Washington Avenue'],
  wayId: 11_446_118,
  class: 'secondary',
  surface: 'paved-smooth',
  lanes: 1,
  speedLimit: {kmh: 56, source: 'tagged'},
  toll: false,
  bridge: false,
  tunnel: false,
  roundabout: false,
  length: 100,
};

test('matrices, matches and nearest roads have answers with usage', () => {
  const matrix = {...answer, durations: [[744, null]], distances: [[13023, null]]};
  assert.ok(routingMatrixResponseSchema.safeParse({...matrix, usage: {units: 2}}).success);
  assert.equal(routingMatrixResponseSchema.safeParse(matrix).success, false);
  const match = {
    ...answer,
    distance: 1270,
    duration: 82,
    geometry: {type: 'LineString', coordinates: [littleHavana, southBeach]},
    points: [{location: littleHavana, distance: 1.2}, null],
    roads: [road, {...road, speedLimit: null, surface: undefined}],
    usage: {units: 5},
  };
  assert.ok(routingMatchResponseSchema.safeParse(match).success);
  assert.equal(routingMatchResponseSchema.safeParse({...match, points: [null]}).success, false);
  const nearest = {...answer, location: southBeach, distance: 4.7, road, usage: {units: 1}};
  assert.ok(routingNearestResponseSchema.safeParse(nearest).success);
  for (const speedLimit of [{kmh: 56, source: 'inferred'}, {kmh: 0, source: 'tagged'}, undefined])
    assert.equal(
      routingNearestResponseSchema.safeParse({...nearest, road: {...road, speedLimit}}).success,
      false,
      JSON.stringify(speedLimit),
    );
  assert.equal(
    routingNearestResponseSchema.safeParse({...nearest, road: {...road, class: 'footway'}}).success,
    false,
  );
});

test('the published lists are complete and every error code has its status', () => {
  assert.equal(routingLanguages.length, 33);
  assert.ok(routingLanguages.includes('en-US'));
  assert.equal(routingManeuvers.length, 30);
  assert.deepEqual(routingModes, ['driving', 'walking', 'cycling', 'truck']);
  assert.deepEqual(routingAvoidances, ['tolls', 'highways', 'ferries']);
  assert.deepEqual(routingTrafficKinds, ['none']);
  assert.deepEqual(routingOperations, ['route', 'isochrone', 'matrix', 'match', 'nearest']);
  assert.equal(routingRoadClasses.length, 8);
  assert.equal(routingRoadSurfaces.length, 8);
  for (const code of routingErrorCodes) assert.equal(typeof routingErrorStatus[code], 'number');
});

test('the limits match the service', () => {
  assert.deepEqual(routingLimits, {
    maximumRequestBytes: 8 * 1024,
    maximumResponseBytes: 4 * 1024 * 1024,
    minimumLocations: 2,
    maximumLocations: 5,
    maximumAlternatives: 2,
    maximumDirectDistanceMeters: {
      driving: 1_000_000,
      walking: 100_000,
      cycling: 300_000,
      truck: 1_000_000,
    },
    maximumMatrixSources: 25,
    maximumMatrixTargets: 25,
    maximumMatrixDistanceMeters: {
      driving: 400_000,
      walking: 100_000,
      cycling: 200_000,
      truck: 400_000,
    },
    minimumTracePositions: 2,
    maximumTracePositions: 100,
    maximumTraceDistanceMeters: 200_000,
    maximumTraceAccuracyMeters: 100,
    maximumRoads: 500,
    maximumContours: 4,
    minimumMinutes: 1,
    maximumMinutes: 60,
    maximumSteps: 2_000,
    maximumGeometryPositions: 200_000,
    maximumIsochroneVertices: 200_000,
  });
  assert.ok(Object.isFrozen(routingLimits.maximumMatrixDistanceMeters));
});
