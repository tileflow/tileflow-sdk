import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  defineTheme,
  disable,
  fixed,
  labels,
  roads,
  tileflowWorld,
  water,
} from '../src';
import {extendStreets, testLightTheme} from './map-fixture';

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
  assert.equal(first.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(first.metadata?.['tileflow:compilerVersion'], 1);
  assert.equal(first.metadata?.['tileflow:theme'], 'light');
  assert.equal(first.metadata?.['tileflow:colorScheme'], 'light');
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
  assert.ok(first.layers.every((layer) => String(layer.id).startsWith('tileflow-')));
  assert.equal(new Set(first.layers.map((layer) => layer.id)).size, first.layers.length);
  assert.deepEqual(
    validateStyleMin(first as never).map((error) => error.message),
    [],
  );
});

test('rejects the removed compiler selector before emitting versioned metadata', () => {
  assert.throws(
    () =>
      createStyle({
        id: 'invalid-root',
        version: 1,
        root: {compiler: 'streets', compilerVersion: 999},
      } as never),
    /unrecognized key "root"/,
  );
  assert.throws(
    () =>
      compileTestMap({
        modules: {roads: {...roads(), unknownControl: true}},
      } as never),
    /modules\.roads\.unknownControl/,
  );
  assert.throws(
    () =>
      compileTestMap({
        modules: {water: water({bodies: {fill: {color: '#ABCDEF'}}})},
      }),
    /theme audit failed.*modules\.water\.bodies\.fill\.color/,
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
  const illuminated = defineTheme(testLightTheme, {
    id: 'illuminated',
    version: 1,
    colorScheme: 'light',
    lighting: {
      anchor: 'viewport',
      color: '#FFF8E8',
      intensity: 0.18,
      position: [1.15, 210, 30],
    },
  });
  const style = compileTestMap({
    defaultTheme: 'illuminated',
    themes: {illuminated},
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
  const branded = defineTheme(testLightTheme, {
    id: 'branded',
    version: 1,
    colorScheme: 'light',
    typography: {
      fallbacks: ['Noto Sans Regular', 'Arial Unicode MS', 'sans-serif'],
      font: 'Oxanium Medium',
      letterSpacing: 0.04,
      places: {font: 'Oxanium SemiBold', letterSpacing: 0.08},
      transform: 'uppercase',
    },
  });
  const style = compileTestMap({
    fonts: ['./fonts'],
    defaultTheme: 'branded',
    themes: {branded},
  });
  const textLayers = style.layers.filter(
    (layer) =>
      layer.type === 'symbol' &&
      Object.hasOwn((layer.layout ?? {}) as Record<string, unknown>, 'text-field'),
  );
  const city = textLayers.find((layer) => layer.id === 'tileflow-label-place-city');
  const cityLayout = city?.layout as Record<string, unknown> | undefined;
  const road = textLayers.find((layer) => layer.id === 'tileflow-label-road-major');
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

test('rejects a text-bearing standalone map without a local or remote font provider', () => {
  const noProvider = defineMap({
    id: 'no-font-provider',
    version: 1,
    defaultTheme: 'light',
    modules: {poi: disable()},
    themes: {light: testLightTheme},
  });

  assert.throws(
    () => createStyle(noProvider, {preparedAssets: streetsPreparedAssets}),
    /contains text but declares neither fonts nor glyphs/u,
  );
});

test('treats fonts empty array as an explicit provider removal for text-free maps', () => {
  const parent = defineMap({
    id: 'glyph-parent',
    version: 1,
    defaultTheme: 'light',
    glyphs: {
      kind: 'url',
      url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular'],
    },
    themes: {light: testLightTheme},
  });
  const textFree = defineMap({
    id: 'text-free',
    version: 1,
    extends: parent,
    fonts: [],
    modules: {
      addresses: disable(),
      aeroways: disable(),
      boundaries: disable(),
      buildings: disable(),
      labels: disable(),
      land: disable(),
      landforms: disable(),
      poi: disable(),
      roads: disable(),
      transit: disable(),
      vegetation: disable(),
      water: disable(),
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
          modules: {poi: disable()},
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
      water: water({
        bodies: {
          fill: {color: fixed('#ABCDEF', {reason: 'Fixture invariant for key-order testing.'})},
        },
      }),
    },
  });
  const right = compileTestMap({
    modules: {
      water: water({
        bodies: {
          fill: {color: fixed('#ABCDEF', {reason: 'Fixture invariant for key-order testing.'})},
        },
      }),
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
  assert.ok(first.layers.some((layer) => layer.id === 'tileflow-poi'));
  assert.deepEqual(first.metadata?.['tileflow:data'], {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'tileflow-world',
    schemaVersion: 1,
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

test('a Tileflow glyph set composites fallback stacks of the fonts it is declared to publish', () => {
  const officialSet = '33d4de5e8086d9d629d67d3f39fedb87e23686c4c1ac653c27e2a52aee9d00b3';
  const withFallback = defineTheme(testLightTheme, {
    id: 'with-fallback',
    version: 1,
    colorScheme: 'light',
    typography: {font: 'Noto Sans Bold', fallbacks: ['Noto Sans Regular']},
  });
  const compile = (url: string, fontStacks: string[]) =>
    compileTestMap({
      defaultTheme: 'with-fallback',
      glyphs: {kind: 'url', url, fontStacks},
      themes: {'with-fallback': withFallback},
    });
  const tileflow = `https://api.tileflow.dev/base/${officialSet}/glyphs/{fontstack}/{range}.pbf`;

  const style = compile(tileflow, ['Noto Sans Bold', 'Noto Sans Regular']);
  const city = style.layers.find((layer) => layer.id === 'tileflow-label-place-city');
  assert.deepEqual((city?.layout as Record<string, unknown>)['text-font'], [
    'Noto Sans Bold',
    'Noto Sans Regular',
  ]);
  // Another provider serves only the exact keys a map declares.
  assert.throws(
    () =>
      compile('https://fonts.example.test/{fontstack}/{range}.pbf', [
        'Noto Sans Bold',
        'Noto Sans Regular',
      ]),
    /undeclared glyph font stacks: Noto Sans Bold,Noto Sans Regular/u,
  );
  assert.doesNotThrow(() =>
    compile('https://fonts.example.test/{fontstack}/{range}.pbf', [
      'Noto Sans Bold,Noto Sans Regular',
    ]),
  );
  // A combined stack still needs each of its fonts declared.
  assert.throws(
    () => compile(tileflow, ['Noto Sans Bold']),
    /undeclared glyph font stacks: Noto Sans Bold,Noto Sans Regular/u,
  );

  // A stack naming a font the pinned set does not publish is refused where it is declared.
  for (const fontStacks of [
    ['Noto Sans Medium'],
    ['Noto Sans Bold', 'Noto Sans Bold,Noto Sans Medium'],
    ['Noto Sans Bold,Noto Sans Regular, Noto Sans Italic'],
  ]) {
    assert.throws(
      () => compile(tileflow, fontStacks),
      /glyph font stacks its glyph set cannot serve/u,
      fontStacks.join('|'),
    );
  }
  // A set the SDK has not reviewed is trusted for its fonts, never past ten of them.
  const unreviewed = `https://api.tileflow.dev/base/${'a'.repeat(64)}/glyphs/{fontstack}/{range}.pbf`;
  assert.doesNotThrow(() =>
    compile(unreviewed, ['Noto Sans Bold', 'Noto Sans Regular', 'Brand Sans Regular']),
  );
  const eleven = Array.from({length: 11}, (_, index) => `Brand Sans ${index}`).join(',');
  assert.throws(() => compile(unreviewed, [eleven]), /at most 10/u);
});
