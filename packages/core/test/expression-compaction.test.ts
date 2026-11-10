import {createPropertyExpression, featureFilter, latest} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactTileflowExpression,
  compactTileflowLayer,
  compactTileflowLayers,
} from '../src/cartography/expression-compaction';

const restricted = [
  'all',
  ['has', 'access'],
  [
    '!',
    [
      'match',
      ['get', 'access'],
      ['yes', 'designated', 'official', 'permissive', 'unknown'],
      true,
      false,
    ],
  ],
];

function equivalent(before: unknown, after: unknown, property = 'line-width') {
  const specification = (latest.paint_line as Record<string, unknown>)[property];
  const original = createPropertyExpression(before, specification as never);
  const compacted = createPropertyExpression(after, specification as never);
  assert.equal(original.result, 'success', JSON.stringify(original.value));
  assert.equal(compacted.result, 'success', JSON.stringify(compacted.value));
  if (original.result !== 'success' || compacted.result !== 'success') return;
  for (const zoom of [0, 12, 15, 15.5, 18, 24])
    for (const access of [undefined, null, false, 1, 'yes', 'private', [], {}])
      for (const ramp of [undefined, null, 0, 1, '1']) {
        const feature = {type: 2, properties: {access, ramp}};
        assert.deepEqual(
          compacted.value.evaluate({zoom}, feature as never, {}),
          original.value.evaluate({zoom}, feature as never, {}),
          JSON.stringify({zoom, access, ramp}),
        );
      }
}

test('removes no-op road treatments while retaining numeric evaluation', () => {
  const width = [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    ['let', 'base', 2, ['case', restricted, ['*', ['var', 'base'], 1], ['var', 'base']]],
    18,
    ['let', 'base', 10, ['case', restricted, ['*', ['var', 'base'], 1], ['var', 'base']]],
  ];
  const compacted = compactTileflowExpression(width);
  equivalent(width, compacted);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(width).length / 4);
});

test('keeps fallback-valued branches that mask a later branch', () => {
  const value = ['case', ['==', ['get', 'ramp'], 1], 2, restricted, 8, 2];
  equivalent(value, compactTileflowExpression(value));
  assert.deepEqual(compactTileflowExpression(value), value);
});

test('does not erase guards or numeric coercions that can fail', () => {
  for (const value of [
    ['case', ['boolean', ['get', 'flag']], 2, 2],
    ['case', ['>', ['number', ['get', 'value']], 0], 2, 2],
    ['*', ['get', 'width'], 1],
    ['interpolate', ['linear'], ['number', ['get', 'position']], 0, 2, 1, 2],
  ])
    assert.deepEqual(compactTileflowExpression(value), value);
});

test('keeps match labels and literal arrays as data', () => {
  const value = ['match', ['get', 'access'], ['case', 'get', 'literal'], 2, 8];
  equivalent(value, compactTileflowExpression(value));
  assert.deepEqual(compactTileflowExpression(value), value);
  const literal = ['literal', ['case', true, 7, 7]];
  assert.deepEqual(compactTileflowExpression(literal), literal);
});

test('shares repeated predicates lazily and without variable capture', () => {
  const value = [
    'let',
    '__tf0',
    2,
    [
      'interpolate',
      ['linear'],
      ['zoom'],
      12,
      ['case', restricted, 1, ['var', '__tf0']],
      15,
      ['case', restricted, 3, 4],
      18,
      ['case', restricted, 6, 8],
    ],
  ];
  const layer = {id: 'road', type: 'line', paint: {'line-width': value}};
  const compacted = compactTileflowLayer(layer);
  equivalent(value, compacted.paint['line-width']);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(layer).length);
  assert.deepEqual(compactTileflowLayer(compacted), compacted);
  assert.equal(layer.paint['line-width'], value);
});

test('preserves nested lexical bindings and does not mutate the input', () => {
  const value = ['let', 'base', 8, ['let', 'base', ['var', 'base'], ['*', ['var', 'base'], 1]]];
  const before = JSON.stringify(value);
  equivalent(value, compactTileflowExpression(value));
  assert.equal(JSON.stringify(value), before);
});

test('keeps interpolation values and color coercion at fixed planner samples', () => {
  const value = [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    ['interpolate', ['linear'], 12, 12, '#aabbcc', 18, '#ddeeff'],
    18,
    '#ddeeff',
  ];
  equivalent(value, compactTileflowExpression(value), 'line-color');
});

test('does not hide image choices from static asset discovery', () => {
  const value = [
    'case',
    ['==', ['get', 'ramp'], 1],
    ['case', restricted, 'bridge', 'road'],
    ['case', restricted, 'path', 'road'],
  ];
  const layer = {id: 'icons', layout: {'icon-image': value}};
  const compacted = compactTileflowLayer(layer);
  assert.ok(!JSON.stringify(compacted.layout['icon-image']).includes('"let"'));
});

