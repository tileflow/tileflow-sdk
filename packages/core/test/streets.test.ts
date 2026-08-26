import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  createStyle,
  defineMap,
  defineRootMap,
  land,
  landforms,
  labels,
  poi,
  roads,
  tileflowWorld,
  transit,
  vegetation,
  water,
} from '../src';
import {extendStreets} from './map-fixture';

const streetsPreparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

function compileTestMap(
  design: Parameters<typeof extendStreets>[0] = {},
  options: Parameters<typeof createStyle>[1] = {},
) {
  return createStyle(extendStreets(design), {preparedAssets: streetsPreparedAssets, ...options});
}

test('compiles a complete deterministic Streets map from omitted data and modules', () => {
  const first = compileTestMap();
  const second = compileTestMap();

  assert.deepEqual(first, second);
  assert.equal(first.metadata?.['tileflow:map'], 'test-map');
  assert.equal(first.metadata?.['tileflow:mapVersion'], 1);
  assert.equal(first.metadata?.['tileflow:root'], 'streets');
  assert.equal(first.metadata?.['tileflow:rootCompilerVersion'], 1);
  assert.equal(first.metadata?.['tileflow:variant'], 'light');
  assert.equal(first.metadata?.['tileflow:internalMigration'], undefined);
  assert.equal(first.projection, undefined);
  assert.equal(first.sprite, streetsPreparedAssets.icons.sprite);
  assert.equal(
    first.layers.some(
      (layer) =>
        layer.layout && Object.hasOwn(layer.layout as Record<string, unknown>, 'icon-image'),
    ),
    true,
  );
  assert.ok(first.layers.length > 50);
  assert.ok(first.layers.every((layer) => String(layer.id).startsWith('streets-')));
  assert.equal(new Set(first.layers.map((layer) => layer.id)).size, first.layers.length);
  assert.deepEqual(
    validateStyleMin(first as never).map((error) => error.message),
    [],
  );
});

test('validates the public Streets compiler before emitting versioned metadata', () => {
  assert.throws(
    () =>
      createStyle({
        id: 'invalid-root',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 999},
      } as never),
    /unsupported root|compilerVersion/,
  );
  assert.throws(
    () =>
      compileTestMap({
        modules: {roads: {...roads(), unknownControl: true}},
      } as never),
    /modules\.roads\.unknownControl/,
  );
});

test('emits an explicit adaptive globe projection', () => {
  const globe = compileTestMap({projection: 'globe'});
  const mercator = compileTestMap({projection: 'mercator'});

  assert.deepEqual(globe.projection, {type: 'globe'});
  assert.deepEqual(mercator.projection, {type: 'mercator'});
  assert.deepEqual(validateStyleMin(globe as never), []);
});

