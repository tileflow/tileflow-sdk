import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lowerNativeStyleRepresentation,
  NativeLoweringError,
  nativeLoweringLimits,
} from '../src/native-lowering';

type RecordValue = Record<string, any>;
const source = {type: 'vector', tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf']};
const line = (layout: RecordValue = {}, paint: RecordValue = {}) => ({
  id: 'road',
  type: 'line',
  source: 'world',
  'source-layer': 'transportation',
  metadata: {'fixture:owner': 'roads'},
  layout,
  paint,
});
const style = (...layers: RecordValue[]) => ({version: 8, sources: {world: source}, layers});
const flag = ['==', ['get', 'kind'], 'primary'];
const caps = ['case', flag, 'round', 'butt'];
const dashes = [
  'case',
  ['==', ['get', 'access'], 'private'],
  ['literal', [2, 3]],
  ['literal', [1, 0]],
];

// Independent interpreter for the accepted decision grammar; no lowering helpers are reused.
function evaluate(value: any, feature: RecordValue, zoom: number): any {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return value;
  const [operator, ...args] = value;
  const run = (item: any) => evaluate(item, feature, zoom);
  switch (operator) {
    case 'literal':
      return args[0];
    case 'get':
      return Object.hasOwn(feature, args[0]) ? feature[args[0]] : null;
    case 'has':
      return Object.hasOwn(feature, args[0]);
    case 'zoom':
      return zoom;
    case 'geometry-type':
      return 'LineString';
    case 'to-string':
      return String(run(args[0]));
    case 'coalesce':
      return args.map(run).find((value: any) => value !== null) ?? null;
    case 'match': {
      const input = run(args[0]);
      for (let i = 1; i < args.length - 1; i += 2) {
        const labels = Array.isArray(args[i]) ? args[i] : [args[i]];
        if (labels.includes(input)) return run(args[i + 1]);
      }
      return run(args.at(-1));
    }
    case '==':
      return run(args[0]) === run(args[1]);
    case '!=':
      return run(args[0]) !== run(args[1]);
    case '<':
      return run(args[0]) < run(args[1]);
    case '<=':
      return run(args[0]) <= run(args[1]);
    case '>':
      return run(args[0]) > run(args[1]);
    case '>=':
      return run(args[0]) >= run(args[1]);
    case '!':
      return !run(args[0]);
    case 'all':
      return args.every(run);
    case 'any':
      return args.some(run);
    case 'in':
      return run(args[1]).includes(run(args[0]));
    case 'to-number': {
      const number = Number(run(args[0]));
      return Number.isFinite(number) ? number : args[1];
    }
    case 'case': {
      for (let i = 0; i < args.length - 1; i += 2) if (run(args[i])) return run(args[i + 1]);
      return run(args.at(-1));
    }
    case 'step': {
      const input = run(args[0]);
      let output = args[1];
      for (let i = 2; i < args.length; i += 2) {
        if (input < args[i]) break;
        output = args[i + 1];
      }
      return run(output);
    }
    default:
      throw new Error(`Unexpected fixture operator: ${operator}`);
  }
}

function active(layer: RecordValue, feature: RecordValue, zoom: number): boolean {
  return (
    zoom >= (layer.minzoom ?? 0) &&
    zoom < (layer.maxzoom ?? 24) &&
    (layer.filter === undefined || Boolean(evaluate(layer.filter, feature, Math.floor(zoom))))
  );
}

function assertEquivalent(original: RecordValue, physical: RecordValue[]): void {
  const values = [undefined, null, false, true, 0, 1, 'primary', 'private', 'bridge', 'tunnel'];
  for (const kind of values)
    for (const access of values)
      for (const brunnel of values) {
        const feature = Object.fromEntries(
          Object.entries({
            kind,
            access,
            brunnel,
            level: 1,
            class: 'primary',
            toll: 1,
            oneway: 1,
          }).filter(([, value]) => value !== undefined),
        );
        for (const zoom of [
          0, 1, 4.25, 8.9999, 9, 9.99, 12, 16.9999, 17, 17.5, 17.9999, 18, 23.75, 24,
        ]) {
          const matches = physical.filter((layer) => active(layer, feature, zoom));
          assert.equal(
            matches.length,
            Number(active(original, feature, zoom)),
            JSON.stringify({feature, zoom}),
          );
          if (!matches.length) continue;
          for (const [group, property] of [
            ['layout', 'line-cap'],
            ['paint', 'line-dasharray'],
          ]) {
            assert.deepEqual(
              matches[0]![group]?.[property],
              evaluate(original[group]?.[property], feature, Math.floor(zoom)),
            );
          }
        }
      }
}

test('leaves constant line properties and unrelated layers untouched', () => {
  const original = style(line({'line-cap': 'round'}, {'line-dasharray': [2, 3]}));
  const result = lowerNativeStyleRepresentation(original);
  assert.equal(result.style, original);
  assert.deepEqual(result.layers, []);
});

test('normalizes literal leaves and documents projection conversion without mutating input', () => {
  for (const projection of ['globe', 'mercator']) {
    const original = {
      ...style(line({'line-cap': ['literal', 'butt']})),
      projection: {type: projection},
    };
    const bytes = JSON.stringify(original);
    const result = lowerNativeStyleRepresentation(original);
    assert.equal('projection' in result.style, false);
    assert.equal(
      result.projection,
      projection === 'globe' ? 'globe-to-mercator' : 'mercator-to-implicit',
    );
    assert.equal(result.style.layers[0]!.layout['line-cap'], 'butt');
    assert.equal(JSON.stringify(original), bytes);
  }
});

test('partitions feature cases and the product of cap and dash without changing other properties', () => {
  const original = line(
    {'line-cap': caps},
    {'line-dasharray': dashes, 'line-width': ['get', 'width']},
  );
  const before = JSON.stringify(original);
  const result = lowerNativeStyleRepresentation(style(original));
  assert.equal(result.style.layers.length, 4);
  assertEquivalent(original, result.style.layers);
  for (const layer of result.style.layers) {
    assert.equal(layer.source, original.source);
    assert.equal(layer['source-layer'], original['source-layer']);
    assert.equal(layer.metadata, original.metadata);
    assert.equal(layer.paint['line-width'], original.paint['line-width']);
  }
  assert.equal(JSON.stringify(original), before);
});

test('preserves exact min/max ranges and integer camera sampling at fractional step stops', () => {
  const original = {
    ...line(
      {'line-cap': ['step', ['zoom'], 'butt', 8.5, caps, 17.2, 'square']},
      {'line-dasharray': [1, 0]},
    ),
    filter: ['!=', ['get', 'access'], 'private'],
    minzoom: 4.25,
    maxzoom: 23.75,
  };
  const result = lowerNativeStyleRepresentation(style(original));
  assertEquivalent(original, result.style.layers);
  assert.deepEqual(
    [...new Set(result.style.layers.map((layer: any) => layer.minzoom))],
    [4.25, 9, 18],
  );
  assert.deepEqual(
    [...new Set(result.style.layers.map((layer: any) => layer.maxzoom))],
    [9, 18, 23.75],
  );
  assert.ok(
    result.style.layers.every((layer: any) => !JSON.stringify(layer.filter).includes('zoom')),
  );
});

test('handles mixed zoom/feature predicates and numeric feature steps', () => {
  const original = line(
    {
      'line-cap': ['case', ['all', ['>=', ['zoom'], 17.5], flag], 'round', 'butt'],
    },
    {
      'line-dasharray': [
        'step',
        ['to-number', ['get', 'level'], 0],
        ['literal', [1, 0]],
        1,
        ['literal', [2, 3]],
        3,
        ['literal', [4, 1]],
      ],
    },
  );
  assertEquivalent(original, lowerNativeStyleRepresentation(style(original)).style.layers);
});

test('keeps physical replacements contiguous, stable and collision-free', () => {
  const before = {id: 'before', type: 'background'};
  const after = {id: 'road--native-v1-0', type: 'background'};
  const original = style(before, line({'line-cap': caps}), after);
  const first = lowerNativeStyleRepresentation(original);
  const second = lowerNativeStyleRepresentation(structuredClone(original));
  assert.deepEqual(first, second);
  assert.equal(first.style.layers[0], before);
  assert.equal(first.style.layers.at(-1), after);
  assert.equal(new Set(first.style.layers.map((layer: any) => layer.id)).size, 4);
  const shifted = lowerNativeStyleRepresentation(
    style({id: 'extra', type: 'background'}, ...original.layers),
  );
  assert.deepEqual(
    first.style.layers.slice(1, -1).map((layer: any) => layer.id),
    shifted.style.layers.slice(2, -1).map((layer: any) => layer.id),
  );
});

test('keeps original filters as the first conjunct and uses the supplied legacy converter', () => {
  const filter = ['==', 'class', 'primary'];
  const normalized = ['==', ['get', 'class'], 'primary'];
  const original = {...line({'line-cap': caps}), filter};
  let calls = 0;
  const result = lowerNativeStyleRepresentation(style(original), (input) => {
    assert.equal(input, filter);
    calls++;
    return normalized;
  });
  assert.equal(calls, 1);
  for (const layer of result.style.layers)
    assert.deepEqual(layer.filter.slice(0, 2), ['all', normalized]);
});

test('coalesces identical outcomes across case arms and adjacent zoom intervals', () => {
  const original = line({'line-cap': ['step', ['zoom'], caps, 10, caps, 17, caps]});
  const result = lowerNativeStyleRepresentation(style(original));
  assert.equal(result.style.layers.length, 2);
  assert.ok(
    result.style.layers.every(
      (layer: any) => layer.minzoom === undefined && layer.maxzoom === undefined,
    ),
  );
  assertEquivalent(original, result.style.layers);
});

for (const [property, value] of [
  ['line-cap', ['get', 'cap']],
  ['line-cap', ['interpolate', ['linear'], ['zoom'], 0, 'butt', 20, 'round']],
  ['line-cap', ['case', ['feature-state', 'selected'], 'round', 'butt']],
  ['line-cap', ['case', ['>', ['get', 'rank'], 1], 'round', 'butt']],
  ['line-dasharray', ['case', flag, ['literal', [-1, 2]], ['literal', [1, 0]]]],
] as const) {
  test(`rejects unprovable ${property}: ${JSON.stringify(value)}`, () => {
    const group = property === 'line-cap' ? 'layout' : 'paint';
    const original = {...line(), [group]: {[property]: value}};
    assert.throws(
      () => lowerNativeStyleRepresentation(style(original)),
      (error: unknown) => {
        assert.ok(error instanceof NativeLoweringError);
        assert.ok(error.path.startsWith(`/layers/0/${group}/${property}`));
        assert.equal(error.message.includes('selected'), false);
        return true;
      },
    );
  });
}

for (const projection of [
  {type: ['globe']},
  {type: 'vertical-perspective'},
  {type: ['step', ['zoom'], 'globe', 10, 'mercator']},
  {type: 'globe', extra: true},
]) {
  test(`rejects a non-fixed projection: ${JSON.stringify(projection)}`, () => {
    assert.throws(
      () => lowerNativeStyleRepresentation({...style(line()), projection}),
      (error: unknown) => error instanceof NativeLoweringError && error.path === '/projection',
    );
  });
}

test('bounds tree depth, outcome products, zoom partitions, layers and decision size', () => {
  let nested: any = 'butt';
  for (let i = 0; i <= nativeLoweringLimits.maximumDecisionDepth; i++)
    nested = ['case', flag, 'round', nested];
  assert.throws(
    () => lowerNativeStyleRepresentation(style(line({'line-cap': nested}))),
    NativeLoweringError,
  );
  const tooMany: any[] = ['step', ['zoom'], 'butt'];
  for (let i = 1; i < 24; i++) tooMany.push(i, caps);
  const dash: any[] = ['case'];
  for (let i = 0; i < 16; i++) dash.push(['==', ['get', 'level'], i], ['literal', [i + 1, 1]]);
  dash.push(['literal', [20, 1]]);
  assert.throws(
    () =>
      lowerNativeStyleRepresentation(style(line({'line-cap': tooMany}, {'line-dasharray': dash}))),
    NativeLoweringError,
  );
  const huge = style(...Array.from({length: 4097}, (_, index) => ({...line(), id: String(index)})));
  assert.throws(() => lowerNativeStyleRepresentation(huge), NativeLoweringError);
});

test('preserves the actual Streets detailed cap and rail dash decision forms', () => {
  const closed = [
    'any',
    ['in', ['get', 'access'], ['literal', ['no', 'private']]],
    ['==', ['get', 'level'], 1],
    [
      'all',
      ['==', ['get', 'toll'], 1],
      ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
    ],
  ];
  const original = line(
    {
      'line-cap': [
        'step',
        ['zoom'],
        ['case', ['==', ['get', 'brunnel'], 'bridge'], 'butt', 'round'],
        17,
        ['case', ['==', ['get', 'brunnel'], 'tunnel'], 'butt', closed, 'butt', 'round'],
      ],
    },
    {
      'line-dasharray': [
        'step',
        ['zoom'],
        ['literal', [0.1, 15]],
        16,
        ['literal', [0.1, 1]],
        18,
        ['literal', [0.05, 0.5]],
      ],
    },
  );
  const result = lowerNativeStyleRepresentation(style(original));
  assertEquivalent(original, result.style.layers);
  assert.ok(result.style.layers.length <= nativeLoweringLimits.maximumLayerVariants);
});

test('lowers compiler cohort match decisions and match predicates with disjoint labels', () => {
  const original = line(
    {
      'line-cap': [
        'match',
        ['get', 'kind'],
        ['primary', 'trunk'],
        caps,
        'private',
        'square',
        'butt',
      ],
    },
    {
      'line-dasharray': [
        'case',
        [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          ['match', ['get', 'access'], ['private', 'no'], true, false],
        ],
        ['literal', [2, 3]],
        ['literal', [1, 0]],
      ],
    },
  );
  assertEquivalent(original, lowerNativeStyleRepresentation(style(original)).style.layers);
});

test('rejects duplicate match labels and non-scalar unchecked sources', () => {
  assert.throws(
    () =>
      lowerNativeStyleRepresentation(
        style(
          line({
            'line-cap': ['match', ['get', 'kind'], 'primary', 'round', 'primary', 'butt', 'square'],
          }),
        ),
      ),
    NativeLoweringError,
  );
  assert.throws(
    () =>
      lowerNativeStyleRepresentation({
        ...style(line({'line-cap': caps})),
        sources: {world: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
      }),
    NativeLoweringError,
  );
});

test('reduces finite boolean steps nested in feature/zoom case predicates', () => {
  const original = line({
    'line-cap': [
      'case',
      ['all', ['has', 'kind'], ['step', ['zoom'], false, 9, flag, 17, true]],
      'round',
      'butt',
    ],
  });
  assertEquivalent(original, lowerNativeStyleRepresentation(style(original)).style.layers);
});

test('accepts the 32-variant product boundary and rejects the next finite product', () => {
  const dash: any[] = ['match', ['get', 'access']];
  for (let i = 0; i < 15; i++) dash.push(String(i), ['literal', [i + 1, 1]]);
  dash.push(['literal', [16, 1]]);
  const valid = line({'line-cap': caps}, {'line-dasharray': dash});
  assert.equal(lowerNativeStyleRepresentation(style(valid)).outputLayers, 32);
  const overflow = line(
    {'line-cap': ['match', ['get', 'kind'], 'a', 'butt', 'b', 'round', 'square']},
    {'line-dasharray': dash},
  );
  assert.throws(
    () => lowerNativeStyleRepresentation(style(overflow)),
    (error: unknown) =>
      error instanceof NativeLoweringError &&
      error.path === '/layers/0' &&
      error.reason === 'budget',
  );
});

test('counts unexpanded layers in the output layer budget and preserves sort keys', () => {
  const other = Array.from({length: 4094}, (_, i) => ({id: `background-${i}`, type: 'background'}));
  const original = line({'line-cap': caps, 'line-sort-key': ['to-number', ['get', 'level'], 0]});
  const valid = lowerNativeStyleRepresentation(style(...other, original));
  assert.equal(valid.outputLayers, 4096);
  for (const layer of valid.style.layers.slice(-2)) {
    assert.equal(layer.layout!['line-sort-key'], original.layout['line-sort-key']);
  }
  assert.throws(
    () =>
      lowerNativeStyleRepresentation(style(...other, original, {id: 'end', type: 'background'})),
    (error: unknown) => error instanceof NativeLoweringError && error.reason === 'budget',
  );
});

test('keeps all branches exhaustive and disjoint even when their conditions overlap', () => {
  const original = line(
    {'line-cap': ['case', ['has', 'kind'], 'round', flag, 'square', 'butt']},
    {
      'line-dasharray': [
        'case',
        ['has', 'kind'],
        ['literal', [2, 3]],
        flag,
        ['literal', [4, 1]],
        ['literal', [1, 0]],
      ],
    },
  );
  assertEquivalent(original, lowerNativeStyleRepresentation(style(original)).style.layers);
});
