import assert from 'node:assert/strict';
import test from 'node:test';
import {MapController} from '../src/map-controller';
import {createMapRef} from '../src/map-ref';
import {StyleRegistry} from '../src/style-registry';

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