test('a binding keeps its enclosing scope when a sibling shadows its reference', () => {
  const value = [
    'let',
    'width',
    ['get', 'width'],
    ['let', 'base', ['var', 'width'], 'width', 2, ['*', ['var', 'base'], 1]],
  ];
  const compacted = compactTileflowExpression(value);
  assert.ok(JSON.stringify(compacted).includes('"*"'));
});

test('does not discard a fallible interpolation neighbour at an exact interior stop', () => {
  const value = ['interpolate', ['linear'], 15, 12, 2, 15, 4, 18, ['number', ['get', 'width']]];
  assert.deepEqual(compactTileflowExpression(value), value);
});

test('keeps separate dispatches when match labels have different types or overlap', () => {
  for (const label of [1, 'yes']) {
    const value = [
      'case',
      ['match', ['get', 'access'], ['yes'], true, false],
      2,
      ['match', ['get', 'access'], [label], true, false],
      4,
      8,
    ];
    equivalent(value, compactTileflowExpression(value));
    assert.equal((compactTileflowExpression(value) as unknown[])[0], 'case');
  }
});

function equivalentForFilter(
  filter: unknown,
  before: unknown,
  after: unknown,
  property = 'line-width',
) {
  const specification = (latest.paint_line as Record<string, unknown>)[property];
  const original = createPropertyExpression(before, specification as never);
  const folded = createPropertyExpression(after, specification as never);
  assert.equal(original.result, 'success', JSON.stringify(original.value));
  assert.equal(folded.result, 'success', JSON.stringify(folded.value));
  if (original.result !== 'success' || folded.result !== 'success') return;
  const accepts = featureFilter(filter as never);
  let rendered = 0;
  for (const zoom of [0, 12, 15, 15.5, 18, 21.3, 24])
    for (const link of [undefined, null, true, false, 'true', 1])
      for (const kind of [
        undefined,
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'street',
      ])
        for (const type of [1, 2, 3]) {
          const feature = {type, properties: {link, class: kind}};
          if (!accepts.filter({zoom}, feature as never)) continue;
          rendered += 1;
          assert.deepEqual(
            folded.value.evaluate({zoom}, feature as never, {}),
            original.value.evaluate({zoom}, feature as never, {}),
            JSON.stringify({zoom, link, kind, type}),
          );
        }
  assert.ok(rendered > 0, 'the filter must accept some sampled feature');
}

const rampWidth = [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  12,
  ['case', ['==', ['get', 'link'], true], 0.4, 2],
  18,
  ['case', ['==', ['get', 'link'], true], 18, 28],
];

