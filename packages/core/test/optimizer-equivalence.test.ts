import {
  createPropertyExpression,
  latest as mapLibreStyleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {optimizeTileflowLayers} from '../src/cartography/optimizer';

type Layer = Record<string, unknown> & {id: string; type: string};

const source = 'tileflow';
const sourceLayer = 'transportation';

function roadLayer(
  roadClass: 'motorway' | 'trunk',
  width: unknown,
  options: Record<string, unknown> = {},
): Layer {
  return {
    id: `streets-road-surface-${roadClass}-fill`,
    type: 'line',
    source,
    'source-layer': sourceLayer,
    filter: ['==', ['get', 'class'], roadClass],
    paint: {'line-width': width},
    ...options,
  };
}

function styleErrors(layers: readonly Record<string, unknown>[]): string[] {
  return validateStyleMin({
    version: 8,
    sources: {
      [source]: {
        type: 'vector',
        tiles: ['https://example.com/{z}/{x}/{y}.pbf'],
      },
    },
    layers,
  }).map((error) => error.message);
}

function evaluateProperty(
  expression: unknown,
  specification: Record<string, unknown>,
  zoom: number,
  properties: Record<string, unknown>,
): unknown {
  const parsed = createPropertyExpression(expression, specification as never);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error('Expression did not parse.');
  return parsed.value.evaluate(
    {zoom},
    {
      type: 'Feature',
      properties,
      geometry: {type: 'Point', coordinates: [0, 0]},
    } as never,
    {},
  );
}

test('merges compatible linear road cohorts without changing evaluated widths', () => {
  const motorwayWidth = ['interpolate', ['linear'], ['zoom'], 16, 8, 20, 12];
  const trunkWidth = ['interpolate', ['linear'], ['zoom'], 16, 6, 18, 7, 20, 10];
  const optimized = optimizeTileflowLayers([
    roadLayer('motorway', motorwayWidth, {minzoom: 5}),
    roadLayer('trunk', trunkWidth, {minzoom: 8}),
  ]);
  const merged = optimized.find((layer) => layer.id === 'streets-road-surface-highzoom-major-fill');

  assert.ok(merged);
  assert.deepEqual(styleErrors(optimized), []);
  const mergedWidth = (merged.paint as Record<string, unknown>)['line-width'];
  for (const [roadClass, original] of [
    ['motorway', motorwayWidth],
    ['trunk', trunkWidth],
  ] as const) {
    for (const zoom of [16, 17, 18, 19, 20, 22]) {
      assert.equal(
        evaluateProperty(
          mergedWidth,
          mapLibreStyleSpec.paint_line['line-width'] as Record<string, unknown>,
          zoom,
          {class: roadClass},
        ),
        evaluateProperty(
          original,
          mapLibreStyleSpec.paint_line['line-width'] as Record<string, unknown>,
          zoom,
          {class: roadClass},
        ),
      );
    }
  }
});

test('class-match compaction honors remapped schema fields', () => {
  const input = [
    roadLayer('motorway', 8, {
      filter: ['match', ['get', 'kind'], ['motorway'], true, false],
    }),
    roadLayer('trunk', 6, {
      filter: ['match', ['get', 'kind'], ['trunk'], true, false],
    }),
  ];
  const optimized = optimizeTileflowLayers(input);
  const merged = optimized.find(({id}) => id === 'streets-road-surface-highzoom-major-fill');

  assert.ok(merged);
  assert.match(JSON.stringify(merged), /"get","kind"/);
  assert.doesNotMatch(JSON.stringify(merged), /"get","class"/);
});

test('bails out rather than nesting step or exponential zoom expressions', () => {
  for (const unsupported of [
    ['step', ['zoom'], 1, 18, 4],
    ['interpolate', ['exponential', 1.5], ['zoom'], 16, 1, 20, 4],
  ]) {
    const input = [roadLayer('motorway', unsupported), roadLayer('trunk', 2)];
    const optimized = optimizeTileflowLayers(input);
    assert.deepEqual(optimized, input);
    assert.deepEqual(styleErrors(optimized), []);
  }
});

test('preserves distinct road zoom ranges instead of widening them', () => {
  for (const input of [
    [
      roadLayer('motorway', 3, {minzoom: 18, maxzoom: 22}),
      roadLayer('trunk', 2, {minzoom: 10, maxzoom: 22}),
    ],
    [
      roadLayer('motorway', 3, {minzoom: 10, maxzoom: 19}),
      roadLayer('trunk', 2, {minzoom: 10, maxzoom: 22}),
    ],
  ]) {
    assert.deepEqual(optimizeTileflowLayers(input), input);
  }
});

test('does not merge a cohort across an intervening raw layer', () => {
  const custom: Layer = {id: 'custom-divider', type: 'background'};
  const input = [roadLayer('motorway', 3), custom, roadLayer('trunk', 2)];
  assert.deepEqual(optimizeTileflowLayers(input), input);
});

test('raw override metadata disables the whole affected cohort', () => {
  const input = [
    roadLayer('motorway', 3, {metadata: {'tileflow:rawOverride': true}}),
    roadLayer('trunk', 2),
  ];
  assert.deepEqual(optimizeTileflowLayers(input), input);
});

test('a typed paint patch may consolidate when every equivalence guard succeeds', () => {
  const input = [
    roadLayer('motorway', 3, {
      metadata: {'tileflow:rawOverride': 'patch'},
      paint: {'line-color': 'red', 'line-width': 3},
    }),
    roadLayer('trunk', 2),
  ];
  const optimized = optimizeTileflowLayers(input);

  assert.equal(
    optimized.some(({id}) => id === 'streets-road-surface-highzoom-major-fill'),
    true,
  );
  assert.equal(optimized.find(({id}) => id === 'streets-road-surface-motorway-fill')?.maxzoom, 16);
});

test('generated IDs never collide with raw layers', () => {
  const input: Layer[] = [
    {
      id: 'streets-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: {'fill-color': 'green'},
    },
    {
      id: 'streets-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'scrub'],
      paint: {'fill-color': 'olive'},
    },
    {
      id: 'streets-landcover',
      type: 'fill',
      source,
      'source-layer': 'custom',
      paint: {'fill-color': 'blue'},
    },
  ];
  const optimized = optimizeTileflowLayers(input);
  assert.deepEqual(
    optimized.map((layer) => layer.id),
    input.map((layer) => layer.id),
  );
  assert.deepEqual(styleErrors(optimized), []);
});

test('hatch consolidation uses typed defaults and refuses data-constant differences', () => {
  const hatch = (roadClass: 'motorway' | 'trunk', layout: Record<string, unknown>): Layer => ({
    id: `streets-road-tunnel-${roadClass}-hatch`,
    type: 'symbol',
    source,
    'source-layer': sourceLayer,
    filter: ['==', ['get', 'class'], roadClass],
    layout: {'symbol-placement': 'line', 'text-field': 'x', ...layout},
    paint: {'text-color': 'red'},
  });

  const withMissingRotate = optimizeTileflowLayers([
    hatch('motorway', {'text-rotate': 30}),
    hatch('trunk', {}),
  ]);
  assert.equal(withMissingRotate.length, 1);
  assert.deepEqual(styleErrors(withMissingRotate), []);

  const differentSpacing = [
    hatch('motorway', {'symbol-spacing': 10}),
    hatch('trunk', {'symbol-spacing': 20}),
  ];
  assert.deepEqual(optimizeTileflowLayers(differentSpacing), differentSpacing);
  assert.deepEqual(styleErrors(differentSpacing), []);
});

test('pattern hatches consolidate as clipped line decks', () => {
  const patternHatch = (roadClass: 'motorway' | 'trunk', width: number): Layer => ({
    id: `streets-road-tunnel-${roadClass}-hatch`,
    type: 'line',
    source,
    'source-layer': sourceLayer,
    minzoom: 17,
    filter: ['==', ['get', 'class'], roadClass],
    layout: {'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': 0},
    paint: {
      'line-opacity': 0.58,
      'line-pattern': 'tunnel-hatch',
      'line-width': width,
    },
  });

  const optimized = optimizeTileflowLayers([
    patternHatch('motorway', 18),
    patternHatch('trunk', 14),
  ]);
  assert.equal(optimized.length, 1);
  assert.equal(optimized[0]?.id, 'streets-road-tunnel-hatch');
  assert.equal(optimized[0]?.type, 'line');
  assert.equal((optimized[0]?.paint as Record<string, unknown>)?.['line-pattern'], 'tunnel-hatch');
  assert.match(
    JSON.stringify((optimized[0]?.paint as Record<string, unknown>)?.['line-width']),
    /motorway/,
  );
  assert.deepEqual(styleErrors(optimized), []);
});

test('fill consolidation refuses differently typed data-constant properties', () => {
  const input: Layer[] = [
    {
      id: 'streets-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: {'fill-color': 'green', 'fill-translate': [1, 2]},
    },
    {
      id: 'streets-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'scrub'],
      paint: {'fill-color': 'olive'},
    },
  ];
  assert.deepEqual(optimizeTileflowLayers(input), input);
  assert.deepEqual(styleErrors(input), []);
});

test('overlapping fill filters use the last original layer for paint and sorting', () => {
  const input: Layer[] = [
    {
      id: 'streets-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      paint: {'fill-color': '#00ff00'},
    },
    {
      id: 'streets-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['all', ['==', ['get', 'class'], 'grass'], ['==', ['get', 'subclass'], 'scrub']],
      paint: {'fill-color': '#808000'},
    },
  ];
  const optimized = optimizeTileflowLayers(input);
  assert.equal(optimized.length, 1);
  assert.deepEqual(styleErrors(optimized), []);
  const merged = optimized[0]!;
  const properties = {class: 'grass', subclass: 'scrub'};
  assert.equal(
    String(
      evaluateProperty(
        (merged.paint as Record<string, unknown>)['fill-color'],
        mapLibreStyleSpec.paint_fill['fill-color'] as Record<string, unknown>,
        16,
        properties,
      ),
    ),
    'rgba(128,128,0,1)',
  );
  assert.equal(
    evaluateProperty(
      (merged.layout as Record<string, unknown>)['fill-sort-key'],
      mapLibreStyleSpec.layout_fill['fill-sort-key'] as Record<string, unknown>,
      16,
      properties,
    ),
    3,
  );
});

test('waterway consolidation preserves layout and zoom-range differences', () => {
  const waterway = (
    id: string,
    layout: Record<string, unknown>,
    range: Record<string, unknown>,
  ): Layer => ({
    id,
    type: 'line',
    source,
    'source-layer': 'waterway',
    filter: ['literal', true],
    layout,
    paint: {'line-color': 'blue'},
    ...range,
  });
  for (const input of [
    [
      waterway('streets-waterway-river', {'line-cap': 'round'}, {minzoom: 6}),
      waterway('streets-waterway-river-intermittent', {'line-cap': 'butt'}, {minzoom: 6}),
    ],
    [
      waterway('streets-waterway-river', {}, {minzoom: 6, maxzoom: 18}),
      waterway('streets-waterway-river-intermittent', {}, {minzoom: 8, maxzoom: 18}),
    ],
  ]) {
    assert.deepEqual(optimizeTileflowLayers(input), input);
  }
});

test('waterway consolidation uses a solid dash fallback for regular lines', () => {
  const layers = optimizeTileflowLayers([
    {
      id: 'streets-waterway-river',
      type: 'line',
      source: 'tileflow',
      'source-layer': 'waterway',
      minzoom: 6,
      filter: ['==', ['get', 'class'], 'river'],
      paint: {'line-color': '#99ddff', 'line-width': 2},
    },
    {
      id: 'streets-waterway-river-intermittent',
      type: 'line',
      source: 'tileflow',
      'source-layer': 'waterway',
      minzoom: 6,
      filter: ['all', ['==', ['get', 'class'], 'river'], ['==', ['get', 'intermittent'], 1]],
      paint: {
        'line-color': '#99ddff',
        'line-dasharray': [2, 2],
        'line-opacity': 0.65,
        'line-width': 2,
      },
    },
  ]);

  assert.equal(layers.length, 1);
  assert.match(JSON.stringify(layers[0]?.paint), /line-dasharray/);
  assert.match(JSON.stringify(layers[0]?.paint), /\[1,0\]/);
});

test('multi-branch match filters retain every boolean branch', () => {
  const first = roadLayer('motorway', 5, {
    filter: ['match', ['get', 'class'], 'motorway', true, 'secondary', true, false],
  });
  const second = roadLayer('trunk', 2, {
    filter: ['match', ['get', 'class'], 'trunk', true, 'tertiary', true, false],
  });
  const optimized = optimizeTileflowLayers([first, second]);
  const merged = optimized.find((layer) => layer.id.includes('highzoom-major'))!;
  assert.ok(merged);
  assert.deepEqual(styleErrors(optimized), []);
  const width = (merged.paint as Record<string, unknown>)['line-width'];
  assert.match(JSON.stringify(width), /^\["case"/);
  assert.equal(
    evaluateProperty(
      width,
      mapLibreStyleSpec.paint_line['line-width'] as Record<string, unknown>,
      18,
      {class: 'secondary'},
    ),
    5,
  );
});
