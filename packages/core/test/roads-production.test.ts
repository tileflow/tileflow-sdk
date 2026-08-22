import {
  createPropertyExpression,
  featureFilter,
  latest as mapLibreStyleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {openMapTiles, resolveTileflowData, roads} from '../src';
import {optimizeTileflowLayers} from '../src/cartography/optimizer';
import {roadClassesForDetail} from '../src/modules/roads';
import {compileRoads} from '../src/modules/roads/compiler';
import {tileflowRoadClassFilter} from '../src/modules/roads/semantics';
import {resolveColors} from '../src/themes';

type Layer = Record<string, unknown> & {id: string; type: string};

const source = 'tileflow';
const sourceLayer = 'transportation';
const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  typography: {
    font: 'Noto Sans',
    fontFamily: 'Noto Sans',
    weight: 'regular' as const,
    places: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'bold' as const},
    roads: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    water: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    poi: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
  },
};

function matchesFilter(
  filter: unknown,
  properties: Record<string, unknown>,
  geometryType: 'LineString' | 'Polygon' = 'LineString',
): boolean {
  const compiled = featureFilter(filter as never);
  return compiled.filter({zoom: 16}, {
    type: geometryType === 'LineString' ? 2 : 3,
    properties,
  } as never);
}

function evaluateProperty(
  value: unknown,
  specification: Record<string, unknown>,
  properties: Record<string, unknown>,
): unknown {
  const parsed = createPropertyExpression(value, specification as never);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error('Expression did not parse.');
  return parsed.value.evaluate(
    {zoom: 18},
    {
      type: 'Feature',
      properties,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    } as never,
    {},
  );
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

test('the streets detail preset includes service roads without enabling tracks', () => {
  assert.deepEqual(roadClassesForDetail('streets'), [
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'minor',
    'service',
  ]);

  const ids = compileRoads(roads(), context).map(({layer}) => layer.id);
  assert.ok(ids.includes('streets-road-surface-service-fill'));
  assert.equal(ids.includes('streets-road-surface-track-fill'), false);
});

test('road treatments materialize absent phases only for matching features with paint defaults', () => {
  const contributions = compileRoads(
    roads({
      classes: {service: {}},
      detail: 'none',
      modifiers: {
        official: {
          surface: {
            casing: {color: '#345678'},
            shadow: {color: '#123456'},
          },
        },
      },
      outline: 'none',
      restrictions: {toll: {surface: {shadow: {width: 4}}}},
    }),
    context,
  );
  const casing = contributions.find(
    ({layer}) => layer.id === 'streets-road-surface-service-casing',
  )?.layer;
  const shadow = contributions.find(
    ({layer}) => layer.id === 'streets-road-surface-service-shadow',
  )?.layer;

  assert.ok(casing, 'a treatment must be able to create a casing when outline is none');
  assert.ok(shadow, 'a treatment must be able to create a shadow');
  assert.equal(matchesFilter(casing.filter, {class: 'service', official: 1}), true);
  assert.equal(matchesFilter(casing.filter, {class: 'service', official: 0}), false);
  assert.equal(matchesFilter(shadow.filter, {class: 'service', official: 1, toll: 0}), true);
  assert.equal(matchesFilter(shadow.filter, {class: 'service', official: 0, toll: 1}), true);
  assert.equal(matchesFilter(shadow.filter, {class: 'service', official: 0, toll: 0}), false);

  const paint = shadow.paint as Record<string, unknown>;
  assert.deepEqual(paint['line-color'], [
    'case',
    ['==', ['get', 'official'], 1],
    '#123456',
    '#000000',
  ]);
  assert.deepEqual(paint['line-width'], ['case', ['==', ['get', 'toll'], 1], 4, 1]);
});

test('visible false remains authoritative when a treatment targets the same road phase', () => {
  const contributions = compileRoads(
    roads({
      classes: {service: {}},
      detail: 'none',
      modifiers: {
        official: {
          surface: {
            fill: {color: '#123456'},
            shadow: {color: '#123456'},
          },
        },
      },
      structures: {
        surface: {
          fill: {visible: false},
          shadow: {visible: false},
        },
      },
    }),
    context,
  );
  const ids = contributions.map(({layer}) => layer.id);

  assert.equal(ids.includes('streets-road-surface-service-fill'), false);
  assert.equal(ids.includes('streets-road-surface-service-shadow'), false);
});

test('official OpenMapTiles road values map to disjoint existing semantics and ford stays surface', () => {
  const fields = {class: 'kind', subclass: 'kind_detail'};
  const serviceFilter = tileflowRoadClassFilter(fields, 'service');
  const trackFilter = tileflowRoadClassFilter(fields, 'track');

  for (const kind of ['busway', 'bus_guideway']) {
    assert.equal(matchesFilter(serviceFilter, {kind}), true, `${kind} must map to service`);
    assert.equal(matchesFilter(trackFilter, {kind}), false, `${kind} must remain disjoint`);
  }
  for (const kind of ['raceway', 'raceway_construction']) {
    assert.equal(matchesFilter(trackFilter, {kind}), true, `${kind} must map to track`);
    assert.equal(matchesFilter(serviceFilter, {kind}), false, `${kind} must remain disjoint`);
  }

  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    schema: openMapTiles({fields: {brunnel: 'crossing_kind', class: 'kind'}}),
    url: '/tiles.json',
  });
  const contributions = compileRoads(roads({classes: {service: {}, track: {}}, detail: 'none'}), {
    ...context,
    data,
  });
  const serviceSurface = contributions.find(
    ({layer}) => layer.id === 'streets-road-surface-service-fill',
  )?.layer;
  const serviceTunnel = contributions.find(
    ({layer}) => layer.id === 'streets-road-tunnel-service-fill',
  )?.layer;

  assert.ok(serviceSurface);
  assert.ok(serviceTunnel);
  assert.equal(matchesFilter(serviceSurface.filter, {crossing_kind: 'ford', kind: 'busway'}), true);
  assert.equal(matchesFilter(serviceTunnel.filter, {crossing_kind: 'ford', kind: 'busway'}), false);
});

