import {createPropertyExpression, featureFilter, latest} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactTileflowExpression,
  compactTileflowLayer,
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
