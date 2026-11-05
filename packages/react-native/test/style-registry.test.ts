import assert from 'node:assert/strict';
import test from 'node:test';
import {MapController} from '../src/map-controller';
import type {MapMethod} from '../src/specs/NativeTileflowMapModule';
import {StyleRegistry} from '../src/style-registry';

test('a corrected declaration is applied when an older pending update fails', async () => {
  const calls: number[] = [];
  let fail: (reason: Error) => void = () => {};
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, _method, payload) => {
        calls.push(JSON.parse(payload).properties.clusterRadius);
        if (calls.length === 1)
          return new Promise((_resolve, reject) => {
            fail = reject;
          });
        return 'null';
      },
    }),
    () => {},
  );
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  const style = new StyleRegistry(map);
  const owner = Symbol();
  style.source('data', owner, {type: 'geojson', data: point, clusterRadius: -1});
  const pending = style.synchronize();
  style.source('data', owner, {type: 'geojson', data: point, clusterRadius: 80});
  fail(new Error('Invalid cluster radius'));
  await assert.rejects(pending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [-1, 80]);
});

function harness() {
  const calls: {method: MapMethod; payload: Record<string, unknown>}[] = [];
  const errors: Error[] = [];
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, method, payload) => {
        calls.push({method, payload: JSON.parse(payload)});
        return 'null';
      },
    }),
    (error) => errors.push(error),
  );
  const style = new StyleRegistry(map);
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  return {map, style, calls, errors};
}

const point = {type: 'FeatureCollection', features: []};

test('declarations create sources before layers and remove layers before their source', async () => {
  const {style, calls} = harness();
  const source = Symbol(),
    layer = Symbol();
  style.layer('points', layer, {id: 'points', type: 'circle', source: 'data'});
  style.source('data', source, {type: 'geojson', data: point});
  await style.synchronize();
  assert.deepEqual(
    calls.map((call) => call.method),
    ['addSource', 'addLayer'],
  );
  style.removeSource('data', source);
  style.removeLayer('points', layer);
  await style.synchronize();
  assert.deepEqual(
    calls.slice(2).map((call) => call.method),
    ['removeLayer', 'removeSource'],
  );
});

test('effect replay and theme readiness do not add duplicate native resources', async () => {
  const {map, style, calls} = harness();
  const source = Symbol();
  style.source('data', source, {type: 'geojson', data: point});
  style.removeSource('data', source);
  style.source('data', source, {type: 'geojson', data: point});
  await style.synchronize();
  map.receive('mount', 'loading', {});
  map.receive('mount', 'contentReady', {});
  await style.synchronize();
  assert.equal(calls.length, 1);
});

test('GeoJSON data updates retain the existing source', async () => {
  const {style, calls} = harness();
  const source = Symbol();
  style.source('data', source, {type: 'geojson', data: point});
  await style.synchronize();
  style.source('data', source, {type: 'geojson', data: 'https://example.test/points.json'});
  await style.synchronize();
  assert.equal(calls[1]?.method, 'setGeoJSONSourceData');
  assert.equal(calls.length, 2);
});

test('a newer declaration with the same id cannot be removed by stale cleanup', async () => {
  const {style, calls} = harness();
  const old = Symbol(),
    current = Symbol();
  style.source('data', old, {type: 'geojson', data: point});
  await style.synchronize();
  style.removeSource('data', old);
  style.source('data', current, {type: 'geojson', data: point});
  style.removeSource('data', old);
  await style.synchronize();
  assert.equal(calls.length, 1);
  assert.throws(() => style.source('data', Symbol(), {type: 'geojson', data: point}), {
    code: 'invalidRequest',
  });
});

test('an update during source creation applies after the acknowledged creation', async () => {
  let finish: (value: string) => void = () => {};
  const calls: MapMethod[] = [];
  const map = new MapController(
    'mount',
    () => ({
      call: async (_tag, _id, method) => {
        calls.push(method);
        if (calls.length === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return 'null';
      },
    }),
    () => {},
  );
  map.attach(1);
  map.receive('mount', 'contentReady', {});
  const style = new StyleRegistry(map);
  const owner = Symbol();
  style.source('data', owner, {type: 'geojson', data: point});
  const pending = style.synchronize();
  style.source('data', owner, {type: 'geojson', data: 'https://example.test/new.json'});
  finish('null');
  await pending;
  assert.deepEqual(calls, ['addSource', 'setGeoJSONSourceData']);
});

test('source configuration patches preserve its id, data and dependent layers', async () => {
  const {style, calls} = harness();
  const source = Symbol(),
    layer = Symbol();
  style.source('data', source, {type: 'geojson', cluster: true, clusterRadius: 24, data: point});
  style.layer('dots', layer, {id: 'dots', type: 'circle', source: 'data'});
  await style.synchronize();
  style.source('data', source, {type: 'geojson', cluster: true, clusterRadius: 80, data: point});
  await style.synchronize();
  assert.deepEqual(calls[2], {
    method: 'updateSource',
    payload: {id: 'data', properties: {clusterRadius: 80}},
  });
  style.source('data', source, {type: 'geojson', cluster: true, data: point});
  await style.synchronize();
  assert.deepEqual(calls[3]?.payload, {id: 'data', properties: {clusterRadius: null}});
  assert.equal(calls.filter((call) => call.method === 'addLayer').length, 1);
});

test('paint updates retain the acknowledged native layer slot', async () => {
  const {style, calls} = harness();
  const owner = Symbol();
  style.layer(
    'dots',
    owner,
    {id: 'dots', type: 'circle', source: 'data', paint: {'circle-radius': 4}},
    {slot: 'above-roads'},
  );
  await style.synchronize();
  style.layer(
    'dots',
    owner,
    {id: 'dots', type: 'circle', source: 'data', paint: {'circle-radius': 8}},
    {slot: 'above-roads'},
  );
  await style.synchronize();
  assert.equal(
    (
      calls.find((call) => call.method === 'updateLayer')?.payload.properties as Record<
        string,
        unknown
      >
    ).slot,
    'above-roads',
  );
});

test('removing a declarative slot explicitly restores the unslotted position', async () => {
  const {style, calls} = harness();
  const owner = Symbol();
  const layer = {id: 'dots', type: 'circle', source: 'data'};
  style.layer('dots', owner, layer, {slot: 'above-roads'});
  await style.synchronize();
  style.layer('dots', owner, layer);
  await style.synchronize();
  const move = calls.find((call) => call.method === 'moveLayer');
  assert.equal((move?.payload.position as Record<string, unknown>).slot, null);
});