test('folds feature tests the layer filter settles into camera-only properties', () => {
  for (const [filter, expected] of [
    [['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'link'], true]], 18],
    [['all', ['!=', ['get', 'link'], true], ['>=', ['zoom'], 12]], 28],
    [['!', ['==', ['get', 'link'], true]], 28],
  ] as const) {
    const layer = {id: 'road', type: 'line', filter, paint: {'line-width': rampWidth}};
    const width = compactTileflowLayer(layer).paint['line-width'];
    equivalentForFilter(filter, rampWidth, width);
    const specification = (latest.paint_line as Record<string, unknown>)['line-width'];
    const parsed = createPropertyExpression(width, specification as never);
    assert.equal(parsed.result, 'success');
    if (parsed.result === 'success') assert.equal(parsed.value.kind, 'camera');
    assert.equal((width as unknown[]).at(-1), expected);
  }
});

test('selects match branches that a filter membership decides', () => {
  const width = [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    ['match', ['get', 'class'], ['primary'], 8, ['secondary', 'tertiary'], 7, 5],
    18,
    ['match', ['get', 'class'], ['primary'], 28, ['secondary', 'tertiary'], 26, 20],
  ];
  const settled = ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false];
  const folded = compactTileflowLayer({id: 'road', filter: settled, paint: {'line-width': width}})
    .paint['line-width'];
  equivalentForFilter(settled, width, folded);
  assert.deepEqual(folded, ['interpolate', ['linear'], ['zoom'], 15, 7, 18, 26]);

  // Members with different outputs keep the feature dispatch.
  const mixed = ['match', ['get', 'class'], ['primary', 'secondary'], true, false];
  const kept = compactTileflowLayer({id: 'road', filter: mixed, paint: {'line-width': width}})
    .paint['line-width'];
  equivalentForFilter(mixed, width, kept);
  assert.ok(JSON.stringify(kept).includes('"match"'));
});

test('does not use disjunctions, zoom-gated or legacy filters as facts', () => {
  for (const filter of [
    ['any', ['==', ['get', 'link'], true], ['==', ['get', 'class'], 'primary']],
    ['step', ['zoom'], true, 13, ['==', ['get', 'link'], true]],
    ['==', 'link', true],
  ]) {
    const width = compactTileflowLayer({id: 'road', filter, paint: {'line-width': rampWidth}})
      .paint['line-width'];
    assert.ok(JSON.stringify(width).includes('"link"'), JSON.stringify(filter));
  }
});

test('folds literal boolean operands without reordering fallible tests', () => {
  const guard = ['>', ['number', ['get', 'width']], 0];
  assert.equal(compactTileflowExpression(['all', true, ['!', true]]), false);
  assert.equal(compactTileflowExpression(['any', false, ['!', true]]), false);
  assert.deepEqual(compactTileflowExpression(['all', guard, true]), guard);
  assert.deepEqual(compactTileflowExpression(['any', guard, true, guard]), ['any', guard, true]);
  assert.deepEqual(compactTileflowExpression(['case', false, 1, guard, 2, true, 3, 4]), [
    'case',
    guard,
    2,
    3,
  ]);
});

test('uses what every branch of a merged cohort filter establishes', () => {
  const filter = [
    'any',
    ['all', ['==', ['get', 'class'], 'motorway'], ['==', ['get', 'link'], true]],
    ['all', ['==', ['get', 'class'], 'trunk'], ['==', ['get', 'link'], true]],
  ];
  const width = compactTileflowLayer({id: 'ramps', filter, paint: {'line-width': rampWidth}}).paint[
    'line-width'
  ];
  equivalentForFilter(filter, rampWidth, width);
  assert.deepEqual(width, ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.4, 18, 18]);

  // Only a value every branch establishes is a fact; one branch is not enough.
  const partial = ['any', filter[1], ['==', ['get', 'class'], 'trunk']];
  const kept = compactTileflowLayer({
    id: 'mixed',
    filter: partial,
    paint: {'line-width': rampWidth},
  }).paint['line-width'];
  equivalentForFilter(partial, rampWidth, kept);
  assert.ok(JSON.stringify(kept).includes('"link"'));
});

/** Asserts equal values for camera zooms from `from` to `to` and features of several kinds. */
function equivalentFrom(
  before: unknown,
  after: unknown,
  from: number,
  to = 24,
  property = 'line-opacity',
) {
  const specification = (latest.paint_line as Record<string, unknown>)[property];
  const original = createPropertyExpression(before, specification as never);
  const compacted = createPropertyExpression(after, specification as never);
  assert.equal(original.result, 'success', JSON.stringify(original.value));
  assert.equal(compacted.result, 'success', JSON.stringify(compacted.value));
  if (original.result !== 'success' || compacted.result !== 'success') return;
  for (let zoom = from; zoom < to; zoom += 0.25)
    for (const properties of [{}, {surface: 'unpaved'}, {access: 'private'}])
      assert.deepEqual(
        compacted.value.evaluate({zoom}, {type: 2, properties} as never),
        original.value.evaluate({zoom}, {type: 2, properties} as never),
        `z${zoom} ${JSON.stringify(properties)}`,
      );
}

