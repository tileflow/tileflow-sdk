import {
  createPropertyExpression,
  featureFilter,
  latest as mapLibreStyleSpec,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {openMapTiles, resolveTileflowData, roads, vectorTiles, zoom} from '../src';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {createTileflowLayerFamilyIR, lowerTileflowDomainIR} from '../src/cartography/domain-ir';
import {assembleTileflowLayerFamilies} from '../src/cartography/graph';
import {planTileflowLayerFamilies} from '../src/cartography/physical-planner';
import {expression} from '../src/cartography/values';
import {roadClassesForDetail} from '../src/modules/roads';
import {compileRoads} from '../src/modules/roads/compiler';
import {compilePathGroundFamilies} from '../src/modules/roads/path-ground';
import {tileflowRoadClassFilter} from '../src/modules/roads/semantics';
import {resolveColors} from '../src/themes';
import {assembleTileflowLayers, planTileflowLayers} from './layer-ir-fixture';

type Layer = Record<string, unknown> & {id: string; type: string};

const source = 'tileflow';
const sourceLayer = 'transportation';
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

test('green path overlays lower to distinct physical layers beside their ground paths', () => {
  const contributions = compileRoads(
    roads({
      detail: 'none',
      classes: {
        cycleway: {surface: {shadow: {color: '#888888', width: 2}}},
        footway: {},
      },
    }),
    context,
  );
  const result = compilePathGroundFamilies(contributions.map(createTileflowLayerFamilyIR), {
    greenColor: '#98bca0',
    groundColor: '#f5f3f3',
    opacity: 1,
    widthScale: 0.92,
  });
  assert.equal(result.active, true);
  const {layers} = lowerTileflowDomainIR(planTileflowLayerFamilies(result.families), context.data);
  const overlays = layers.filter((layer) => layer.source === 'tileflow-path-ground');
  assert.ok(
    overlays.some((layer) => layer.id === 'tileflow-road-surface-cycleway-shadow-on-green'),
  );
  assert.ok(overlays.some((layer) => layer.id === 'tileflow-road-surface-footway-fill-on-green'));
  assert.equal(new Set(layers.map((layer) => layer.id)).size, layers.length);
  for (const overlay of overlays) {
    const base = layers.find((layer) => layer.id === overlay.id.replace(/-on-green$/, ''));
    assert.ok(base);
    assert.equal(base.source, 'tileflow');
    assert.deepEqual(overlay.filter, base.filter);
  }
});

function matchesFilter(
  filter: unknown,
  properties: Record<string, unknown>,
  geometryType: 'LineString' | 'Point' | 'Polygon' = 'LineString',
): boolean {
  const compiled = featureFilter(filter as never);
  return compiled.filter({zoom: 16}, {
    type: geometryType === 'Point' ? 1 : geometryType === 'LineString' ? 2 : 3,
    properties,
  } as never);
}

function evaluateProperty(
  value: unknown,
  specification: Record<string, unknown>,
  properties: Record<string, unknown>,
  zoomLevel = 18,
): unknown {
  const parsed = createPropertyExpression(value, specification as never);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  if (parsed.result !== 'success') throw new Error('Expression did not parse.');
  return parsed.value.evaluate(
    {zoom: zoomLevel},
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

test('width treatments keep hollow road casings aligned with their fill at fractional zooms', () => {
  const width = zoom.exponential(1.5, [
    [12, 3],
    [18, 30],
    [22, 300],
  ]);
  const structure = {casing: {gapWidth: width, width: 1}, fill: {width}};
  const layers = compileRoads(
    roads({
      detail: 'none',
      classes: {primary: {surface: structure, bridge: structure, tunnel: structure}},
      modifiers: {expressway: {widthScale: 1.06}, ramp: {widthScale: 0.7}},
    }),
    context,
  ).map(({layer}) => layer);
  assert.deepEqual(styleErrors(layers), []);
  for (const kind of ['surface', 'bridge', 'tunnel']) {
    const fill = layers.find(({id}) => id === `tileflow-road-${kind}-primary-fill`)!;
    const casing = layers.find(({id}) => id === `tileflow-road-${kind}-primary-casing`)!;
    for (const properties of [{}, {expressway: 1}, {ramp: 1}]) {
      for (const zoomLevel of [12, 15.25, 17.97, 18.1, 20.5, 22]) {
        const evaluate = (layer: typeof fill, property: 'line-width' | 'line-gap-width') =>
          evaluateProperty(
            (layer.paint as Record<string, unknown>)[property],
            mapLibreStyleSpec.paint_line[property],
            properties,
            zoomLevel,
          );
        assert.equal(
          evaluate(casing, 'line-gap-width'),
          evaluate(fill, 'line-width'),
          `${kind} casing must track its fill at z${zoomLevel}: ${JSON.stringify(properties)}`,
        );
      }
    }
  }
});

test('solid road treatments avoid the dash shader while preserving real dash patterns', () => {
  for (const dash of [
    [1, 0],
    [2, 1],
  ] as const) {
    const layers = compileRoads(
      roads({
        detail: 'none',
        classes: {
          primary: {
            surface: {casing: {gapWidth: 20, width: 1}},
            tunnel: {casing: {dash: [3, 3], gapWidth: 20, width: 1}},
          },
        },
        modifiers: {indoor: {surface: {casing: {dash, opacity: 0.8}}}},
      }),
      context,
    ).map(({layer}) => layer);
    assert.deepEqual(styleErrors(layers), []);
    const paint = layers.find(({id}) => id === 'tileflow-road-surface-primary-casing')!
      .paint as Record<string, unknown>;
    if (dash[1] === 0) {
      assert.equal(paint['line-dasharray'], undefined);
    } else {
      assert.deepEqual(
        evaluateProperty(paint['line-dasharray'], mapLibreStyleSpec.paint_line['line-dasharray'], {
          indoor: 1,
        }),
        dash,
      );
    }
    assert.equal(
      evaluateProperty(paint['line-opacity'], mapLibreStyleSpec.paint_line['line-opacity'], {
        indoor: 1,
      }),
      0.8,
    );
    const tunnel = layers.find(({id}) => id === 'tileflow-road-tunnel-primary-casing')!;
    assert.deepEqual((tunnel.paint as Record<string, unknown>)['line-dasharray'], [3, 3]);
  }
});

/** A zoom curve inside the `let` bindings that name what it repeats. */
function curveOf(value: unknown): unknown[] {
  let curve = value as unknown[];
  while (curve[0] === 'let') curve = curve.at(-1) as unknown[];
  return curve;
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
  assert.ok(ids.includes('tileflow-road-surface-service-fill'));
  assert.equal(ids.includes('tileflow-road-surface-track-fill'), false);
});

test('road treatments materialize absent phases with theme-derived semantic paint defaults', () => {
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
    ({layer}) => layer.id === 'tileflow-road-surface-service-casing',
  )?.layer;
  const shadow = contributions.find(
    ({layer}) => layer.id === 'tileflow-road-surface-service-shadow',
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
    context.colors.roads.casing,
  ]);
  assert.deepEqual(paint['line-width'], ['case', ['==', ['get', 'toll'], 1], 4, 1]);
  assert.equal(paint['line-opacity'], 0.24);
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

  assert.equal(ids.includes('tileflow-road-surface-service-fill'), false);
  assert.equal(ids.includes('tileflow-road-surface-service-shadow'), false);
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
    ({layer}) => layer.id === 'tileflow-road-surface-service-fill',
  )?.layer;
  const serviceTunnel = contributions.find(
    ({layer}) => layer.id === 'tileflow-road-tunnel-service-fill',
  )?.layer;

  assert.ok(serviceSurface);
  assert.ok(serviceTunnel);
  assert.equal(matchesFilter(serviceSurface.filter, {crossing_kind: 'ford', kind: 'busway'}), true);
  assert.equal(matchesFilter(serviceTunnel.filter, {crossing_kind: 'ford', kind: 'busway'}), false);
});

