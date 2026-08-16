import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleTileflowLayers, resolveSlotOrder} from '../src/cartography/graph';
import {
  expression,
  filter,
  toMapLibreFilter,
  toMapLibreStyleValue,
  zoom,
} from '../src/cartography/values';

test('converts validated zoom values and expressions to MapLibre values', () => {
  assert.deepEqual(
    toMapLibreStyleValue(
      zoom.linear([
        [5, 1],
        [10, 4],
      ]),
    ),
    ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 4],
  );
  assert.deepEqual(
    toMapLibreStyleValue(
      zoom.step([
        [5, '#fff'],
        [10, '#000'],
      ]),
    ),
    ['step', ['zoom'], '#fff', 10, '#000'],
  );
  assert.deepEqual(toMapLibreStyleValue(expression<number>(['get', 'rank'])), ['get', 'rank']);
  assert.deepEqual(toMapLibreFilter(filter(['==', ['get', 'class'], 'primary'])), [
    '==',
    ['get', 'class'],
    'primary',
  ]);

  assert.throws(() => zoom.linear([]), /at least one stop/);
  assert.throws(
    () =>
      zoom.linear([
        [10, 1],
        [9, 2],
      ]),
    /strictly increasing/,
  );
});

test('assembles layer contributions deterministically and rejects ambiguity', () => {
  const layers = assembleTileflowLayers([
    contribution('road', 'roads', 'transport-surface-fill', 200),
    contribution('water', 'water', 'hydro', 20),
    contribution('land', 'land', 'land', 10),
  ]);

  assert.deepEqual(
    layers.map((layer) => layer.id),
    ['land', 'water', 'road'],
  );
  assert.throws(
    () =>
      assembleTileflowLayers([
        contribution('one', 'land', 'land', 10),
        contribution('two', 'land', 'land', 10),
      ]),
    /Conflicting Tileflow layer order/,
  );
  assert.throws(
    () =>
      assembleTileflowLayers([
        contribution('same', 'land', 'land', 10),
        contribution('same', 'water', 'hydro', 20),
      ]),
    /Duplicate Tileflow layer ID/,
  );
});

test('rejects cyclic slot constraints', () => {
  assert.throws(
    () => resolveSlotOrder([{before: 'symbols', after: 'background'}]),
    /contain a cycle/,
  );
});

test('keeps tunnels below buildings and every surface transport phase', () => {
  const order = resolveSlotOrder();
  const position = (slot: (typeof order)[number]) => order.indexOf(slot);

  assert.ok(position('transport-tunnel-fill') < position('buildings'));
  assert.ok(position('transport-tunnel-fill') < position('transport-areas'));
  assert.ok(position('transport-tunnel-fill') < position('transport-surface-shadow'));
  assert.ok(position('transport-tunnel-fill') < position('symbols'));
});

function contribution(
  id: string,
  owner: 'land' | 'roads' | 'water',
  slot: 'hydro' | 'land' | 'transport-surface-fill',
  localOrder: number,
) {
  return {
    kind: 'layer' as const,
    layer: {id, type: id === 'land' ? 'fill' : 'line'},
    localOrder,
    owner,
    slot,
    target: id,
  };
}
