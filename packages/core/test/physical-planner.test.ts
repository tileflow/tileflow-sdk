import {
  createPropertyExpression,
  featureFilter,
  latest as mapLibreStyleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowCompilerProvenanceMetadataKey} from '../src/cartography/compiler-inspection';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {planTileflowLayers} from './layer-ir-fixture';

type Layer = Record<string, unknown> & {id: string; type: string};

const source = 'tileflow';
const sourceLayer = 'transportation';

function semanticMetadata(owner: string, slot: string, target: string) {
  return {
    [tileflowCompilerMetadataKeys.owner]: owner,
    [tileflowCompilerMetadataKeys.slot]: slot,
    [tileflowCompilerMetadataKeys.target]: target,
  };
}

function renderOperationMetadata(
  kind: 'pass' | 'refinement',
  owner: string,
  slot: string,
  target: string,
) {
  return {
    ...semanticMetadata(owner, slot, target),
    [tileflowCompilerProvenanceMetadataKey]: [
      {
        operations: [{kind, owner, target}],
        owner,
        slot,
        target,
      },
    ],
  };
}

function roadLayer(
  roadClass: 'motorway' | 'trunk',
  width: unknown,
  options: Record<string, unknown> = {},
): Layer {
  const {metadata, ...layerOptions} = options;
  return {
    id: `tileflow-road-surface-${roadClass}-fill`,
    type: 'line',
    source,
    'source-layer': sourceLayer,
    filter: ['==', ['get', 'class'], roadClass],
    metadata: {
      ...semanticMetadata(
        'roads',
        'transport-surface-fill',
        `roads.classes.${roadClass}.surface.fill`,
      ),
      ...(metadata as Record<string, unknown> | undefined),
    },
    paint: {'line-width': width},
    ...layerOptions,
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

function roadNameLayer(roadClass: string, layout: Record<string, unknown> = {}): Layer {
  return {
    id: `road-name-${roadClass}`,
    type: 'symbol',
    source,
    'source-layer': 'transportation_name',
    filter: ['==', ['get', 'class'], roadClass],
    metadata: semanticMetadata('labels', 'symbols', `labels.roads.${roadClass}`),
    layout: {'symbol-placement': 'line', 'text-field': ['get', 'name'], ...layout},
  };
}

test('merged road names retain top-layer-first collision priority', () => {
  // Navigation names are authored bottom-to-top: secondary, then primary.
  // Without consolidation MapLibre offers primary names first.
  for (const sortKey of [undefined, -90, ['get', 'priority']]) {
    const layout = sortKey === undefined ? {} : {'symbol-sort-key': sortKey};
    const layers = planTileflowLayers([
      roadNameLayer('secondary', layout),
      roadNameLayer('primary', layout),
    ]);
    assert.equal(layers.length, 1);
    assert.deepEqual(styleErrors(layers), []);
    const key = (layers[0]!.layout as Record<string, unknown>)['symbol-sort-key'];
    const priority = (roadClass: string, rank: number) =>
      evaluateProperty(key, mapLibreStyleSpec.layout_symbol['symbol-sort-key'], 15, {
        class: roadClass,
        priority: rank,
      }) as number;
    assert.ok(priority('primary', 1000) < priority('secondary', -1000));
    if (Array.isArray(sortKey)) {
      assert.ok(priority('primary', -1000) < priority('primary', 1000));
      assert.ok(priority('secondary', -1000) < priority('secondary', 1000));
    }
  }
});

test('overlapping road names retain bottom-to-top drawing order when merged', () => {
  for (const kind of ['text', 'icon']) {
    for (const layout of [
      {[`${kind}-allow-overlap`]: true},
      {[`${kind}-ignore-placement`]: true},
      {[`${kind}-overlap`]: 'always'},
      {[`${kind}-overlap`]: 'cooperative'},
      {[`${kind}-overlap`]: 'never', [`${kind}-allow-overlap`]: true},
    ]) {
      const layers = planTileflowLayers([
        roadNameLayer('secondary', layout),
        roadNameLayer('primary', layout),
      ]);
      assert.equal(layers.length, 1);
      assert.deepEqual(styleErrors(layers), []);
      const key = (layers[0]!.layout as Record<string, unknown>)['symbol-sort-key'];
      const rank = (roadClass: string) =>
        evaluateProperty(key, mapLibreStyleSpec.layout_symbol['symbol-sort-key'], 15, {
          class: roadClass,
        }) as number;
      assert.equal(rank('primary') > rank('secondary'), layout[`${kind}-overlap`] !== 'never');
    }
  }
});

test('camera-dependent overlap keeps separate road layers so collision order can change', () => {
  const layout = {'text-overlap': ['step', ['zoom'], 'never', 16, 'always']};
  const layers = planTileflowLayers([
    roadNameLayer('secondary', layout),
    roadNameLayer('primary', layout),
  ]);
  assert.equal(layers.length, 2);
  assert.deepEqual(styleErrors(layers), []);
});

test('network road names share placement without changing class visibility or size', () => {
  const input = [
    {...roadNameLayer('minor'), minzoom: 13, maxzoom: 19},
    {...roadNameLayer('primary'), minzoom: 12},
    {...roadNameLayer('motorway'), minzoom: 10},
  ].map((layer, index) => ({
    ...layer,
    layout: {
      ...(layer.layout as Record<string, unknown>),
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8 + index, 18, 14 + index],
    },
  }));
  const output = planTileflowLayers(input, 'network');
  assert.equal(output.length, 1, 'a single bucket suppresses repeat names across road classes');
  assert.deepEqual(styleErrors(output), []);
  assert.equal((output[0]!.layout as Record<string, unknown>)['symbol-sort-key'], undefined);
  const visible = (layer: Layer, zoom: number, properties: Record<string, unknown>) =>
    zoom >= Number(layer.minzoom ?? 0) &&
    zoom < Number(layer.maxzoom ?? Infinity) &&
    featureFilter(layer.filter as never).filter({zoom}, {type: 2, properties} as never);
  for (const [index, roadClass] of ['minor', 'primary', 'motorway'].entries()) {
    for (const zoom of [9, 10, 11.99, 12, 12.99, 13, 15.5, 18, 18.99, 19, 20]) {
      const properties = {class: roadClass, name: 'Same avenue'};
      assert.equal(visible(output[0]!, zoom, properties), visible(input[index]!, zoom, properties));
      if (!visible(input[index]!, zoom, properties)) continue;
      const size = (layer: Layer) =>
        evaluateProperty(
          (layer.layout as Record<string, unknown>)['text-size'],
          mapLibreStyleSpec.layout_symbol['text-size'],
          zoom,
          properties,
        );
      assert.equal(size(output[0]!), size(input[index]!));
    }
  }
});

test('network grouping respects explicit priorities, styling and ordering boundaries', () => {
  const first = roadNameLayer('secondary');
  const second = roadNameLayer('primary');
  for (const variant of [
    {...second, minzoom: 12.5},
    {...second, paint: {'text-color': '#ff0000'}},
    roadNameLayer('primary', {'symbol-sort-key': -90}),
    {
      ...second,
      metadata: renderOperationMetadata('pass', 'labels', 'symbols', 'labels.roads.primary'),
    },
  ])
    assert.equal(planTileflowLayers([first, variant], 'network').length, 2);
  const intervening: Layer = {id: 'divider', type: 'background'};
  assert.equal(planTileflowLayers([first, intervening, second], 'network').length, 3);
  const priority = ['get', 'rank'];
  const common = planTileflowLayers(
    [
      roadNameLayer('secondary', {'symbol-sort-key': priority}),
      roadNameLayer('primary', {'symbol-sort-key': priority}),
    ],
    'network',
  );
  assert.equal(common.length, 1);
  assert.deepEqual((common[0]!.layout as Record<string, unknown>)['symbol-sort-key'], priority);
});

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
  const optimized = planTileflowLayers([
    roadLayer('motorway', motorwayWidth, {minzoom: 5}),
    roadLayer('trunk', trunkWidth, {minzoom: 8}),
  ]);
  const merged = optimized.find(
    (layer) => layer.id === 'tileflow-road-surface-highzoom-major-fill',
  );

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

test('the compiler frontend assigns planner families independently from physical layer IDs', () => {
  const semanticRoad = (roadClass: 'motorway' | 'trunk', id: string, width: number): Layer => ({
    ...roadLayer(roadClass, width, {minzoom: 5}),
    id,
    metadata: {
      [tileflowCompilerMetadataKeys.owner]: 'roads',
      [tileflowCompilerMetadataKeys.slot]: 'transport-surface-fill',
      [tileflowCompilerMetadataKeys.target]: `roads.classes.${roadClass}.surface.fill`,
    },
  });
  const optimized = planTileflowLayers([
    semanticRoad('motorway', 'physical-layer-a', 8),
    semanticRoad('trunk', 'physical-layer-b', 6),
  ]);

  assert.ok(optimized.some((layer) => layer.id === 'tileflow-road-surface-highzoom-major-fill'));
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
  const optimized = planTileflowLayers(input);
  const merged = optimized.find(({id}) => id === 'tileflow-road-surface-highzoom-major-fill');

  assert.ok(merged);
  assert.match(JSON.stringify(merged), /"get","kind"/);
  assert.doesNotMatch(JSON.stringify(merged), /"get","class"/);
});

test('bails out rather than nesting step zoom expressions', () => {
  const input = [roadLayer('motorway', ['step', ['zoom'], 1, 18, 4]), roadLayer('trunk', 2)];
  const optimized = planTileflowLayers(input);
  assert.deepEqual(optimized, input);
  assert.deepEqual(styleErrors(optimized), []);
});

test('merges exponential road cohorts without changing evaluated widths', () => {
  const motorwayWidth = ['interpolate', ['exponential', 1.5], ['zoom'], 12, 3.2, 18, 30, 22, 300];
  const trunkWidth = ['interpolate', ['exponential', 1.5], ['zoom'], 12, 3, 18, 28, 22, 280];
  const optimized = planTileflowLayers([
    roadLayer('motorway', motorwayWidth),
    roadLayer('trunk', trunkWidth),
  ]);
  const merged = optimized.find(
    (layer) => layer.id === 'tileflow-road-surface-highzoom-major-fill',
  );

  assert.ok(merged);
  assert.deepEqual(styleErrors(optimized), []);
  const mergedWidth = (merged.paint as Record<string, unknown>)['line-width'];
  for (const [roadClass, original] of [
    ['motorway', motorwayWidth],
    ['trunk', trunkWidth],
  ] as const) {
    for (const zoom of [15, 16, 18, 20, 22]) {
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

test('mixed linear and exponential road cohorts preserve exact evaluated widths', () => {
  const widths = {
    motorway: ['interpolate', ['linear'], ['zoom'], 16, 8, 20, 12],
    trunk: ['interpolate', ['exponential', 1.5], ['zoom'], 16, 6, 20, 10],
  } as const;
  const input = [roadLayer('motorway', widths.motorway), roadLayer('trunk', widths.trunk)];
  const optimized = planTileflowLayers(input);

  assert.deepEqual(styleErrors(optimized), []);
  assert.deepEqual(optimized, input, 'Mixed interpolation methods must make the cohort bail out');
  const merged = optimized.find(
    (layer) => layer.id === 'tileflow-road-surface-highzoom-major-fill',
  );
  for (const roadClass of ['motorway', 'trunk'] as const) {
    const optimizedLayer =
      merged ?? optimized.find((layer) => layer.id === `tileflow-road-surface-${roadClass}-fill`);
    assert.ok(optimizedLayer, `Optimizer dropped the ${roadClass} cohort`);
    const optimizedWidth = (optimizedLayer.paint as Record<string, unknown>)['line-width'];

    for (const zoom of [16, 16.5, 17, 18, 19, 19.5, 20]) {
      assert.ok(
        (typeof optimizedLayer.minzoom !== 'number' || optimizedLayer.minzoom <= zoom) &&
          (typeof optimizedLayer.maxzoom !== 'number' || zoom < optimizedLayer.maxzoom),
        `Optimizer made the ${roadClass} cohort inactive at z${zoom}`,
      );
      assert.equal(
        evaluateProperty(
          optimizedWidth,
          mapLibreStyleSpec.paint_line['line-width'] as Record<string, unknown>,
          zoom,
          {class: roadClass},
        ),
        evaluateProperty(
          widths[roadClass],
          mapLibreStyleSpec.paint_line['line-width'] as Record<string, unknown>,
          zoom,
          {class: roadClass},
        ),
        `${roadClass} width changed at z${zoom}`,
      );
    }
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
    assert.deepEqual(planTileflowLayers(input), input);
  }
});

test('does not merge a cohort across an intervening contribution', () => {
  const custom: Layer = {id: 'custom-divider', type: 'background'};
  const input = [roadLayer('motorway', 3), custom, roadLayer('trunk', 2)];
  assert.deepEqual(planTileflowLayers(input), input);
});

test('an ordered render pass disables the whole affected cohort', () => {
  const input = [
    roadLayer('motorway', 3, {
      metadata: renderOperationMetadata(
        'pass',
        'roads',
        'transport-surface-fill',
        'roads.classes.motorway.surface.fill',
      ),
    }),
    roadLayer('trunk', 2),
  ];
  assert.deepEqual(planTileflowLayers(input), input);
});

test('a typed render refinement may consolidate when every equivalence guard succeeds', () => {
  const input = [
    roadLayer('motorway', 3, {
      metadata: renderOperationMetadata(
        'refinement',
        'roads',
        'transport-surface-fill',
        'roads.classes.motorway.surface.fill',
      ),
      paint: {'line-color': 'red', 'line-width': 3},
    }),
    roadLayer('trunk', 2),
  ];
  const optimized = planTileflowLayers(input);

  assert.equal(
    optimized.some(({id}) => id === 'tileflow-road-surface-highzoom-major-fill'),
    true,
  );
  assert.equal(optimized.find(({id}) => id === 'tileflow-road-surface-motorway-fill')?.maxzoom, 15);
});

test('generated semantic keys never collide with independent contributions', () => {
  const input: Layer[] = [
    {
      id: 'tileflow-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      metadata: semanticMetadata('land', 'land', 'land.landcover.grass.fill'),
      paint: {'fill-color': 'green'},
    },
    {
      id: 'tileflow-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'scrub'],
      metadata: semanticMetadata('land', 'land', 'land.landcover.scrub.fill'),
      paint: {'fill-color': 'olive'},
    },
    {
      id: 'tileflow-landcover',
      type: 'fill',
      source,
      'source-layer': 'custom',
      metadata: semanticMetadata('land', 'land', 'land.cohorts.landcover'),
      paint: {'fill-color': 'blue'},
    },
  ];
  const optimized = planTileflowLayers(input);
  assert.deepEqual(
    optimized.map((layer) => layer.id),
    input.map((layer) => layer.id),
  );
  assert.deepEqual(styleErrors(optimized), []);
});

test('typed green classes consolidate while the legacy park branch stays separate', () => {
  const greenFill = (
    name: 'meadow' | 'urbanPark',
    subclass: string,
    color: string,
    opacity: number,
  ): Layer => ({
    id: `physical-${name}`,
    type: 'fill',
    source,
    'source-layer': 'landcover',
    filter: ['==', ['get', 'subclass'], subclass],
    metadata: {
      [tileflowCompilerMetadataKeys.owner]: 'land',
      [tileflowCompilerMetadataKeys.slot]: 'land',
      [tileflowCompilerMetadataKeys.target]: `land.landcover.${name}.fill`,
    },
    paint: {'fill-color': color, 'fill-opacity': opacity},
  });
  const legacy: Layer = {
    id: 'tileflow-landcover-legacy-park',
    type: 'fill',
    source,
    'source-layer': 'park',
    filter: ['!=', ['get', 'class'], 'protected_area'],
    metadata: {
      [tileflowCompilerMetadataKeys.owner]: 'land',
      [tileflowCompilerMetadataKeys.slot]: 'land',
      [tileflowCompilerMetadataKeys.target]: 'land.compatibility.legacyPark.fill',
    },
    paint: {'fill-color': '#b3ebad', 'fill-opacity': 0.8},
  };
  const optimized = planTileflowLayers([
    greenFill('meadow', 'meadow', '#e3f4d2', 0.85),
    greenFill('urbanPark', 'park', '#b3ebad', 1),
    legacy,
  ]);

  assert.equal(optimized.length, 2);
  assert.equal(
    optimized.some(({id}) => id === legacy.id),
    true,
  );
  const merged = optimized.find(({id}) => id === 'tileflow-landcover');
  assert.ok(merged);
  for (const [subclass, color, opacity] of [
    ['meadow', 'rgba(227,244,210,1)', 0.85],
    ['park', 'rgba(179,235,173,1)', 1],
  ] as const) {
    assert.equal(
      String(
        evaluateProperty(
          (merged.paint as Record<string, unknown>)['fill-color'],
          mapLibreStyleSpec.paint_fill['fill-color'] as Record<string, unknown>,
          10,
          {subclass},
        ),
      ),
      color,
    );
    assert.equal(
      evaluateProperty(
        (merged.paint as Record<string, unknown>)['fill-opacity'],
        mapLibreStyleSpec.paint_fill['fill-opacity'] as Record<string, unknown>,
        10,
        {subclass},
      ),
      opacity,
    );
  }
  assert.deepEqual(styleErrors(optimized), []);
});

test('hatch consolidation uses typed defaults and refuses data-constant differences', () => {
  const hatch = (roadClass: 'motorway' | 'trunk', layout: Record<string, unknown>): Layer => ({
    id: `tileflow-road-tunnel-${roadClass}-hatch`,
    type: 'symbol',
    source,
    'source-layer': sourceLayer,
    filter: ['==', ['get', 'class'], roadClass],
    metadata: semanticMetadata(
      'roads',
      'transport-tunnel-fill',
      `roads.classes.${roadClass}.tunnel.hatch`,
    ),
    layout: {'symbol-placement': 'line', 'text-field': 'x', ...layout},
    paint: {'text-color': 'red'},
  });

  const withMissingRotate = planTileflowLayers([
    hatch('motorway', {'text-rotate': 30}),
    hatch('trunk', {}),
  ]);
  assert.equal(withMissingRotate.length, 1);
  assert.deepEqual(styleErrors(withMissingRotate), []);

  const differentSpacing = [
    hatch('motorway', {'symbol-spacing': 10}),
    hatch('trunk', {'symbol-spacing': 20}),
  ];
  assert.deepEqual(planTileflowLayers(differentSpacing), differentSpacing);
  assert.deepEqual(styleErrors(differentSpacing), []);
});

test('pattern hatches consolidate as clipped line decks', () => {
  const patternHatch = (roadClass: 'motorway' | 'trunk', width: number): Layer => ({
    id: `tileflow-road-tunnel-${roadClass}-hatch`,
    type: 'line',
    source,
    'source-layer': sourceLayer,
    minzoom: 17,
    filter: ['==', ['get', 'class'], roadClass],
    metadata: semanticMetadata(
      'roads',
      'transport-tunnel-fill',
      `roads.classes.${roadClass}.tunnel.hatch`,
    ),
    layout: {'line-cap': 'butt', 'line-join': 'round', 'line-sort-key': 0},
    paint: {
      'line-opacity': 0.58,
      'line-pattern': 'tunnel-hatch',
      'line-width': width,
    },
  });

  const optimized = planTileflowLayers([patternHatch('motorway', 18), patternHatch('trunk', 14)]);
  assert.equal(optimized.length, 1);
  assert.equal(optimized[0]?.id, 'tileflow-road-tunnel-hatch');
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
      id: 'tileflow-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      metadata: semanticMetadata('land', 'land', 'land.landcover.grass.fill'),
      paint: {'fill-color': 'green', 'fill-translate': [1, 2]},
    },
    {
      id: 'tileflow-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'scrub'],
      metadata: semanticMetadata('land', 'land', 'land.landcover.scrub.fill'),
      paint: {'fill-color': 'olive'},
    },
  ];
  assert.deepEqual(planTileflowLayers(input), input);
  assert.deepEqual(styleErrors(input), []);
});

test('overlapping fill filters use the last original layer for paint and sorting', () => {
  const input: Layer[] = [
    {
      id: 'tileflow-landcover-grass',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'grass'],
      metadata: semanticMetadata('land', 'land', 'land.landcover.grass.fill'),
      paint: {'fill-color': '#00ff00'},
    },
    {
      id: 'tileflow-landcover-scrub',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['all', ['==', ['get', 'class'], 'grass'], ['==', ['get', 'subclass'], 'scrub']],
      metadata: semanticMetadata('land', 'land', 'land.landcover.scrub.fill'),
      paint: {'fill-color': '#808000'},
    },
  ];
  const optimized = planTileflowLayers(input);
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
    target: 'water.intermittent.waterways.river' | 'water.waterways.river',
    layout: Record<string, unknown>,
    range: Record<string, unknown>,
  ): Layer => ({
    id,
    type: 'line',
    source,
    'source-layer': 'waterway',
    filter: ['literal', true],
    metadata: semanticMetadata('water', 'hydro', target),
    layout,
    paint: {'line-color': 'blue'},
    ...range,
  });
  for (const input of [
    [
      waterway(
        'tileflow-waterway-river',
        'water.waterways.river',
        {'line-cap': 'round'},
        {
          minzoom: 6,
        },
      ),
      waterway(
        'tileflow-waterway-river-intermittent',
        'water.intermittent.waterways.river',
        {'line-cap': 'butt'},
        {minzoom: 6},
      ),
    ],
    [
      waterway(
        'tileflow-waterway-river',
        'water.waterways.river',
        {},
        {
          minzoom: 6,
          maxzoom: 18,
        },
      ),
      waterway(
        'tileflow-waterway-river-intermittent',
        'water.intermittent.waterways.river',
        {},
        {
          minzoom: 8,
          maxzoom: 18,
        },
      ),
    ],
  ]) {
    assert.deepEqual(planTileflowLayers(input), input);
  }
});

test('waterway consolidation uses a solid dash fallback for regular lines', () => {
  const layers = planTileflowLayers([
    {
      id: 'tileflow-waterway-river',
      type: 'line',
      source: 'tileflow',
      'source-layer': 'waterway',
      minzoom: 6,
      filter: ['==', ['get', 'class'], 'river'],
      metadata: semanticMetadata('water', 'hydro', 'water.waterways.river'),
      paint: {'line-color': '#99ddff', 'line-width': 2},
    },
    {
      id: 'tileflow-waterway-river-intermittent',
      type: 'line',
      source: 'tileflow',
      'source-layer': 'waterway',
      minzoom: 6,
      filter: ['all', ['==', ['get', 'class'], 'river'], ['==', ['get', 'intermittent'], 1]],
      metadata: semanticMetadata('water', 'hydro', 'water.intermittent.waterways.river'),
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

test('zoom-dependent road selectors remain separate instead of entering paint expressions', () => {
  const input = (['motorway', 'trunk'] as const).map((roadClass) =>
    roadLayer(roadClass, roadClass === 'motorway' ? 8 : 6, {
      filter: [
        'all',
        ['==', ['get', 'class'], roadClass],
        ['step', ['zoom'], ['!=', ['get', 'ramp'], 1], 12, true],
      ],
      paint: {
        'line-color': roadClass === 'motorway' ? '#8899aa' : '#aabbcc',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 8],
      },
    }),
  );
  const planned = planTileflowLayers(input);
  assert.deepEqual(styleErrors(input), []);
  assert.deepEqual(styleErrors(planned), []);
  assert.deepEqual(planned, input);
});

test('multi-branch match filters retain every boolean branch', () => {
  const first = roadLayer('motorway', 5, {
    filter: ['match', ['get', 'class'], 'motorway', true, 'secondary', true, false],
  });
  const second = roadLayer('trunk', 2, {
    filter: ['match', ['get', 'class'], 'trunk', true, 'tertiary', true, false],
  });
  const optimized = planTileflowLayers([first, second]);
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
