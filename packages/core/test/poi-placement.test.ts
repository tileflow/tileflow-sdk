import {
  createPropertyExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, labels, poi, resolveTileflowData, zoom} from '../src';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {compilePoi} from '../src/modules/poi/compiler';
import {
  tileflowPoiFeatureVaryingProperties,
  tileflowPoiLayerPropertyDefaults,
  TileflowPoiPlacementError,
} from '../src/modules/poi/placement';
import {resolveColors} from '../src/themes';
import {assembleTileflowLayers} from './layer-ir-fixture';
import {extendStreets} from './map-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Bold'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

type Layer = TileflowLayerContribution['layer'];

function layerOf(contributions: readonly TileflowLayerContribution[], id: string): Layer {
  const layer = contributions.find((entry) => entry.layer.id === id)?.layer;
  assert.ok(layer, `Missing ${id}`);
  return layer;
}

function evaluate(
  layer: Layer,
  part: 'layout' | 'paint',
  property: string,
  zoomLevel: number,
  properties: Record<string, unknown>,
): unknown {
  const specification = latest[`${part}_symbol` as 'layout_symbol'][
    property as keyof (typeof latest)['layout_symbol']
  ] as never;
  const value = (layer[part] as Record<string, unknown>)[property];
  const parsed = createPropertyExpression(value, specification);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return (parsed.value as {evaluate: (...args: unknown[]) => unknown}).evaluate(
    {zoom: zoomLevel},
    {type: 1, properties},
  );
}

test('POI categories share one placement layer whose values match each category exactly', () => {
  const contributions = compilePoi(
    poi({
      categories: ['transport', 'food-drink', 'landmark'],
      color: 'category',
      icons: true,
      labels: true,
      placement: {coupleIconAndLabel: true},
      styles: {
        transport: {
          icon: {
            image: 'station',
            size: zoom.linear([
              [12, 0.8],
              [16, 1.2],
            ]),
          },
          text: {color: '#334499'},
        },
        'food-drink': {
          icon: {
            image: 'food',
            size: zoom.linear([
              [14, 1],
              [18, 1.4],
            ]),
          },
        },
        landmark: {icon: {image: 'monument', size: 1.1}},
      },
    }),
    context,
  );
  assert.deepEqual(
    contributions.map(({layer, target}) => `${layer.id}:${target}`),
    ['tileflow-poi:poi'],
  );
  const [{layer}] = contributions as [TileflowLayerContribution];
  const transport = {category: 'transport', filter_rank: 1, name: 'Sol', size_rank: 16};
  const food = {category: 'food-drink', filter_rank: 3, name: 'Café', size_rank: 16};
  const landmark = {category: 'landmark', filter_rank: 1, name: 'Arco', size_rank: 4};

  // Each category keeps its own curve: linear stops are evaluated at the union of all stops.
  for (const [zoomLevel, expected] of [
    [11, [0.8, 1, 1.1]],
    [13, [0.9, 1, 1.1]],
    [15, [1.1, 1.1, 1.1]],
    [17, [1.2, 1.3, 1.1]],
    [19, [1.2, 1.4, 1.1]],
  ] as const) {
    const actual = [transport, food, landmark].map(
      (properties) => evaluate(layer, 'layout', 'icon-size', zoomLevel, properties) as number,
    );
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-6));
  }
  assert.equal(
    evaluate(layer, 'paint', 'text-color', 15, transport)?.toString(),
    'rgba(51,68,153,1)',
  );
  for (const image of ['station', 'food', 'monument']) {
    assert.match(JSON.stringify(layer.layout?.['icon-image']), new RegExp(`"${image}"`, 'u'));
  }

  // One sort key orders every category: World's filter rank, then physical size.
  assert.deepEqual(layer.layout?.['symbol-sort-key'], [
    '+',
    ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
    ['to-number', ['get', 'size_rank'], 17],
  ]);
  assert.deepEqual(
    validateStyleMin({
      version: 8,
      glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://example.test/sprite',
      sources: {tileflow: {type: 'vector', url: 'https://example.test/tiles.json'}},
      layers: assembleTileflowLayers(contributions),
    } as never),
    [],
  );
});

