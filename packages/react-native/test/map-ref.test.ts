import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoundaryLookup} from '../src/generated/boundary-join';
import {MapController} from '../src/map-controller';
import {createMapRef} from '../src/map-ref';
import {StyleRegistry} from '../src/style-registry';

test('boundary joins wait for the map and serialize only lookup data', async () => {
  const calls: {method: string; payload: unknown}[] = [];
  const result = {
    joinBy: 'id' as const,
    rows: [
      {key: 41, value: 8},
      {key: 42, value: null},
    ],
    ambiguous: [],
    duplicates: [],
    unmatched: [],
  };
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, method, payload) => {
        calls.push({method, payload: JSON.parse(payload)});
        return JSON.stringify(method === 'joinBoundaryRows' ? result : null);
      },
    }),
    () => {},
  );
  map.attach(1);
  const ref = createMapRef(map, new StyleRegistry(map));
  const lookup = createBoundaryLookup([{id: 41, class: 'region', ref: 'ES-MD'}]);
  const pending = ref.joinBoundaryRows([{key: 'ES-MD', value: 8}], {joinBy: 'ref', lookup});
  assert.deepEqual(calls, []);
  map.receive('mount', 'contentReady', {});
  const joined = await pending;
  assert.deepEqual(joined, result);
  await ref.setBoundaryValues(joined);
  assert.deepEqual(calls, [
    {
      method: 'joinBoundaryRows',
      payload: {
        rows: [{key: 'ES-MD', value: 8}],
        options: {joinBy: 'ref', lookup: {rows: lookup.rows}},
      },
    },
    {method: 'setBoundaryValues', payload: {values: {ids: {'41': 8}}}},
  ]);
});

test('boundary joins retain the typed offline failure', async () => {
  const failure = {
    code: 'resourceFailed',
    recoverable: true,
    context: {reason: 'boundaryLookupOffline'},
  };
  const map = new MapController(
    'mount',
    () => ({
      call: async () => {
        throw failure;
      },
    }),
    () => {},
  );
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  await assert.rejects(
    createMapRef(map, new StyleRegistry(map)).joinBoundaryRows([], {joinBy: 'id'}),
    {
      code: 'resourceFailed',
      context: {reason: 'boundaryLookupOffline'},
    },
  );
});

test('feature-state reads wait for the declared source to exist', async () => {
  const calls: string[] = [];
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, method) => {
        calls.push(method);
        return method === 'getFeatureState' ? '{"selected":true}' : 'null';
      },
    }),
    () => {},
  );
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  const style = new StyleRegistry(map);
  style.source('points', Symbol(), {
    type: 'geojson',
    data: {type: 'FeatureCollection', features: []},
  });
  assert.deepEqual(await createMapRef(map, style).getFeatureState({sourceID: 'points', id: 1}), {
    selected: true,
  });
  assert.deepEqual(calls, ['addSource', 'getFeatureState']);
});

test('unsafe numeric feature identifiers never reach the native map', async () => {
  const calls: string[] = [];
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, method) => {
        calls.push(method);
        return '{}';
      },
    }),
    () => {},
  );
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  const ref = createMapRef(map, new StyleRegistry(map));
  await assert.rejects(
    ref.removeFeatureState({sourceID: 'points', id: Number.MAX_SAFE_INTEGER + 1}),
    {code: 'invalidRequest'},
  );
  assert.deepEqual(calls, []);
});
