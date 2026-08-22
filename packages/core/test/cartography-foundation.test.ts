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

test('rejects unknown expression operators before style compilation', () => {
  assert.throws(
    () => expression<number>(['totally-invalid-op', 1]),
    /Unknown MapLibre expression operator/,
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

test('keeps navigation-visible tunnels above base areas but below surface transport and buildings', () => {
  const order = resolveSlotOrder();
  const position = (slot: (typeof order)[number]) => order.indexOf(slot);

  assert.ok(position('hydro') < position('transport-tunnel-shadow'));
  assert.ok(position('building-areas') < position('transport-tunnel-shadow'));
  assert.ok(position('transport-areas') < position('transport-tunnel-shadow'));
  assert.ok(position('transport-tunnel-shadow') < position('transport-tunnel-casing'));
  assert.ok(position('transport-tunnel-casing') < position('transport-tunnel-fill'));
  assert.ok(position('transport-tunnel-fill') < position('buildings'));
  assert.ok(position('transport-tunnel-fill') < position('aeroways'));
  assert.ok(position('transport-tunnel-fill') < position('transport-surface-shadow'));
  assert.ok(position('transport-tunnel-fill') < position('symbols'));
});

test('keeps pitched-scene geometry in physical order below annotations', () => {
  const order = resolveSlotOrder();
  const position = (slot: (typeof order)[number]) => order.indexOf(slot);

  assert.ok(position('building-areas') < position('transport-areas'));
  assert.ok(position('building-areas') < position('transport-surface-fill'));
  assert.ok(position('transport-areas') < position('transport-surface-fill'));
  assert.ok(position('transport-surface-fill') < position('transport-symbols'));
  assert.ok(position('transport-bridge-fill') < position('transport-symbols'));
  assert.ok(position('transport-symbols') < position('buildings'));
  assert.ok(position('buildings') < position('vegetation'));
  assert.ok(position('vegetation') < position('symbols'));
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