test('exponential and step curves stay exact when categories are combined', () => {
  const [{layer}] = compilePoi(
    poi({
      categories: ['retail', 'lodging'],
      icons: false,
      labels: true,
      styles: {
        retail: {
          text: {
            size: zoom.exponential(1.5, [
              [12, 10],
              [18, 16],
            ]),
          },
        },
        lodging: {
          text: {
            size: zoom.exponential(1.5, [
              [14, 11],
              [16, 13],
            ]),
          },
        },
      },
    }),
    context,
  ) as [TileflowLayerContribution];
  const exponential = (stops: [number, number][], at: number) => {
    const [[z0, v0], [z1, v1]] = stops as [[number, number], [number, number]];
    if (at <= z0) return v0;
    if (at >= z1) return v1;
    return v0 + ((v1 - v0) * (1.5 ** (at - z0) - 1)) / (1.5 ** (z1 - z0) - 1);
  };
  for (const at of [12, 13, 14.5, 15, 16, 17.25, 18]) {
    const retail = evaluate(layer, 'layout', 'text-size', at, {category: 'retail'}) as number;
    const lodging = evaluate(layer, 'layout', 'text-size', at, {category: 'lodging'}) as number;
    assert.ok(
      Math.abs(
        retail -
          exponential(
            [
              [12, 10],
              [18, 16],
            ],
            at,
          ),
      ) < 1e-4,
      `retail z${at}`,
    );
    assert.ok(
      Math.abs(
        lodging -
          exponential(
            [
              [14, 11],
              [16, 13],
            ],
            at,
          ),
      ) < 1e-4,
      `lodging z${at}`,
    );
  }

  const [{layer: stepped}] = compilePoi(
    poi({
      categories: ['retail', 'lodging'],
      icons: false,
      labels: true,
      styles: {
        retail: {
          text: {
            letterSpacing: zoom.step([
              [0, 0],
              [15, 0.1],
            ]),
          },
        },
        lodging: {
          text: {
            letterSpacing: zoom.step([
              [0, 0.05],
              [17, 0.2],
            ]),
          },
        },
      },
    }),
    context,
  ) as [TileflowLayerContribution];
  for (const [at, retail, lodging] of [
    [14, 0, 0.05],
    [15, 0.1, 0.05],
    [17, 0.1, 0.2],
  ] as const) {
    assert.equal(
      evaluate(stepped, 'layout', 'text-letter-spacing', at, {category: 'retail'}),
      retail,
    );
    assert.equal(
      evaluate(stepped, 'layout', 'text-letter-spacing', at, {category: 'lodging'}),
      lodging,
    );
  }
});

test('layer-wide differences between categories are explicit errors', () => {
  const conflict = (styles: Parameters<typeof poi>[0]['styles']) =>
    assert.throws(
      () => compilePoi(poi({categories: ['retail', 'lodging'], styles}), context),
      (error: unknown) =>
        error instanceof TileflowPoiPlacementError &&
        error.code === 'TILEFLOW_POI_PLACEMENT_CONFLICT' &&
        /placement\.order/u.test(error.message),
    );
  conflict({retail: {text: {padding: 8}}});
  conflict({retail: {icon: {allowOverlap: true}}});
  conflict({retail: {text: {font: 'Noto Sans Bold'}}});
  conflict({
    retail: {
      icon: {
        size: zoom.step([
          [0, 1],
          [15, 1.2],
        ]),
      },
    },
    lodging: {
      icon: {
        size: zoom.linear([
          [12, 1],
          [16, 1.2],
        ]),
      },
    },
  });

  // An explicit MapLibre default agrees with a category that leaves the property unset.
  assert.doesNotThrow(() =>
    compilePoi(
      poi({categories: ['retail', 'lodging'], styles: {retail: {icon: {keepUpright: false}}}}),
      context,
    ),
  );
  // The same styles are valid with one layer per category.
  assert.doesNotThrow(() =>
    compilePoi(
      poi({
        categories: ['retail', 'lodging'],
        placement: {order: 'categories'},
        styles: {retail: {text: {padding: 8}}},
      }),
      context,
    ),
  );
});

