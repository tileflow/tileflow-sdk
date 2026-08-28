import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  auditTileflowMapThemeValues,
  createStyle,
  defineTheme,
  openMapTiles,
  parseTileflowMap,
  resolveTileflowData,
  validateTileflowMap,
  vectorTiles,
} from '../src';
import {assembleTileflowLayers} from '../src/cartography/graph';
import {extendStreets, testLightTheme} from './map-fixture';

test('keeps the import-free theme example valid, explicit, and compilable', async () => {
  const example = JSON.parse(
    await readFile(new URL('../../../docs/tileflow.config.example.json', import.meta.url), 'utf8'),
  );
  const validation = validateTileflowMap(example);
  assert.equal(validation.valid, true, JSON.stringify(validation.messages));
  const parsed = parseTileflowMap(example);
  assert.deepEqual(auditTileflowMapThemeValues(parsed), []);

  for (const theme of ['light', 'dark']) {
    const style = createStyle(example, {theme});
    assert.equal(style.metadata?.['tileflow:theme'], theme);
    assert.equal(style.metadata?.['tileflow:colorScheme'], theme);
    assert.ok(style.layers.length > 100);
  }
});

test('accepts complete named themes and rejects every singular or nested theme shape', () => {
  const dark = defineTheme(testLightTheme, {
    id: 'test-dark',
    version: 1,
    colorScheme: 'dark',
    tokens: {color: {'surface.water': '#001122'}},
  });
  const parsed = parseTileflowMap(
    extendStreets({defaultTheme: 'dark', themes: {dark, light: testLightTheme}}),
  );
  assert.equal(parsed.defaultTheme, 'dark');
  assert.equal(parsed.themes.dark?.tokens.color['surface.water'], '#001122');

  for (const design of [{theme: 'dark'}, {theme: {extends: 'dark'}}, {themes: 'dark'}]) {
    const result = validateTileflowMap(extendStreets(design as never));
    assert.equal(result.valid, false);
    assert.match(result.messages[0]?.message ?? '', /theme|record|Unrecognized key/i);
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