test('sidewalks take the pedestrian area colour, opaque, unless their surface is configured', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    schema: openMapTiles({layers: {sidewalk: 'pedestrian_surfaces'}}),
    url: '/tiles.json',
  });
  const surfacePaint = (config: Parameters<typeof roads>[0]) =>
    compileRoads(roads(config), {...context, data}).find(
      ({layer}) => layer.id === 'tileflow-sidewalk-surface',
    )!.layer.paint as Record<string, unknown>;

  const plain = surfacePaint({detail: 'none'});
  assert.equal(plain['fill-color'], context.colors.road);
  assert.equal(plain['fill-opacity'], 1);

  const plaza = surfacePaint({detail: 'none', areas: {pedestrian: {fill: {color: '#c0ffee'}}}});
  assert.equal(plaza['fill-color'], '#c0ffee');

  const configured = surfacePaint({
    detail: 'none',
    areas: {pedestrian: {fill: {color: '#c0ffee'}}},
    sidewalks: {surface: {color: '#234567', opacity: 0.5}},
  });
  assert.equal(configured['fill-color'], '#234567');
  assert.equal(configured['fill-opacity'], 0.5);
});

test('detailed road extensions compile through remappable semantic contracts', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    schema: openMapTiles({
      fields: {
        circularInnerRadiusMeters: 'ring_inner_m',
        circularKind: 'ring_kind',
        circularOuterRadiusMeters: 'ring_outer_m',
        circularRadiusAtZoom15: 'ring_radius_z15',
        circularRadiusMeters: 'ring_radius_m',
        class: 'kind',
        crossing: 'crossing_status',
        direction: 'bearing',
        markings: 'crossing_markings',
        subclass: 'detail',
      },
      layers: {
        circularFeature: 'road_circles',
        sidewalk: 'pedestrian_surfaces',
        streetFurniture: 'road_furniture',
      },
    }),
    url: '/tiles.json',
  });
  const contributions = compileRoads(
    roads({
      crossings: {image: 'crosswalk'},
      detail: 'all',
      roundabouts: {fill: {strokeColor: '#123456'}},
      sidewalks: {
        outline: {color: '#345678', width: 1},
        pattern: {pattern: 'sidewalk-dot'},
        surface: {color: '#234567'},
      },
    }),
    {...context, data},
  );
  const byId = (id: string) => contributions.find(({layer}) => layer.id === id)!;
  const sidewalkSurface = byId('tileflow-sidewalk-surface');
  const sidewalkPattern = byId('tileflow-sidewalk-pattern');
  const sidewalkOutline = byId('tileflow-sidewalk-outline');
  const roundaboutCasing = byId('tileflow-road-circular-casing');
  const roundaboutFill = byId('tileflow-road-circular-fill');
  const crossing = byId('tileflow-road-crossing');

  assert.equal(sidewalkSurface.layer['source-layer'], 'pedestrian_surfaces');
  assert.equal(sidewalkSurface.slot, 'transport-pedestrian-areas');
  assert.match(JSON.stringify(sidewalkSurface.layer.filter), /kind/);
  assert.equal((sidewalkSurface.layer.paint as Record<string, unknown>)['fill-color'], '#234567');
  assert.equal(
    (sidewalkPattern.layer.paint as Record<string, unknown>)['fill-pattern'],
    'sidewalk-dot',
  );
  assert.equal((sidewalkOutline.layer.paint as Record<string, unknown>)['line-color'], '#345678');
  assert.equal(roundaboutCasing.layer['source-layer'], 'road_circles');
  assert.match(JSON.stringify(roundaboutCasing.layer), /ring_radius_z15/);
  assert.match(JSON.stringify(roundaboutCasing.layer), /ring_inner_m/);
  assert.equal(
    (roundaboutFill.layer.paint as Record<string, unknown>)['circle-stroke-color'],
    '#123456',
  );
  assert.equal(crossing.layer['source-layer'], 'road_furniture');
  assert.equal(crossing.layer.minzoom, 15);
  assert.match(JSON.stringify(crossing.layer.filter), /detail/);
  assert.match(JSON.stringify(crossing.layer.filter), /crossing_status/);
  assert.match(JSON.stringify(crossing.layer.filter), /crossing_markings/);
  assert.match(JSON.stringify(crossing.layer.layout), /bearing/);
  assert.equal(
    matchesFilter(
      crossing.layer.filter,
      {
        bearing: 134.3,
        crossing_markings: 'zebra',
        crossing_status: 'uncontrolled',
        detail: 'crossing',
      },
      'Point',
    ),
    true,
  );
  assert.equal(
    matchesFilter(
      crossing.layer.filter,
      {bearing: 134.3, crossing_markings: 'no', crossing_status: 'no', detail: 'crossing'},
      'Point',
    ),
    false,
  );
  assert.equal(
    matchesFilter(
      crossing.layer.filter,
      {bearing: 134.3, crossing_status: 'uncontrolled', detail: 'crossing'},
      'Point',
    ),
    false,
  );
  assert.equal((crossing.layer.layout as Record<string, unknown>)['icon-image'], 'crosswalk');
  assert.deepEqual((crossing.layer.paint as Record<string, unknown>)['icon-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0,
    15.5,
    1,
  ]);
  assert.deepEqual(styleErrors(assembleTileflowLayers(contributions)), []);

  const portableData = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    schema: openMapTiles(),
    url: '/tiles.json',
  });
  const portableIds = compileRoads(roads({crossings: {image: 'crosswalk'}, detail: 'none'}), {
    ...context,
    data: portableData,
  }).map(({layer}) => layer.id);
  assert.equal(portableIds.includes('tileflow-sidewalk-surface'), false);
  assert.equal(portableIds.includes('tileflow-road-circular-fill'), false);
  assert.equal(portableIds.includes('tileflow-road-crossing'), false);
});