test('a POI with a pictogram needs a name unless its type explains itself', () => {
  const [{layer}] = compilePoi(
    poi({
      categories: ['visitor-amenity', 'food-drink'],
      placement: {coupleIconAndLabel: true},
    }),
    context,
  ) as [TileflowLayerContribution];
  const filter = featureFilter(layer.filter as never);
  const shown = (properties: Record<string, unknown>) =>
    filter.filter({zoom: 17}, {
      type: 1,
      properties: {filter_rank: 2, size_rank: 16, ...properties},
    } as never);

  assert.equal(shown({category: 'food-drink', name: 'Café', type: 'cafe'}), true);
  assert.equal(shown({category: 'food-drink', type: 'cafe'}), false);
  assert.equal(shown({category: 'visitor-amenity', type: 'parking'}), true);
  assert.equal(shown({category: 'visitor-amenity', type: 'public_restroom'}), true);
  assert.equal(shown({category: 'visitor-amenity', type: 'atm'}), false);
  // A self-explanatory type is drawn as its pictogram alone, even when it has a name.
  assert.equal(
    evaluate(layer, 'layout', 'text-field', 17, {
      category: 'visitor-amenity',
      name: 'Parking Sol',
      type: 'parking',
    })?.toString(),
    '',
  );
  assert.equal(
    evaluate(layer, 'layout', 'text-field', 17, {
      category: 'food-drink',
      name: 'Café',
      type: 'cafe',
    })?.toString(),
    'Café',
  );

  // Without pictograms the name is all a label layer draws, so nothing is required of it.
  const [{layer: labelsOnly}] = compilePoi(
    poi({categories: ['visitor-amenity'], icons: false, labels: true}),
    context,
  ) as [TileflowLayerContribution];
  assert.doesNotMatch(JSON.stringify(labelsOnly.filter), /"parking"/u);

  // Maps choose their own self-explanatory types.
  const [{layer: custom}] = compilePoi(
    poi({
      categories: ['visitor-amenity'],
      placement: {coupleIconAndLabel: true, iconOnlyTypes: ['atm']},
    }),
    context,
  ) as [TileflowLayerContribution];
  const customFilter = featureFilter(custom.filter as never);
  assert.equal(
    customFilter.filter({zoom: 17}, {
      type: 1,
      properties: {category: 'visitor-amenity', filter_rank: 2, size_rank: 16, type: 'atm'},
    } as never),
    true,
  );
});

test('the prominent tier places the most important ranks before road and place labels', () => {
  const contributions = compilePoi(
    poi({
      categories: ['landmark', 'retail'],
      density: 3,
      placement: {coupleIconAndLabel: true, prominentRank: 1},
    }),
    context,
  );
  assert.deepEqual(
    contributions.map(({layer, target}) => `${layer.id}:${target}`),
    ['tileflow-poi:poi', 'tileflow-poi-prominent:poi.prominent'],
  );
  const [ordinary, prominent] = contributions as [
    TileflowLayerContribution,
    TileflowLayerContribution,
  ];
  const ranks = (layer: Layer) => {
    const filter = featureFilter(layer.filter as never);
    return [0, 1, 2, 3].filter((rank) =>
      filter.filter({zoom: 15}, {
        type: 1,
        properties: {category: 'landmark', filter_rank: rank, name: 'Arco', size_rank: 4},
      } as never),
    );
  };
  assert.deepEqual(ranks(prominent.layer), [0, 1]);
  assert.deepEqual(ranks(ordinary.layer), [2, 3]);

  const style = createStyle(
    extendStreets({
      modules: {
        labels: labels({collisionPriority: 'navigation', places: 'all', roads: 'all'}),
        poi: poi({
          categories: ['landmark', 'retail'],
          density: 3,
          placement: {coupleIconAndLabel: true, prominentRank: 1},
        }),
      },
    }),
    {preparedAssets: {icons: {ids: ['culture', 'shopping'], sprite: '/tileflow/test/sprite'}}},
  );
  const ids = style.layers.map(({id}) => id);
  const index = (id: string) => ids.indexOf(id);
  // MapLibre places the topmost layer first: prominent POIs, then labels, then other POIs.
  assert.ok(index('tileflow-poi-prominent') > index('tileflow-label-place-city'));
  assert.ok(index('tileflow-poi-prominent') > index('tileflow-label-road-major'));
  assert.ok(index('tileflow-poi') < index('tileflow-label-road-local'));
});