test('drops zoom stops outside the zooms a layer is drawn at', () => {
  const unpaved = ['==', ['get', 'surface'], 'unpaved'];
  // A fade-in at z3 that ends long before the layer starts: only its feature test remains.
  const fade = [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    ['case', unpaved, 0.96, 0],
    3.5,
    ['case', unpaved, 0.96, 1],
  ];
  const faded = compactTileflowLayer({id: 'fade', minzoom: 12, paint: {'line-opacity': fade}})
    .paint['line-opacity'];
  assert.deepEqual(faded, ['case', unpaved, 0.96, 1]);
  equivalentFrom(fade, faded, 12);

  // The stop at or below the minimum zoom bounds the curve; later stops survive.
  const color = [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    ['case', unpaved, '#B9CED5', '#D2DADC'],
    14,
    ['case', unpaved, '#B9CED5', '#D2DADC'],
    15,
    '#8AA7B0',
    22,
    '#8AA7B0',
  ];
  assert.equal(
    compactTileflowLayer({id: 'casing', minzoom: 15, paint: {'line-color': color}}).paint[
      'line-color'
    ],
    '#8AA7B0',
  );
  const clipped = compactTileflowLayer({id: 'fill', minzoom: 14.5, paint: {'line-color': color}})
    .paint['line-color'];
  assert.deepEqual(clipped, [...color.slice(0, 3), ...color.slice(5)]);
  equivalentFrom(color, clipped, 14.5, 24, 'line-color');

  // A maximum zoom keeps the first stop at or beyond it; steps fold into their base.
  const steps = ['step', ['zoom'], ['case', unpaved, 1, 0], 10, 0.5, 13, 0.75, 16, 1];
  const stepped = compactTileflowLayer({
    id: 'step',
    minzoom: 10,
    maxzoom: 15,
    paint: {
      'line-opacity': steps,
    },
  }).paint['line-opacity'];
  assert.deepEqual(stepped, ['step', ['zoom'], 0.5, 13, 0.75]);
  equivalentFrom(steps, stepped, 10, 15);
  const ramp = ['interpolate', ['linear'], ['zoom'], 3, 0, 8, ['case', unpaved, 1, 0.5], 18, 1];
  const ranged = compactTileflowLayer({id: 'ramp', maxzoom: 6, paint: {'line-opacity': ramp}})
    .paint['line-opacity'];
  assert.deepEqual(ranged, ramp.slice(0, 7));
  equivalentFrom(ramp, ranged, 0, 6);
  assert.deepEqual(
    compactTileflowLayer({id: 'overview', minzoom: 9, maxzoom: 15, paint: {'line-opacity': ramp}})
      .paint['line-opacity'],
    ramp.slice(0, 3).concat(ramp.slice(5)),
  );
});

function lineValue(value: unknown, property: string, zoom: number, properties: object) {
  const specification = (latest.paint_line as Record<string, unknown>)[property];
  const parsed = createPropertyExpression(value, specification as never);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error('Invalid expression');
  return {
    kind: parsed.value.kind,
    value: parsed.value.evaluate({zoom}, {type: 2, properties} as never),
  };
}

test('splits a width that depends on zoom and a feature test into camera-only layers', () => {
  const driveway = ['==', ['get', 'service'], 'driveway'];
  const width = [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    12,
    ['case', ['==', ['get', 'link'], true], 0.7, driveway, 0.8, 1],
    18,
    ['case', ['==', ['get', 'link'], true], 7, driveway, 8, 10],
  ];
  const filter = ['==', ['get', 'class'], 'service'];
  const layer = {
    id: 'roads',
    type: 'line',
    filter,
    paint: {'line-width': width, 'line-color': ['case', driveway, '#111111', '#222222']},
  };
  const parts = compactTileflowLayers(layer);
  assert.deepEqual(
    parts.map(({id}) => id),
    ['roads-link', 'roads-service-driveway', 'roads'],
  );
  // The original ID keeps the features no test selects, above the others.
  for (const properties of [
    {class: 'service'},
    {class: 'service', link: true},
    {class: 'service', service: 'driveway'},
    {class: 'service', link: true, service: 'driveway'},
  ]) {
    const drawing = parts.filter((part) =>
      featureFilter(part.filter as never).filter({zoom: 15}, {type: 2, properties} as never),
    );
    assert.equal(drawing.length, 1, JSON.stringify(properties));
    for (const zoom of [12, 14.5, 18, 20]) {
      const split = lineValue(drawing[0]!.paint['line-width'], 'line-width', zoom, properties);
      assert.notEqual(split.kind, 'composite');
      assert.equal(split.value, lineValue(width, 'line-width', zoom, properties).value);
      assert.equal(
        lineValue(drawing[0]!.paint['line-color'], 'line-color', zoom, properties).value.toString(),
        lineValue(layer.paint['line-color'], 'line-color', zoom, properties).value.toString(),
      );
    }
  }

  // A width read from continuous data cannot be split, and keeps its single layer.
  const measured = [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    15,
    ['*', ['get', 'width_m'], 1],
    22,
    ['*', ['get', 'width_m'], 128],
  ];
  assert.deepEqual(
    compactTileflowLayers({id: 'measured', type: 'line', paint: {'line-width': measured}}).map(
      ({id}) => id,
    ),
    ['measured'],
  );
  // Other layer types and camera-only widths are left alone.
  assert.equal(
    compactTileflowLayers({id: 'circles', type: 'circle', paint: {'circle-radius': width}}).length,
    1,
  );
});

test('folds match branches whose labels the filter excludes', () => {
  const width = ['match', ['get', 'service'], ['driveway'], 0.8, ['alley'], 0.9, 1];
  assert.deepEqual(
    compactTileflowLayer({
      id: 'service',
      filter: ['!', ['match', ['get', 'service'], ['driveway'], true, false]],
      paint: {'line-width': width},
    }).paint['line-width'],
    ['match', ['get', 'service'], ['alley'], 0.9, 1],
  );
});