test('crossings hide unresolved footway points and preserve valid road bearings across schemas', () => {
  const remapped = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    schema: openMapTiles({
      fields: {crossing: 'control', direction: 'bearing', markings: 'paint', subclass: 'kind'},
      layers: {streetFurniture: 'furniture'},
    }),
    url: '/tiles.json',
  });
  for (const data of [context.data, remapped]) {
    const {fields} = data.schema;
    const contributions = compileRoads(roads({crossings: {image: 'crosswalk'}}), {
      ...context,
      data,
    });
    const layer = contributions.find(({layer}) => layer.id === 'tileflow-road-crossing')!.layer;
    // Avenue Joseph Bouvard: adjoining footway nodes carry these markings but
    // no direction; the actual minor-road crossing also carries direction=134.3.
    const footway = {
      [fields.subclass]: 'crossing',
      [fields.crossing]: 'uncontrolled',
      [fields.markings]: 'zebra',
    };
    assert.equal(matchesFilter(layer.filter, footway, 'Point'), false);
    for (const direction of [null, '', 'unknown', 'north', true, false, -1, 361, '-1', '361']) {
      assert.equal(
        matchesFilter(layer.filter, {...footway, [fields.direction]: direction}, 'Point'),
        false,
        `invalid direction ${JSON.stringify(direction)}`,
      );
    }
    for (const direction of [0, 90, 134.3, 360, '0', '134.3', '360']) {
      const road = {...footway, [fields.direction]: direction};
      assert.equal(matchesFilter(layer.filter, road, 'Point'), true);
      assert.equal(
        evaluateProperty(
          (layer.layout as Record<string, unknown>)['icon-rotate'],
          mapLibreStyleSpec.layout_symbol['icon-rotate'],
          road,
        ),
        Number(direction) + 90,
      );
      assert.equal(matchesFilter(layer.filter, {...road, [fields.crossing]: 'no'}, 'Point'), false);
      for (const markings of ['no', 'none', 'unmarked']) {
        assert.equal(
          matchesFilter(layer.filter, {...road, [fields.markings]: markings}, 'Point'),
          false,
        );
      }
    }
    assert.deepEqual(styleErrors(assembleTileflowLayers(contributions)), []);
  }
});