test('category order places the first category listed first', () => {
  const contributions = compilePoi(
    poi({
      categories: ['transport', 'food-drink'],
      placement: {coupleIconAndLabel: true, order: 'categories'},
    }),
    context,
  );
  const transport = contributions.find(({target}) => target === 'poi.transport')!;
  const food = contributions.find(({target}) => target === 'poi.food-drink')!;
  assert.equal(transport.layer.id, 'tileflow-poi-transport');
  assert.ok(transport.localOrder > food.localOrder);
});

test('the feature-varying property table matches the MapLibre style specification', () => {
  for (const kind of ['symbol', 'circle'] as const) {
    const specification = {...latest[`layout_${kind}`], ...latest[`paint_${kind}`]} as Record<
      string,
      {'property-type': string; default?: unknown}
    >;
    for (const [property, fallback] of Object.entries(tileflowPoiFeatureVaryingProperties[kind])) {
      assert.ok(specification[property], `${property} is a MapLibre ${kind} property`);
      assert.equal(specification[property]!['property-type'], 'data-driven', property);
      if (property !== 'icon-image') {
        assert.deepEqual(fallback, specification[property]!.default, property);
      }
    }
  }
  const specification = {
    ...latest.layout_symbol,
    ...latest.paint_symbol,
    ...latest.layout_circle,
    ...latest.paint_circle,
  } as Record<string, {'property-type': string; default?: unknown}>;
  for (const [property, fallback] of Object.entries(tileflowPoiLayerPropertyDefaults)) {
    assert.notEqual(specification[property]!['property-type'], 'data-driven', property);
    assert.deepEqual(fallback, specification[property]!.default, property);
  }
});

test('category density changes eligibility without replacing cross-category importance order', () => {
  const build = (overrides = {}) =>
    compilePoi(
      poi({
        categories: ['food-drink', 'landmark', 'lodging'],
        density: 2,
        ...overrides,
      }),
      context,
    )[0]!.layer;
  const uniform = build();
  const varied = build({densityByCategory: {landmark: 3, lodging: 1}});
  const accepts = (layer: Layer, category: string, rank: number, zoom: number) =>
    featureFilter(layer.filter as never).filter(
      {zoom},
      {type: 1, properties: {category, filter_rank: rank, size_rank: 16, name: 'Place'}},
    );
  for (const zoom of [15, 16, 17, 20]) {
    const increment = zoom >= 17 ? 2 : zoom >= 16 ? 1 : 0;
    for (const [category, density] of [
      ['food-drink', 2],
      ['landmark', 3],
      ['lodging', 1],
    ] as const) {
      for (const rank of [0, 1, 2, 3, 4, 5]) {
        assert.equal(accepts(uniform, category, rank, zoom), rank <= 2 + increment);
        assert.equal(accepts(varied, category, rank, zoom), rank <= density + increment);
      }
    }
  }
  assert.deepEqual(varied.layout?.['symbol-sort-key'], uniform.layout?.['symbol-sort-key']);
  assert.equal(uniform.metadata?.['tileflow:label-perspective'], undefined);
  assert.equal(varied.metadata?.['tileflow:label-perspective'], undefined);
});

test('detail zoom can defer the last rank expansion without changing the default', () => {
  const build = (detailZoom?: number) =>
    compilePoi(poi({categories: ['food-drink'], density: 2, detailZoom}), context)[0]!.layer;
  const feature = {
    type: 1,
    properties: {category: 'food-drink', filter_rank: 4, size_rank: 16, name: 'Cafe'},
  };
  const regular = featureFilter(build().filter as never).filter;
  const delayed = featureFilter(build(18).filter as never).filter;
  assert.equal(regular({zoom: 17}, feature), true);
  assert.equal(delayed({zoom: 17.99}, feature), false);
  assert.equal(delayed({zoom: 18}, feature), true);
});
