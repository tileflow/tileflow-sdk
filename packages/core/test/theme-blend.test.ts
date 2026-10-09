import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineTheme} from '../src/index';
import {
  fillTileflowThemeBlendTemplate,
  planTileflowThemeBlend,
  TileflowThemeBlendError,
} from '../src/theme-blend';
import type {MapLibreStyle} from '../src/types';
import {extendStreets, testLightTheme} from './map-fixture';

function style(
  layers: Record<string, unknown>[],
  root: Partial<MapLibreStyle> = {},
): MapLibreStyle {
  return {
    glyphs: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    layers,
    name: 'blend fixture',
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/world.json'}},
    sprite: 'https://fixtures.tileflow.test/sprite',
    version: 8,
    ...root,
  };
}

function layer(id: string, type: string, paint: Record<string, unknown>, extra = {}) {
  return {id, paint, source: 'world', 'source-layer': 'land', type, ...extra};
}

const byId = (filled: MapLibreStyle) => new Map(filled.layers.map((entry) => [entry.id, entry]));
const paintOf = (entry: Record<string, unknown> | undefined) =>
  (entry?.paint ?? {}) as Record<string, unknown>;

test('mixes plain colours in OKLab and numbers linearly between neighbouring themes', () => {
  const plan = planTileflowThemeBlend([
    style([
      layer('ground', 'background', {'background-color': '#000000', 'background-opacity': 0.2}),
    ]),
    style([
      layer('ground', 'background', {'background-color': '#ffffff', 'background-opacity': 0.8}),
    ]),
  ]);

  assert.deepEqual(paintOf(byId(plan.styleAt(0)).get('ground')), {
    'background-color': '#000000',
    'background-opacity': 0.2,
  });
  assert.deepEqual(paintOf(byId(plan.styleAt(1)).get('ground')), {
    'background-color': '#ffffff',
    'background-opacity': 0.8,
  });
  const halfway = paintOf(byId(plan.styleAt(0.5)).get('ground'));
  assert.equal(halfway['background-opacity'], 0.5);
  const [red, green, blue] = String(halfway['background-color']).match(/\d+/gu)!.map(Number);
  // A perceptual mid-grey is far darker than the sRGB midpoint, 128.
  assert.equal(red, green);
  assert.equal(green, blue);
  assert.ok(red! > 90 && red! < 110, `perceptual mid-grey, got ${red}`);
  assert.equal(plan.paints.length, 2);
  assert.ok(plan.paints.every((paint) => paint.follows === 'position'));
});

test('splits a value chosen by feature data into one filtered camera-only layer per branch', () => {
  const choose = (a: string, b: string, other: string) => [
    'match',
    ['get', 'class'],
    'grass',
    a,
    ['wood', 'forest'],
    b,
    other,
  ];
  const filter = ['==', ['get', 'kind'], 'natural'];
  const plan = planTileflowThemeBlend([
    style([
      layer('land', 'fill', {'fill-color': choose('#203020', '#102010', '#000000')}, {filter}),
    ]),
    style([
      layer('land', 'fill', {'fill-color': choose('#a0d080', '#70b050', '#ffffff')}, {filter}),
    ]),
  ]);

  assert.equal(plan.summary.splitLayers, 3);
  const filled = plan.styleAt(0);
  const branches = filled.layers.filter((entry) => String(entry.id).startsWith('land::branch-'));
  assert.equal(branches.length, 3);
  const branchIndex = ['match', ['get', 'class'], 'grass', 0, ['wood', 'forest'], 1, 2];
  assert.deepEqual(
    branches.map((entry) => entry.filter),
    [0, 1, 2].map((branch) => ['all', filter, ['==', branchIndex, branch]]),
  );
  assert.deepEqual(
    branches.map((entry) => paintOf(entry)['fill-color']),
    ['#203020', '#102010', '#000000'],
  );
  assert.deepEqual(
    plan.styleAt(1).layers.map((entry) => paintOf(entry)['fill-color']),
    ['#a0d080', '#70b050', '#ffffff'],
  );
  // No split value reads feature data any more.
  assert.ok(!JSON.stringify(branches.map((entry) => entry.paint)).includes('"get"'));
});

test('shares a split layer between branches that end in the same values', () => {
  const choose = (a: string, other: string) => [
    'match',
    ['get', 'class'],
    'grass',
    a,
    'wood',
    other,
    other,
  ];
  const plan = planTileflowThemeBlend([
    style([layer('land', 'fill', {'fill-color': choose('#203020', '#000000')})]),
    style([layer('land', 'fill', {'fill-color': choose('#a0d080', '#ffffff')})]),
  ]);

  const filled = plan.styleAt(0);
  assert.equal(filled.layers.length, 2);
  assert.equal(filled.layers[1]!.filter?.[0], 'any');
});