test('metric roundabouts stay anchored to geographic distances at fractional and maximum zooms', () => {
  const layers = assembleTileflowLayers(
    compileRoads(roads({detail: 'all', roundabouts: {borderWidth: 1}}), context),
  );
  const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
  const casing = layers.find(({id}) => id === 'tileflow-road-circular-casing')!;
  const properties = {
    class: 'minor',
    radius_px_z15: 10.458,
    radius_m: 18.9,
    inner_radius_m: 16.2,
    outer_radius_m: 21,
  };
  const evaluate = (layer: Layer, property: 'circle-radius' | 'circle-stroke-width', z: number) =>
    evaluateProperty(
      (layer.paint as Record<string, unknown>)[property],
      mapLibreStyleSpec.paint_circle[property],
      properties,
      z,
    ) as number;
  for (let z = 15; z <= 24; z += 0.25) {
    const pixelsPerMeter = (properties.radius_px_z15 * 2 ** (z - 15)) / properties.radius_m;
    const inner = properties.inner_radius_m * pixelsPerMeter;
    const outer = properties.outer_radius_m * pixelsPerMeter;
    for (const [layer, border] of [
      [fill, 0],
      [casing, 0.5],
    ] as const) {
      const radius = evaluate(layer, 'circle-radius', z);
      const width = evaluate(layer, 'circle-stroke-width', z);
      assert.ok(Math.abs(radius - (inner - border)) < 1e-8, `${layer.id} inner edge at z${z}`);
      assert.ok(
        Math.abs(radius + width - (outer + border)) < 1e-8,
        `${layer.id} outer edge at z${z}`,
      );
    }
  }

  for (const layer of layers) {
    if (layer.id.startsWith('tileflow-road-surface-') && layer.id.endsWith('-fill')) {
      assert.ok(layers.indexOf(casing) < layers.indexOf(layer), 'Approaches cover the ring casing');
    }
    if (layer.id.startsWith('tileflow-road-bridge-')) {
      assert.ok(layers.indexOf(fill) < layers.indexOf(layer), 'Bridges remain above surface rings');
    }
  }
  assert.deepEqual(styleErrors(layers), []);
});

