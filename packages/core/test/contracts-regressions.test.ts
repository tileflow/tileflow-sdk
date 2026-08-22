import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  openMapTiles,
  parseTileflowProject,
  resolveTileflowData,
  streets,
  validateConfig,
  vectorTiles,
} from '../src';
import {assembleTileflowLayers} from '../src/cartography/graph';

test('resolves createStyle theme registries while standalone validation fails unknown names', () => {
  const style = createStyle(
    {basemap: streets(), theme: 'midnight'},
    {themes: {midnight: {extends: 'dark', mode: 'dark'}}},
  );
  assert.equal(style.metadata?.['tileflow:theme'], 'midnight');

  const result = validateConfig({basemap: streets(), theme: 'missing'});
  assert.equal(result.valid, false);
  assert.deepEqual(result.messages, [
    {level: 'error', path: 'theme', message: 'Unknown Tileflow theme "missing"'},
  ]);
});

test('validates named map icon references and permits registered or URL references', () => {
  assert.throws(
    () => parseTileflowProject({maps: {main: {basemap: streets(), icons: 'missing'}}}),
    /maps\.main\.icons: Unknown Tileflow icon set "missing"/,
  );
  assert.doesNotThrow(() =>
    parseTileflowProject({
      icons: {base: {sprite: '/sprites/base'}},
      maps: {main: {basemap: streets(), icons: 'base'}},
    }),
  );
  assert.doesNotThrow(() =>
    parseTileflowProject({maps: {main: {basemap: streets(), icons: '/sprites/direct'}}}),
  );
});

test('rejects inverted semantic zoom ranges and permits an empty equal range', () => {
  const inverted = validateConfig({
    basemap: streets(),
    modules: {
      water: {
        type: 'water',
        waterways: {river: {minZoom: 12, maxZoom: 8}},
      },
    },
  });
  assert.equal(inverted.valid, false);
  assert.match(inverted.messages[0]?.path ?? '', /waterways\.river\.maxZoom$/);
  assert.match(inverted.messages[0]?.message ?? '', /greater than or equal/);

  assert.equal(
    validateConfig({
      basemap: streets(),
      modules: {water: {type: 'water', waterways: {river: {minZoom: 8, maxZoom: 8}}}},
    }).valid,
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