test('hatch consolidation encodes original class crossing priority in valid sort keys', () => {
  for (const type of ['line', 'symbol'] as const) {
    const sortKeyProperty = type === 'line' ? 'line-sort-key' : 'symbol-sort-key';
    const hatch = (roadClass: 'track' | 'service'): Layer => ({
      id: `streets-road-surface-${roadClass}-hatch`,
      type,
      source,
      'source-layer': sourceLayer,
      filter: ['==', ['get', 'class'], roadClass],
      layout:
        type === 'line'
          ? {
              'line-cap': 'butt',
              'line-join': 'round',
              'line-sort-key': ['coalesce', ['get', 'layer'], 0],
            }
          : {
              'symbol-placement': 'line',
              'symbol-sort-key': ['coalesce', ['get', 'layer'], 0],
              'text-allow-overlap': true,
              'text-field': '|',
              'text-ignore-placement': true,
              'text-size': 12,
            },
      paint:
        type === 'line' ? {'line-color': '#123456', 'line-width': 2} : {'text-color': '#123456'},
    });
    const optimized = optimizeTileflowLayers([hatch('track'), hatch('service')]);

    assert.equal(optimized.length, 1);
    assert.deepEqual(styleErrors(optimized), []);
    const sortKey = (optimized[0]?.layout as Record<string, unknown>)[sortKeyProperty];
    const specification =
      type === 'line'
        ? mapLibreStyleSpec.layout_line['line-sort-key']
        : mapLibreStyleSpec.layout_symbol['symbol-sort-key'];
    const lowerClassAtHighLayer = evaluateProperty(sortKey, specification, {
      class: 'track',
      layer: 10_000,
    });
    const higherClassAtLowLayer = evaluateProperty(sortKey, specification, {
      class: 'service',
      layer: -10_000,
    });

    assert.ok(
      Number(lowerClassAtHighLayer) < Number(higherClassAtLowLayer),
      `${sortKeyProperty} must keep the later service hatch above track at crossings`,
    );
  }
});