test('hatch consolidation encodes original class crossing priority in valid sort keys', () => {
  for (const type of ['line', 'symbol'] as const) {
    const sortKeyProperty = type === 'line' ? 'line-sort-key' : 'symbol-sort-key';
    const hatch = (roadClass: 'track' | 'service'): Layer => ({
      id: `tileflow-road-surface-${roadClass}-hatch`,
      type,
      source,
      'source-layer': sourceLayer,
      filter: ['==', ['get', 'class'], roadClass],
      metadata: {
        [tileflowCompilerMetadataKeys.owner]: 'roads',
        [tileflowCompilerMetadataKeys.slot]: 'transport-surface-fill',
        [tileflowCompilerMetadataKeys.target]: `roads.classes.${roadClass}.surface.hatch`,
      },
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
    const optimized = planTileflowLayers([hatch('track'), hatch('service')]);

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

test('roundabout fallbacks follow resolved road widths and hollow borders', () => {
  for (const width of [4, 18]) {
    const layers = compileRoads(
      roads({
        detail: 'none',
        classes: {
          minor: {
            surface: {
              fill: {width, color: '#123456', opacity: 0.6},
              casing: {gapWidth: width, width: 2, opacity: 0.4},
            },
          },
        },
      }),
      context,
    ).map(({layer}) => layer);
    const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
    const casing = layers.find(({id}) => id === 'tileflow-road-circular-casing')!;
    for (const level of [15, 15.25, 17.75, 22, 24]) {
      const properties = {class: 'minor', radius_px_z15: 20};
      const value = (layer: Layer, property: keyof typeof mapLibreStyleSpec.paint_circle) =>
        evaluateProperty(
          (layer.paint as Record<string, unknown>)[property],
          mapLibreStyleSpec.paint_circle[property],
          properties,
          level,
        ) as number;
      assert.equal(value(fill, 'circle-stroke-width'), width);
      assert.equal(value(casing, 'circle-stroke-width'), width + 4);
      assert.ok(
        Math.abs(value(fill, 'circle-radius') - (20 * 2 ** (level - 15) - width / 2)) < 1e-8,
      );
      assert.equal(value(fill, 'circle-stroke-opacity'), 1);
      assert.equal(value(casing, 'circle-stroke-opacity'), 1);
    }
    assert.ok(
      JSON.stringify((fill.paint as Record<string, unknown>)['circle-stroke-color']).includes(
        context.colors.roads.minor,
      ),
    );
    assert.deepEqual(styleErrors(layers), []);
  }
});

test('a dash for other road classes, or a solid one, leaves a road on the solid-line shader', () => {
  const layers = compileRoads(
    roads({
      detail: 'all',
      extras: {paths: true},
      classes: {motorway: {tunnel: {fill: {dash: [1, 0]}}}},
      modifiers: {
        construction: {
          surface: {
            fill: {
              dash: expression<readonly number[]>([
                'case',
                ['==', ['get', 'class'], 'path_construction'],
                ['literal', [1.5, 1]],
                ['literal', [1, 0]],
              ]),
            },
          },
        },
      },
    }),
    context,
  ).map(({layer}) => layer);
  const paintOf = (id: string) =>
    layers.find((layer) => layer.id === id)!.paint as Record<string, unknown>;
  assert.equal(paintOf('tileflow-road-surface-motorway-fill')['line-dasharray'], undefined);
  assert.equal(paintOf('tileflow-road-tunnel-motorway-fill')['line-dasharray'], undefined);
  // Construction paths are footways' own class: their layer keeps the dash.
  const footway = paintOf('tileflow-road-surface-footway-fill')['line-dasharray'];
  assert.deepEqual(
    evaluateProperty(footway, mapLibreStyleSpec.paint_line['line-dasharray'], {
      class: 'path_construction',
      subclass: 'footway',
    }),
    [1.5, 1],
  );
});

test('mountain-bike difficulty dashes trails and tracks, and leaves other roads solid', () => {
  const layers = compileRoads(
    roads({
      detail: 'all',
      extras: {paths: true},
      mountainBike: {'5': {surface: {fill: {dash: [1.5, 1]}}}},
    }),
    context,
  ).map(({layer}) => layer);
  const dash = (id: string) =>
    (layers.find((layer) => layer.id === id)!.paint as Record<string, unknown>)['line-dasharray'];
  for (const roadClass of ['motorway', 'primary', 'minor', 'service'])
    assert.equal(dash(`tileflow-road-surface-${roadClass}-fill`), undefined, roadClass);
  for (const [roadClass, properties] of [
    ['footway', {class: 'path', subclass: 'footway', mtb_scale: 5}],
    ['track', {class: 'track', mtb_scale: 5}],
  ] as const)
    assert.deepEqual(
      evaluateProperty(
        dash(`tileflow-road-surface-${roadClass}-fill`),
        mapLibreStyleSpec.paint_line['line-dasharray'],
        properties,
      ),
      [1.5, 1],
      roadClass,
    );
});

test('roundabout widths between authored stops are stated per zoom as MapLibre evaluates them', () => {
  // A width that changes between its stops and with the feature, as a road's ramps and access do.
  const width = expression<number>([
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    12,
    ['case', ['==', ['get', 'ramp'], 1], ['*', 1, 0.72], ['*', 1, 1]],
    18,
    ['case', ['==', ['get', 'ramp'], 1], ['*', 9, 0.72], ['*', 9, 1]],
  ]);
  const layers = compileRoads(
    roads({detail: 'none', classes: {minor: {surface: {fill: {width}, casing: {width: 1}}}}}),
    context,
  ).map(({layer}) => layer);
  const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
  const radius = (fill.paint as Record<string, unknown>)['circle-radius'];
  const text = JSON.stringify(radius);
  assert.doesNotMatch(
    text,
    /\["interpolate",\["exponential",1\.5\],\d/,
    'no curve at a known zoom',
  );
  assert.equal((radius as unknown[])[0], 'let', 'repeated feature expressions are stated once');
  for (const ramp of [0, 1])
    for (const level of [15, 16, 17, 18]) {
      const properties = {class: 'minor', radius_px_z15: 20, ramp};
      const expected =
        20 * 2 ** (level - 15) -
        (evaluateProperty(
          (width as unknown as {value: unknown}).value,
          mapLibreStyleSpec.paint_line['line-width'],
          properties,
          level,
        ) as number) /
          2;
      const actual = evaluateProperty(
        radius,
        mapLibreStyleSpec.paint_circle['circle-radius'],
        properties,
        level,
      ) as number;
      assert.ok(Math.abs(actual - expected) < 1e-9, `ramp ${ramp} at z${level}`);
    }
  assert.deepEqual(styleErrors(layers), []);
});

test('roundabouts follow enabled classes, phase visibility, zoom ranges and data capabilities', () => {
  assert.equal(
    compileRoads(roads({detail: 'none'}), context).some(({target}) =>
      target.startsWith('roads.roundabouts'),
    ),
    false,
  );
  const contributions = compileRoads(
    roads({
      detail: 'all',
      classes: {
        motorway: {enabled: false},
        minor: {surface: {fill: {visible: false}}},
        primary: {surface: {casing: {visible: false}, fill: {minZoom: 17}}},
      },
    }),
    context,
  );
  const fill = contributions.find(({target}) => target === 'roads.roundabouts.fill')!.layer;
  const casing = contributions.find(({target}) => target === 'roads.roundabouts.casing')!.layer;
  for (const roadClass of ['motorway', 'minor']) {
    assert.equal(
      matchesFilter(fill.filter, {class: roadClass, circle_kind: 'road_ring'}, 'Point'),
      false,
    );
  }
  for (const level of [16, 16.99, 17, 17.25]) {
    assert.equal(
      evaluateProperty(
        (fill.paint as Record<string, unknown>)['circle-stroke-opacity'],
        mapLibreStyleSpec.paint_circle['circle-stroke-opacity'],
        {class: 'primary'},
        level,
      ),
      level < 17 ? 0 : 1,
    );
    assert.equal(
      evaluateProperty(
        (fill.paint as Record<string, unknown>)['circle-stroke-opacity'],
        mapLibreStyleSpec.paint_circle['circle-stroke-opacity'],
        {class: 'secondary'},
        level,
      ),
      1,
    );
  }
  assert.equal(
    matchesFilter(casing.filter, {class: 'primary', circle_kind: 'road_ring'}, 'Point'),
    false,
  );
  assert.equal(
    matchesFilter(fill.filter, {class: 'secondary', circle_kind: 'road_ring'}, 'Point'),
    true,
  );
  assert.equal(
    compileRoads(roads(), {
      ...context,
      data: resolveTileflowData({
        url: '/tiles.json',
        type: 'vector',
        attribution: 'Road test',
        schema: openMapTiles(),
      }),
    }).some(({target}) => target.startsWith('roads.roundabouts')),
    false,
  );
});

test('explicit roundabout widths and circle properties replace automatic geometry independently', () => {
  const layers = compileRoads(
    roads({
      detail: 'none',
      classes: {primary: {surface: {fill: {width: 20}}}},
      roundabouts: {
        fallbackWidth: 7,
        borderWidth: 0,
        fill: {radius: 12, strokeOpacity: 0},
        casing: {strokeWidth: 3},
      },
    }),
    context,
  ).map(({layer}) => layer);
  const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
  const casing = layers.find(({id}) => id === 'tileflow-road-circular-casing')!;
  const properties = {class: 'primary', radius_px_z15: 20};
  assert.equal((fill.paint as Record<string, unknown>)['circle-radius'], 12);
  assert.equal((fill.paint as Record<string, unknown>)['circle-stroke-opacity'], 0);
  assert.equal((casing.paint as Record<string, unknown>)['circle-stroke-width'], 3);
  assert.equal(
    evaluateProperty(
      (fill.paint as Record<string, unknown>)['circle-stroke-width'],
      mapLibreStyleSpec.paint_circle['circle-stroke-width'],
      properties,
    ),
    7,
  );
  assert.deepEqual(styleErrors(layers), []);
});

test('ramps precede receiving fills within each structure and can keep class order', () => {
  const request = {detail: 'none' as const, classes: {motorway: {}, minor: {}}};
  for (const planned of [false, true]) {
    const contributions = compileRoads(roads(request), context);
    const layers = planned
      ? [
          ...lowerTileflowDomainIR(
            planTileflowLayerFamilies(
              assembleTileflowLayerFamilies(contributions.map(createTileflowLayerFamilyIR)),
            ),
            context.data,
          ).layers,
        ]
      : assembleTileflowLayers(contributions);
    for (const structure of ['surface', 'bridge', 'tunnel']) {
      const ramps = layers.filter(
        ({id}) => id.startsWith(`tileflow-road-${structure}-`) && id.endsWith('-rampFill'),
      );
      const fills = layers.filter(
        ({id}) => id.startsWith(`tileflow-road-${structure}-`) && id.endsWith('-fill'),
      );
      assert.ok(ramps.length > 0);
      assert.ok(
        ramps.every((ramp) => fills.every((fill) => layers.indexOf(ramp) < layers.indexOf(fill))),
      );
      for (const roadClass of ['minor', 'motorway']) {
        const properties = {
          class: roadClass,
          ramp: 1,
          ...(structure === 'surface' ? {} : {brunnel: structure}),
        };
        assert.equal(ramps.filter((layer) => matchesFilter(layer.filter, properties)).length, 1);
        assert.equal(fills.filter((layer) => matchesFilter(layer.filter, properties)).length, 0);
      }
    }
    assert.deepEqual(styleErrors(layers), []);
  }
  const classic = compileRoads(roads({...request, rampOrder: 'by-class'}), context);
  assert.equal(
    classic.some(({target}) => target.endsWith('.rampFill')),
    false,
  );
  const fill = classic.find(({target}) => target === 'roads.classes.motorway.surface.fill')!.layer;
  assert.equal(matchesFilter(fill.filter, {class: 'motorway', ramp: 1}), true);
});

test('an authored fallback curve preserves ring geometry at fractional and overzoom levels', () => {
  const levels = Array.from({length: 10}, (_, index) => 15 + index);
  const widthAt = (level: number) => 3 * (1 + ((1.35 ** (level - 15) - 1) / (1.35 ** 7 - 1)) * 1.2);
  const fallbackWidth = zoom.exponential(
    2,
    levels.map((level) => [level, widthAt(level)] as const),
  );
  const layers = compileRoads(roads({roundabouts: {fallbackWidth, borderWidth: 1}}), context).map(
    ({layer}) => layer,
  );
  const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
  const casing = layers.find(({id}) => id === 'tileflow-road-circular-casing')!;
  for (let level = 15; level <= 24; level += 0.25) {
    const lower = Math.floor(level);
    const upper = Math.min(lower + 1, 24);
    const width = widthAt(lower) + (widthAt(upper) - widthAt(lower)) * (2 ** (level - lower) - 1);
    const radius = 20 * 2 ** (level - 15) - width / 2;
    const properties = {class: 'minor', radius_px_z15: 20};
    for (const [layer, expectedRadius, expectedWidth] of [
      [fill, radius, width],
      [casing, radius - 0.5, width + 1],
    ] as const) {
      const paint = layer.paint as Record<string, unknown>;
      assert.ok(
        Math.abs(
          (evaluateProperty(
            paint['circle-radius'],
            mapLibreStyleSpec.paint_circle['circle-radius'],
            properties,
            level,
          ) as number) - expectedRadius,
        ) < 1e-8,
      );
      assert.ok(
        Math.abs(
          (evaluateProperty(
            paint['circle-stroke-width'],
            mapLibreStyleSpec.paint_circle['circle-stroke-width'],
            properties,
            level,
          ) as number) - expectedWidth,
        ) < 1e-8,
      );
    }
  }
});

test('mixed road color curves do not alter explicit roundabout appearance', () => {
  const color = zoom.exponential(1.5, [
    [15, '#102030'],
    [22, '#d0c0b0'],
  ]);
  const opacity = zoom.step([
    [15, 0.2],
    [17.25, 0.8],
  ]);
  const layers = compileRoads(
    roads({
      detail: 'none',
      classes: {
        minor: {
          surface: {
            fill: {
              color: zoom.linear([
                [15, '#000000'],
                [22, '#ffffff'],
              ]),
            },
          },
        },
        primary: {
          surface: {
            fill: {
              color: zoom.step([
                [15, '#123456'],
                [18, '#fedcba'],
              ]),
            },
          },
        },
      },
      roundabouts: {fill: {strokeColor: color, strokeOpacity: opacity}},
    }),
    context,
  ).map(({layer}) => layer);
  const fill = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
  const expected = ['interpolate', ['exponential', 1.5], ['zoom'], 15, '#102030', 22, '#d0c0b0'];
  assert.deepEqual((fill.paint as Record<string, unknown>)['circle-stroke-color'], expected);
  for (const level of [15, 16.9, 17.24, 17.25, 18.7, 22]) {
    for (const roadClass of ['minor', 'primary']) {
      assert.equal(
        evaluateProperty(
          (fill.paint as Record<string, unknown>)['circle-stroke-opacity'],
          mapLibreStyleSpec.paint_circle['circle-stroke-opacity'],
          {class: roadClass},
          level,
        ),
        level < 17.25 ? 0.2 : 0.8,
      );
    }
  }
  assert.deepEqual(styleErrors(layers), []);
});

test('roundabout width and radius retain integer and fractional width steps', () => {
  const width = zoom.step([
    [15, 4],
    [16, 20],
    [17.25, 6],
  ]);
  const borderWidth = zoom.step([
    [15, 2],
    [16, 6],
    [17.25, 1],
  ]);
  const layers = compileRoads(
    roads({
      detail: 'none',
      classes: {primary: {surface: {fill: {width}}}},
      roundabouts: {borderWidth},
    }),
    context,
  ).map(({layer}) => layer);
  assert.deepEqual(styleErrors(layers), []);
  for (const metric of [false, true]) {
    const properties = {
      class: 'primary',
      radius_px_z15: 100,
      ...(metric ? {radius_m: 20, inner_radius_m: 18, outer_radius_m: 22} : {}),
    };
    for (const level of [
      15,
      15.5,
      15.999,
      16 - 0.000001,
      16,
      16.000001,
      17.125,
      17.249,
      17.25 - 0.000001,
      17.25,
      17.250001,
      18.5,
      24,
    ]) {
      const centerline = 100 * 2 ** (level - 15);
      const roadWidth = level < 16 ? 4 : level < 17.25 ? 20 : 6;
      const border = level < 16 ? 2 : level < 17.25 ? 6 : 1;
      for (const phase of ['fill', 'casing']) {
        const paint = layers.find(({id}) => id === `tileflow-road-circular-${phase}`)!
          .paint as Record<string, unknown>;
        const extra = phase === 'casing' ? border : 0;
        const expected = {
          'circle-radius': (metric ? centerline * 0.9 : centerline - roadWidth / 2) - extra / 2,
          'circle-stroke-width': (metric ? centerline * 0.2 : roadWidth) + extra,
        };
        for (const property of ['circle-radius', 'circle-stroke-width'] as const) {
          const actual = evaluateProperty(
            paint[property],
            mapLibreStyleSpec.paint_circle[property],
            properties,
            level,
          ) as number;
          assert.ok(
            Math.abs(actual - expected[property]) < 1e-8,
            `${phase} ${property} metric=${metric} z${level}: ${actual} != ${expected[property]}`,
          );
        }
      }
    }
  }
});

test('roundabout sampling limits non-base-two width error with bounded default growth', () => {
  for (const width of [
    zoom.linear([
      [15, 2],
      [16, 100],
    ]),
    zoom.exponential(1.5, [
      [15, 2],
      [16, 100],
    ]),
  ]) {
    const layers = compileRoads(
      roads({
        detail: 'none',
        classes: {primary: {surface: {fill: {width}}}},
        roundabouts: {borderWidth: 1},
      }),
      context,
    ).map(({layer}) => layer);
    const ring = layers.find(({id}) => id === 'tileflow-road-circular-fill')!;
    const road = layers.find(({id}) => id === 'tileflow-road-surface-primary-fill')!;
    const paint = ring.paint as Record<string, unknown>;
    const properties = {class: 'primary', radius_px_z15: 100};
    for (let sample = 0; sample <= 100; sample++) {
      const level = 15 + sample / 100;
      const expected = evaluateProperty(
        (road.paint as Record<string, unknown>)['line-width'],
        mapLibreStyleSpec.paint_line['line-width'],
        properties,
        level,
      ) as number;
      const actual = evaluateProperty(
        paint['circle-stroke-width'],
        mapLibreStyleSpec.paint_circle['circle-stroke-width'],
        properties,
        level,
      ) as number;
      const radius = evaluateProperty(
        paint['circle-radius'],
        mapLibreStyleSpec.paint_circle['circle-radius'],
        properties,
        level,
      ) as number;
      assert.ok(Math.abs(actual - expected) < 0.1, `width at z${level}`);
      assert.ok(
        Math.abs(radius - (100 * 2 ** (level - 15) - expected / 2)) < 0.05,
        `radius at z${level}`,
      );
    }
    assert.deepEqual(styleErrors(layers), []);
  }
  for (const [request, expectedStops] of [
    [roads(), 11],
    [
      roads({
        roundabouts: {
          fallbackWidth: zoom.exponential(2, [
            [15, 4],
            [24, 40],
          ]),
          borderWidth: 1,
        },
      }),
      10,
    ],
  ] as const) {
    const ring = compileRoads(request, context).find(
      ({target}) => target === 'roads.roundabouts.fill',
    )!.layer;
    const radius = curveOf((ring.paint as Record<string, unknown>)['circle-radius']);
    assert.equal((radius.length - 3) / 2, expectedStops);
  }
});

test('feature-dependent ring widths preserve data and authored stops without dense sampling', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: 'Test',
    url: '/tiles.json',
    schema: openMapTiles({
      fields: {class: 'kind', circularKind: 'ring_kind', circularRadiusAtZoom15: 'ring_z15'},
      layers: {circularFeature: 'road_circles'},
    }),
  });
  const output = (scale: number) => [
    'case',
    ['==', ['get', 'expressway'], 1],
    ['*', ['to-number', ['get', 'lanes'], 1], scale],
    scale / 2,
  ];
  const width = expression<number>([
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    15.25,
    output(4),
    17.5,
    output(10),
    20.25,
    output(20),
  ]);
  const borderWidth = expression<number>([
    'step',
    ['zoom'],
    1,
    17.75,
    ['case', ['==', ['get', 'kind'], 'primary'], 5, 2],
  ]);
  const layers = compileRoads(
    roads({
      detail: 'none',
      classes: {primary: {surface: {fill: {width}}}, minor: {surface: {fill: {width: 3}}}},
      roundabouts: {borderWidth},
    }),
    {...context, data},
  ).map(({layer}) => layer);
  const rings = layers.filter(({id}) => id.startsWith('tileflow-road-circular-'));
  assert.deepEqual(styleErrors(layers), []);
  assert.ok(
    JSON.stringify(rings).length < 100_000,
    'geometry must not duplicate large expression trees densely',
  );
  for (const ring of rings) {
    const radius = curveOf((ring.paint as Record<string, unknown>)['circle-radius']);
    assert.equal((radius.length - 3) / 2, 15);
    assert.equal(ring['source-layer'], 'road_circles');
  }
  for (const roadClass of ['primary', 'minor']) {
    const road = layers.find(({id}) => id === `tileflow-road-surface-${roadClass}-fill`)!;
    for (const expressway of [0, 1])
      for (const lanes of [1, 3]) {
        const properties = {
          kind: roadClass,
          ring_kind: 'road_ring',
          ring_z15: 100,
          expressway,
          lanes,
        };
        for (const level of [15, 15.25, 16, 17.5, 17.75 - 0.000001, 17.75, 18, 20.25, 24]) {
          const roadWidth = evaluateProperty(
            (road.paint as Record<string, unknown>)['line-width'],
            mapLibreStyleSpec.paint_line['line-width'],
            properties,
            level,
          ) as number;
          for (const ring of rings) {
            assert.equal(matchesFilter(ring.filter, properties, 'Point'), true);
            const border = ring.id.endsWith('-casing')
              ? level < 17.75
                ? 1
                : roadClass === 'primary'
                  ? 5
                  : 2
              : 0;
            const paint = ring.paint as Record<string, unknown>;
            for (const [property, expected] of [
              ['circle-stroke-width', roadWidth + border],
              ['circle-radius', 100 * 2 ** (level - 15) - (roadWidth + border) / 2],
            ] as const) {
              const actual = evaluateProperty(
                paint[property],
                mapLibreStyleSpec.paint_circle[property],
                properties,
                level,
              ) as number;
              assert.ok(
                Math.abs(actual - expected) < 1e-8,
                `${property}, ${roadClass}, z${level}, expressway=${expressway}, lanes=${lanes}`,
              );
            }
          }
        }
      }
  }
});

test('strokes only the outer boundary of road areas when the data publishes it', () => {
  const style = roads({
    areas: {pier: {outline: {color: '#112233', width: 1}}},
    detail: 'none',
  });
  const byId = (contributions: ReturnType<typeof compileRoads>, id: string) =>
    contributions.find(({layer}) => layer.id === id)!.layer as Layer;

  // Tileflow World publishes the outer rings as lines: the outlines read them, never the holes.
  const world = compileRoads(style, context);
  const pedestrianFill = byId(world, 'tileflow-road-pedestrian-area');
  const pedestrianOutline = byId(world, 'tileflow-road-pedestrian-area-outline');
  const pierOutline = byId(world, 'tileflow-road-pier-area-outline');
  assert.equal(pedestrianFill['source-layer'], sourceLayer);
  assert.equal(pedestrianOutline['source-layer'], 'transportation_outline');
  assert.equal(pierOutline['source-layer'], 'transportation_outline');
  assert.deepEqual(
    pedestrianOutline.filter,
    tileflowRoadClassFilter(context.data.schema.fields, 'pedestrian'),
  );
  assert.ok(matchesFilter(pedestrianOutline.filter, {class: 'path', subclass: 'pedestrian'}));
  assert.ok(!matchesFilter(pedestrianOutline.filter, {class: 'pier'}));
  assert.ok(matchesFilter(pierOutline.filter, {class: 'pier'}));
  assert.ok(!matchesFilter(pierOutline.filter, {class: 'path', subclass: 'pedestrian'}));

  // Other OpenMapTiles data has no such layer: the outline strokes the polygons.
  const generic = compileRoads(style, {
    ...context,
    data: resolveTileflowData(
      vectorTiles({attribution: '© Example', schema: openMapTiles(), url: '/tiles.json'}),
    ),
  });
  const genericOutline = byId(generic, 'tileflow-road-pedestrian-area-outline');
  assert.equal(genericOutline['source-layer'], sourceLayer);
  assert.ok(
    matchesFilter(genericOutline.filter, {class: 'path', subclass: 'pedestrian'}, 'Polygon'),
  );
  assert.ok(
    !matchesFilter(genericOutline.filter, {class: 'path', subclass: 'pedestrian'}, 'LineString'),
  );
});
