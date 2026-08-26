import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openMapTiles,
  parseTileflowMap,
  resolveTileflowData,
  validateTileflowMap,
  vectorTiles,
} from '../src';
import {assembleTileflowLayers} from '../src/cartography/graph';
import {extendStreets} from './map-fixture';

test('accepts map-owned theme objects and rejects strings or nested inheritance', () => {
  const parsed = parseTileflowMap(
    extendStreets({theme: {colors: {water: '#001122'}, mode: 'dark'}}),
  );
  assert.deepEqual(parsed.theme, {colors: {water: '#001122'}, mode: 'dark'});

  for (const theme of ['dark', {extends: 'dark'}]) {
    const result = validateTileflowMap(extendStreets({theme} as never));
    assert.equal(result.valid, false);
    assert.match(result.messages[0]?.message ?? '', /theme|object|Unrecognized key/i);
  }
});

test('rejects every legacy icon registry and sprite authoring shape', () => {
  assert.throws(() => parseTileflowMap(extendStreets({icons: 'missing'})), /icons|array/i);
  assert.throws(
    () => parseTileflowMap(extendStreets({icons: {sprite: '/sprites/base'}})),
    /icons|array/i,
  );
  assert.doesNotThrow(() => parseTileflowMap(extendStreets({icons: ['./icons']})));
});

test('rejects inverted semantic zoom ranges and permits an empty equal range', () => {
  const inverted = validateTileflowMap(
    extendStreets({
      modules: {
        water: {
          type: 'water',
          waterways: {river: {minZoom: 12, maxZoom: 8}},
        },
      },
    }),
  );
  assert.equal(inverted.valid, false);
  assert.equal(inverted.messages[0]?.path, 'modules.water.waterways.river.maxZoom');
  assert.match(inverted.messages[0]?.message ?? '', /maxZoom.*greater than or equal/);

  assert.equal(
    validateTileflowMap(
      extendStreets({
        modules: {water: {type: 'water', waterways: {river: {minZoom: 8, maxZoom: 8}}}},
      }),
    ).valid,
    true,
  );
});

test('fails closed for malformed graph contribution contracts', () => {
  const contribution = {
    kind: 'layer' as const,
    layer: {id: 'test', type: 'fill'},
    localOrder: 0,
    owner: 'land' as const,
    slot: 'land' as const,
    target: 'land.test',
  };
  assert.throws(
    () => assembleTileflowLayers([{...contribution, slot: 'unknown'} as never]),
    /Unknown Tileflow layer slot/,
  );
  assert.throws(
    () => assembleTileflowLayers([{...contribution, owner: 'unknown'} as never]),
    /Unknown Tileflow layer owner/,
  );
  assert.throws(
    () => assembleTileflowLayers([{...contribution, target: 'land..test'}]),
    /portable semantic target/,
  );
});

test('data identity distinguishes URLs and complete remapped bindings', () => {
  const first = resolveTileflowData(
    vectorTiles({
      attribution: 'Example',
      schema: openMapTiles(),
      url: '/first.json',
    }),
  );
  const second = resolveTileflowData(
    vectorTiles({
      attribution: 'Example',
      schema: openMapTiles({
        layers: {road: 'roads_v2'},
        fields: {class: 'kind', maritime: 'is_maritime'},
      }),
      url: '/second.json',
    }),
  );

  assert.equal(first.identity.url, '/first.json');
  assert.equal(second.identity.url, '/second.json');
  assert.equal(first.identity.bindings?.layers.road, 'transportation');
  assert.equal(second.identity.bindings?.layers.road, 'roads_v2');
  assert.equal(second.identity.bindings?.fields.class, 'kind');
  assert.equal(second.identity.bindings?.fields.maritime, 'is_maritime');
  assert.equal(first.identity.capabilities?.globalLandcover, true);
  assert.equal(first.identity.capabilities?.bathymetry, false);
  assert.equal(first.identity.capabilities?.tree, true);
  assert.notDeepEqual(first.identity, second.identity);

  const withoutTree = openMapTiles();
  delete withoutTree.layers.tree;
  const optional = resolveTileflowData(
    vectorTiles({attribution: 'Example', schema: withoutTree, url: '/optional.json'}),
  );
  assert.equal(optional.identity.capabilities?.tree, false);
});
