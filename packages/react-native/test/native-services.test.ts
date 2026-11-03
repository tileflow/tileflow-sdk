import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceClients} from '../src/services/clients';
import {TileflowServiceError} from '../src/services/error';
import type {Spec} from '../src/specs/NativeTileflowServices';

function fakeModule(answer: (service: string, operation: string, request: object) => unknown) {
  const calls: [string, string, object][] = [];
  const module: Spec = {
    configuredServices: () => ({
      map: true,
      search: true,
      routing: false,
      elevation: false,
      geoip: false,
    }),
    call: async (service, operation, request) => {
      calls.push([service, operation, request]);
      return answer(service, operation, request) as object;
    },
    getConstants: () => ({}),
  } as unknown as Spec;
  return {module, calls};
}

/** A rejection as React Native delivers it: a code, a message and the native error's fields. */
function nativeRejection(code: string, message: string, userInfo: object) {
  return Object.assign(new Error(message), {code, userInfo});
}

test('each client method runs its native operation with the request unchanged', async () => {
  const {module, calls} = fakeModule(() => ({ok: true}));
  const clients = createServiceClients(() => module);
  await clients.TileflowSearch.geocode({query: 'Sol', proximity: [-3.7, 40.4]});
  await clients.TileflowSearch.listCategories();
  await clients.TileflowRouting.route({
    locations: [
      [0, 0],
      [1, 1],
    ],
    mode: 'driving',
  });
  await clients.TileflowElevation.points([[0, 0]]);
  await clients.TileflowElevation.profile({
    line: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  });
  await clients.TileflowGeoIP.locate();
  assert.deepEqual(calls, [
    ['search', 'geocode', {query: 'Sol', proximity: [-3.7, 40.4]}],
    ['search', 'listCategories', {}],
    [
      'routing',
      'route',
      {
        locations: [
          [0, 0],
          [1, 1],
        ],
        mode: 'driving',
      },
    ],
    ['elevation', 'points', {positions: [[0, 0]], unit: 'meters'}],
    [
      'elevation',
      'profile',
      {
        line: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    ],
    ['geoip', 'locate', {}],
  ]);
});

test('one elevation resolves with the height or null', async () => {
  const heights = [{elevation: 657.3}, {elevation: null}];
  const {module} = fakeModule(() => heights.shift());
  const clients = createServiceClients(() => module);
  assert.equal(await clients.TileflowElevation.elevation([-3.7, 40.4]), 657.3);
  assert.equal(await clients.TileflowElevation.elevation([-30, 40], 'feet'), null);
});

test('native service errors become TileflowServiceError with their fields', async () => {
  const {module} = fakeModule(() => {
    throw nativeRejection('ROUTING_NO_ROUTE', 'No route connects these locations.', {
      kind: 'rejected',
      code: 'ROUTING_NO_ROUTE',
      status: 422,
      requestId: 'req_01J9',
      retryAfter: 1500,
    });
  });
  const clients = createServiceClients(() => module);
  const error = await clients.TileflowRouting.route({locations: [], mode: 'driving'}).catch(
    (e) => e,
  );
  assert.ok(error instanceof TileflowServiceError);
  assert.equal(error.service, 'routing');
  assert.equal(error.kind, 'rejected');
  assert.equal(error.code, 'ROUTING_NO_ROUTE');
  assert.equal(error.status, 422);
  assert.equal(error.requestId, 'req_01J9');
  assert.equal(error.retryAfter, 1500);
  assert.equal(error.message, 'No route connects these locations.');
});

test('errors without the native fields pass through unchanged', async () => {
  const original = new TypeError('bridge failure');
  const {module} = fakeModule(() => {
    throw original;
  });
  const clients = createServiceClients(() => module);
  assert.equal(await clients.TileflowGeoIP.locate().catch((e) => e), original);
});

test('a missing native module fails when a client is used, not when it is created', async () => {
  const clients = createServiceClients(() => {
    throw new Error('missing');
  });
  await assert.rejects(clients.TileflowSearch.geocode({query: 'Sol'}), /missing/);
});

test('configured services report presence only', () => {
  const {module} = fakeModule(() => ({}));
  assert.deepEqual(createServiceClients(() => module).configuredServices(), {
    map: true,
    search: true,
    routing: false,
    elevation: false,
    geoip: false,
  });
});
