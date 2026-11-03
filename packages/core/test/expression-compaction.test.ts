import {createPropertyExpression, latest} from '@maplibre/maplibre-gl-style-spec';
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
