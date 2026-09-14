import assert from 'node:assert/strict';
import test from 'node:test';
import {lowerNativeStyleRepresentation, type NativeLayer} from '../src/native-lowering';

function nodes(value: unknown): number {
  if (!value || typeof value !== 'object') return 1;
  return 1 + Object.entries(value).reduce((total, [key, child]) => total + nodes(key) + nodes(child), 0);
}

// An evaluator for this finite test vocabulary, not a substitute for the pinned integration oracle.
function evaluate(value: any, properties: Record<string, unknown>): any {
  if (!Array.isArray(value)) return value;
  const [, ...args] = value;
  switch (value[0]) {
    case 'literal': return args[0];
    case 'get': return properties[args[0]] ?? null;
    case '==': return evaluate(args[0], properties) === evaluate(args[1], properties);
    case '!': return !evaluate(args[0], properties);
    case 'all': return args.every((child) => evaluate(child, properties));
    case 'any': return args.some((child) => evaluate(child, properties));
    case 'case': {
      for (let i = 0; i < args.length - 1; i += 2) {
        if (evaluate(args[i], properties)) return evaluate(args[i + 1], properties);
      }
      return evaluate(args.at(-1), properties);
    }
    default: throw new Error('Unsupported test expression.');
  }
}

function style(cap: unknown, filter?: unknown) {
  return {
    version: 8,
    sources: {world: {type: 'vector', url: 'https://example.test/world.json'}},
    layers: [{
      id: 'roads', type: 'line', source: 'world', 'source-layer': 'transportation',
      ...(filter === undefined ? {} : {filter}),
      layout: {'line-cap': cap, 'line-sort-key': ['get', 'priority']},
      paint: {'line-color': ['case', ['==', ['get', 'class'], 'primary'], '#ff0000', '#0000ff']},
    }],
  };
}

function active(layers: NativeLayer[], properties: Record<string, unknown>): NativeLayer[] {
  return layers.filter((layer) => layer.filter === undefined || evaluate(layer.filter, properties));
}

test('keeps grouped decision predicates linear instead of expanding repeated first-match guards', () => {
  const armCount = 12;
  const expression = ['case', ...Array.from({length: armCount}, (_, i) => [
    ['==', ['get', `flag${i}`], true], i % 2 === 0 ? 'round' : 'butt',
  ]).flat(), 'square'];
  const original = style(expression);
  const before = JSON.stringify(original);
  const lowered = lowerNativeStyleRepresentation(original);
  const predicateNodes = lowered.style.layers.reduce((total, layer) => total + nodes(layer.filter), 0);
  assert.ok(predicateNodes <= armCount * 50, `Grouped predicate nodes: ${predicateNodes}`);
  assert.equal(lowered.layers[0]!.outputCount, 3);
  assert.deepEqual(lowered.style.layers.map(({id}) => id), [
    'roads--native-v1-0', 'roads--native-v1-1', 'roads--native-v1-2',
  ]);
  for (let mask = 0; mask < 2 ** armCount; mask++) {
    const properties = Object.fromEntries(Array.from({length: armCount}, (_, i) => [`flag${i}`, Boolean(mask & (1 << i))]));
    const selected = active(lowered.style.layers, properties);
    assert.equal(selected.length, 1, String(mask));
    assert.equal(selected[0]!.layout!['line-cap'], evaluate(expression, properties));
  }
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(lowerNativeStyleRepresentation(original), lowered);
});

test('preserves selection for overlapping nested first-match conditions and the original filter', () => {
  const p = ['==', ['get', 'p'], true];
  const q = ['==', ['get', 'q'], true];
  const r = ['==', ['get', 'r'], true];
  const cap = ['case', p, ['case', q, 'butt', 'round'], r, 'butt', 'square'];
  const original = style(cap, ['!', ['==', ['get', 'excluded'], true]]);
  const lowered = lowerNativeStyleRepresentation(original);
  for (const pValue of [false, true]) for (const qValue of [false, true]) {
    for (const rValue of [false, true]) for (const excluded of [false, true]) {
      const properties = {p: pValue, q: qValue, r: rValue, excluded};
      const selected = active(lowered.style.layers, properties);
      assert.equal(selected.length, Number(!excluded));
      if (selected.length) assert.equal(selected[0]!.layout!['line-cap'], evaluate(cap, properties));
    }
  }
});

test('copying a sort key does not preserve feature draw order across simultaneous branches', () => {
  const original = style(['case', ['==', ['get', 'class'], 'primary'], 'round', 'butt']);
  const lowered = lowerNativeStyleRepresentation(original);
  const features = [{id: 'low', class: 'minor', priority: 0}, {id: 'high', class: 'primary', priority: 1}];
  const before = [...features].sort((a, b) => a.priority - b.priority).map(({id}) => id);
  const after = lowered.style.layers.flatMap((layer) => {
    assert.deepEqual(layer.layout!['line-sort-key'], original.layers[0]!.layout['line-sort-key']);
    return features.filter((feature) => active([layer], feature).length)
      .sort((a, b) => a.priority - b.priority).map(({id}) => id);
  });
  assert.deepEqual(before, ['low', 'high']);
  assert.deepEqual(after, ['high', 'low']);
  assert.notDeepEqual(after, before);
  // This is a structural counterexample; it makes no assertion about rendered native pixels.
});

test('does not turn a flat finite case into a predicate exceeding the style depth budget', () => {
  const cap = ['case', ...Array.from({length: 63}, (_, i) => [
    ['==', ['get', `flag${i}`], true], i % 2 === 0 ? 'round' : 'butt',
  ]).flat(), 'square'];
  const lowered = lowerNativeStyleRepresentation(style(cap));
  const depth = (value: unknown): number => !value || typeof value !== 'object' ? 0 :
    1 + Math.max(0, ...Object.values(value).map(depth));
  assert.ok(depth(lowered.style) <= 16, `Output depth: ${depth(lowered.style)}`);
});