test('keeps zoom curves when a colour is chosen per class at each zoom stop', () => {
  const curve = (low: [string, string], high: [string, string]) => [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    ['match', ['get', 'class'], 'minor', low[0], low[1]],
    15,
    ['match', ['get', 'class'], 'minor', high[0], high[1]],
  ];
  const plan = planTileflowThemeBlend([
    style([
      layer('roads', 'line', {'line-color': curve(['#111111', '#222222'], ['#333333', '#444444'])}),
    ]),
    style([
      layer('roads', 'line', {'line-color': curve(['#aaaaaa', '#bbbbbb'], ['#cccccc', '#dddddd'])}),
    ]),
  ]);

  const filled = plan.styleAt(1);
  assert.deepEqual(
    filled.layers.map((entry) => paintOf(entry)['line-color']),
    [
      ['interpolate', ['linear'], ['zoom'], 10, '#aaaaaa', 15, '#cccccc'],
      ['interpolate', ['linear'], ['zoom'], 10, '#bbbbbb', 15, '#dddddd'],
    ],
  );
});

test('draws a value that reads feature data continuously once per theme, cross-faded by opacity', () => {
  const depth = (shallow: string, deep: string) => [
    'interpolate',
    ['linear'],
    ['get', 'depth'],
    0,
    shallow,
    1000,
    deep,
  ];
  const opacity = ['interpolate', ['linear'], ['zoom'], 0, 1, 8, 0];
  const plan = planTileflowThemeBlend([
    style([
      layer('sea', 'fill', {'fill-color': depth('#103050', '#000010'), 'fill-opacity': opacity}),
    ]),
    style([
      layer('sea', 'fill', {'fill-color': depth('#80c0f0', '#2040a0'), 'fill-opacity': opacity}),
    ]),
  ]);

  assert.equal(plan.summary.copiedLayers, 2);
  const filled = byId(plan.styleAt(0.25));
  assert.deepEqual(paintOf(filled.get('sea::theme-0'))['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    0.75,
    8,
    0,
  ]);
  assert.deepEqual(paintOf(filled.get('sea::theme-1'))['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    0.25,
    8,
    0,
  ]);
  assert.deepEqual(paintOf(filled.get('sea::theme-1'))['fill-color'], depth('#80c0f0', '#2040a0'));
});

test('switches values that read feature state when the nearest theme changes', () => {
  const ink = (normal: string, highlighted: string) => [
    'case',
    ['boolean', ['feature-state', 'highlight'], false],
    highlighted,
    normal,
  ];
  const label = (normal: string, highlighted: string) =>
    layer(
      'places',
      'symbol',
      {'text-color': ink(normal, highlighted)},
      {layout: {'text-field': ['get', 'name']}},
    );
  const plan = planTileflowThemeBlend([
    style([label('#ffffff', '#ff00ff')]),
    style([label('#202020', '#c00060')]),
  ]);

  assert.equal(plan.switches.length, 1);
  assert.deepEqual(
    paintOf(byId(plan.styleAt(0.4)).get('places'))['text-color'],
    ink('#ffffff', '#ff00ff'),
  );
  assert.deepEqual(
    paintOf(byId(plan.styleAt(0.6)).get('places'))['text-color'],
    ink('#202020', '#c00060'),
  );
});

test('lets symbol values follow the label cross-fade and ground values follow the position', () => {
  const plan = planTileflowThemeBlend([
    style([
      layer('land', 'fill', {'fill-color': '#000000'}),
      layer(
        'names',
        'symbol',
        {'text-color': '#ffffff'},
        {layout: {'text-field': ['get', 'name']}},
      ),
    ]),
    style([
      layer('land', 'fill', {'fill-color': '#ffffff'}),
      layer(
        'names',
        'symbol',
        {'text-color': '#000000'},
        {layout: {'text-field': ['get', 'name']}},
      ),
    ]),
  ]);

  assert.deepEqual(
    plan.paints.map((paint) => [paint.layer, paint.follows]),
    [
      ['land', 'position'],
      ['names', 'dominant'],
    ],
  );
});

test('mixes differing artwork in pixels and keeps the first theme image names', () => {
  const icons = (suffix: string) =>
    layer(
      'blips',
      'symbol',
      {},
      {
        layout: {
          'icon-image': [
            'match',
            ['get', 'type'],
            'cafe',
            ['literal', `cafe${suffix}`],
            ['literal', `shop${suffix}`],
          ],
        },
      },
    );
  const ground = (pattern: string) => layer('grass', 'fill', {'fill-pattern': pattern});
  const plan = planTileflowThemeBlend([
    style([ground('grass-night'), icons('')]),
    style([ground('grass-day'), icons('-day')]),
  ]);

  assert.deepEqual(
    plan.images.map((image) => [image.names, image.follows]),
    [
      [['grass-night', 'grass-day'], 'position'],
      [['cafe', 'cafe-day'], 'dominant'],
      [['shop', 'shop-day'], 'dominant'],
    ],
  );
  const filled = byId(plan.styleAt(1));
  assert.equal(paintOf(filled.get('grass'))['fill-pattern'], 'grass-night');
  assert.deepEqual((filled.get('blips')!.layout as Record<string, unknown>)['icon-image'], [
    'match',
    ['get', 'type'],
    'cafe',
    ['literal', 'cafe'],
    ['literal', 'shop'],
  ]);
});