test('emits bounded root lighting for low-contrast 3d faces', () => {
  const style = compileTestMap({
    light: {
      anchor: 'viewport',
      color: '#FFF8E8',
      intensity: 0.18,
      position: [1.15, 210, 30],
    },
  });

  assert.deepEqual(style.light, {
    anchor: 'viewport',
    color: '#FFF8E8',
    intensity: 0.18,
    position: [1.15, 210, 30],
  });
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('can omit the glyph endpoint and propagate theme typography to local-font labels', () => {
  const style = compileTestMap({
    fonts: ['./fonts'],
    theme: {
      typography: {
        fallbacks: ['Noto Sans Regular', 'Arial Unicode MS', 'sans-serif'],
        font: 'Oxanium Medium',
        letterSpacing: 0.04,
        places: {font: 'Oxanium SemiBold', letterSpacing: 0.08},
        transform: 'uppercase',
      },
    },
  });
  const textLayers = style.layers.filter(
    (layer) =>
      layer.type === 'symbol' &&
      Object.hasOwn((layer.layout ?? {}) as Record<string, unknown>, 'text-field'),
  );
  const city = textLayers.find((layer) => layer.id === 'streets-label-place-city');
  const cityLayout = city?.layout as Record<string, unknown> | undefined;
  const road = textLayers.find((layer) => layer.id === 'streets-label-road-major');
  const roadLayout = road?.layout as Record<string, unknown> | undefined;

  assert.equal(style.glyphs, undefined);
  assert.ok(textLayers.length > 0);
  assert.deepEqual(cityLayout?.['text-font'], [
    'Oxanium SemiBold',
    'Noto Sans Regular',
    'Arial Unicode MS',
    'sans-serif',
  ]);
  assert.equal(cityLayout?.['text-letter-spacing'], 0.08);
  assert.equal(cityLayout?.['text-transform'], 'uppercase');
  assert.deepEqual(roadLayout?.['text-font'], [
    'Oxanium Medium',
    'Noto Sans Regular',
    'Arial Unicode MS',
    'sans-serif',
  ]);
  assert.equal(roadLayout?.['text-letter-spacing'], 0.04);
  assert.equal(roadLayout?.['text-transform'], 'uppercase');
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('rejects a text-bearing root map without a local or remote font provider', () => {
  const noProvider = defineRootMap({
    id: 'no-font-provider',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    modules: {poi: poi({enabled: false})},
  });

  assert.throws(
    () => createStyle(noProvider, {preparedAssets: streetsPreparedAssets}),
    /contains text but declares neither fonts nor glyphs/u,
  );
});

test('treats fonts empty array as an explicit provider removal for text-free maps', () => {
  const parent = defineRootMap({
    id: 'glyph-parent',
    version: 1,
    root: {compiler: 'streets', compilerVersion: 1},
    glyphs: {
      kind: 'url',
      url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular'],
    },
  });
  const textFree = defineMap({
    id: 'text-free',
    version: 1,
    extends: parent,
    fonts: [],
    modules: {
      addresses: addresses({enabled: false}),
      aeroways: aeroways({enabled: false}),
      boundaries: boundaries({enabled: false}),
      buildings: buildings({enabled: false}),
      labels: labels({enabled: false}),
      land: land({enabled: false}),
      landforms: landforms({enabled: false}),
      poi: poi({enabled: false}),
      roads: roads({enabled: false}),
      transit: transit({enabled: false}),
      vegetation: vegetation({enabled: false}),
      water: water({enabled: false}),
    },
  });

  const style = createStyle(textFree);
  assert.equal(style.glyphs, undefined);
  assert.equal(
    style.layers.some((layer) => layer.type === 'symbol'),
    false,
  );

  assert.throws(
    () =>
      createStyle(
        defineMap({
          id: 'text-bearing-empty-fonts',
          version: 1,
          extends: parent,
          fonts: [],
          modules: {poi: poi({enabled: false})},
        }),
      ),
    /empty fonts directory array/u,
  );
});

test('module key order does not change Streets output', () => {
  const left = compileTestMap({
    modules: {
      roads: roads({detail: 'major'}),
      labels: labels({roads: 'major'}),
      water: water({bodies: {fill: {color: '#ABCDEF'}}}),
    },
  });
  const right = compileTestMap({
    modules: {
      water: water({bodies: {fill: {color: '#ABCDEF'}}}),
      labels: labels({roads: 'major'}),
      roads: roads({detail: 'major'}),
    },
  });

  assert.deepEqual(left, right);
});

test('keeps World selection and glyph delivery explicit and independent', () => {
  const glyphs = {
    kind: 'url' as const,
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
    url: 'https://assets.example.test/base/exact/glyphs/{fontstack}/{range}.pbf',
  };
  const first = compileTestMap(
    {
      data: tileflowWorld(),
      glyphs,
    },
    {apiBaseUrl: 'https://api-one.example.test'},
  );
  const second = compileTestMap(
    {
      data: tileflowWorld(),
      glyphs,
    },
    {apiBaseUrl: 'https://api-two.example.test'},
  );
  const source = first.sources.tileflow as Record<string, unknown>;

  assert.notDeepEqual(first, second);
  assert.equal(source.url, 'https://api-one.example.test/tiles/world/tiles.json');
  assert.equal(Object.hasOwn(source, 'tiles'), false);
  assert.equal(first.glyphs, glyphs.url);
  assert.equal(first.sprite, streetsPreparedAssets.icons.sprite);
  assert.ok(first.layers.some((layer) => layer.id === 'streets-poi-food-icon'));
  assert.deepEqual(first.metadata?.['tileflow:data'], {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'openmaptiles',
    schemaVersion: 1,
    semantics: {parkLayer: 'protected-only'},
    sourceId: 'tileflow',
    url: 'https://api-one.example.test/tiles/world/tiles.json',
    worldSelection: {kind: 'current', product: 'world-v1'},
  });
  assert.deepEqual(
    validateStyleMin(first as never).map((error) => error.message),
    [],
  );
});

test('terrain cannot overwrite the stable primary vector source', () => {
  assert.throws(
    () =>
      compileTestMap({
        terrain: {mode: 'hillshade', sourceId: 'tileflow'},
      }),
    /conflicts with the primary vector source/,
  );
});