test('switches image names that stand for different artwork in different places', () => {
  const plan = planTileflowThemeBlend([
    style([
      layer('a', 'fill', {'fill-pattern': 'texture'}),
      layer('b', 'fill', {'fill-pattern': 'texture'}),
    ]),
    style([
      layer('a', 'fill', {'fill-pattern': 'texture-day'}),
      layer('b', 'fill', {'fill-pattern': 'texture-dusk'}),
    ]),
  ]);

  assert.equal(plan.images.length, 0);
  assert.deepEqual(
    plan.switches.map((entry) => [entry.layer, entry.property, entry.values]),
    [
      ['a', 'fill-pattern', ['texture', 'texture-day']],
      ['b', 'fill-pattern', ['texture', 'texture-dusk']],
    ],
  );
  assert.equal(paintOf(byId(plan.styleAt(1)).get('b'))['fill-pattern'], 'texture-dusk');
});

test('mixes a differing sky between themes', () => {
  const plan = planTileflowThemeBlend([
    style([], {sky: {'sky-color': '#000020', 'sky-horizon-blend': 0.2}}),
    style([], {sky: {'sky-color': '#80c0ff', 'sky-horizon-blend': 0.6}}),
  ]);
  assert.deepEqual(plan.styleAt(1).sky, {'sky-color': '#80c0ff', 'sky-horizon-blend': 0.6});
  assert.equal((plan.styleAt(0.5).sky as Record<string, unknown>)['sky-horizon-blend'], 0.4);
});

test('rejects themes that do not share one structure', () => {
  const a = style([layer('land', 'fill', {'fill-color': '#000000'})]);
  assert.throws(() => planTileflowThemeBlend([a]), TileflowThemeBlendError);
  assert.throws(
    () => planTileflowThemeBlend([a, style([layer('water', 'fill', {'fill-color': '#000000'})])]),
    /same layers/u,
  );
  assert.throws(
    () =>
      planTileflowThemeBlend([
        a,
        style([layer('land', 'fill', {'fill-color': '#000000'}, {filter: ['has', 'name']})]),
      ]),
    /differ in filter/u,
  );
  assert.throws(
    () =>
      planTileflowThemeBlend([
        a,
        style([layer('land', 'fill', {'fill-color': '#000000'})], {sprite: 'other'}),
      ]),
    /sprite/u,
  );
});

test('passes plain values through template filling', () => {
  assert.equal(fillTileflowThemeBlendTemplate('#123456', 0.5), '#123456');
  assert.deepEqual(fillTileflowThemeBlendTemplate(['zoom'], 0.5), ['zoom']);
});

test('blends compiled themes of one map into valid styles at every position', () => {
  const dark = defineTheme(testLightTheme, {
    id: 'test-dark',
    version: 1,
    colorScheme: 'dark',
    tokens: {
      color: {
        'boundaries.default': '#3A4550',
        'labels.halo': '#101418',
        'labels.muted': '#8A949E',
        'labels.primary': '#E8ECEF',
        'roads.casing': '#202830',
        'roads.default': '#3A4652',
        'roads.major': '#B8862E',
        'surface.background': '#101820',
        'surface.building': '#26303A',
        'surface.land': '#18242E',
        'surface.park': '#1E3A2A',
        'surface.water': '#17384D',
      },
    },
  });
  const map = extendStreets({defaultTheme: 'light', themes: {dark, light: testLightTheme}});
  const preparedAssets = {
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
  const light = createStyle(map, {preparedAssets, theme: 'light'});
  const night = createStyle(map, {preparedAssets, theme: 'dark'});
  const plan = planTileflowThemeBlend([light, night]);

  assert.ok(plan.paints.length > 0);
  for (const position of [0, 0.3, 0.5, 1]) {
    const filled = plan.styleAt(position);
    assert.deepEqual(validateStyleMin(filled as never), [], `valid at ${position}`);
  }
  // At a whole theme, every value that was not split equals that theme's value.
  for (const [position, compiled] of [
    [0, light],
    [1, night],
  ] as const) {
    const filled = byId(plan.styleAt(position));
    for (const entry of compiled.layers) {
      const mine = filled.get(entry.id);
      if (!mine) continue;
      assert.deepEqual(mine.paint ?? {}, entry.paint ?? {}, `${entry.id} at ${position}`);
    }
  }
});
