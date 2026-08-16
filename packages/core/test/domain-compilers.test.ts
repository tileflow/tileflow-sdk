import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expression,
  labels,
  openMapTiles,
  poi,
  resolveTileflowData,
  roads,
  water,
  zoom,
} from '../src';
import {assembleTileflowLayers} from '../src/cartography/graph';
import {compileAeroways} from '../src/modules/aeroways/compiler';
import {compileBoundaries} from '../src/modules/boundaries/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {compileLabels} from '../src/modules/labels/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
import {compileRoads} from '../src/modules/roads/compiler';
import {compileTransit} from '../src/modules/transit/compiler';
import {compileWater} from '../src/modules/water/compiler';
import {resolveColors} from '../src/themes';

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

test('compiles complete land and water domains into stable direct layers', () => {
  const layers = assembleTileflowLayers([
    ...compileLand(undefined, context),
    ...compileWater(undefined, context),
  ]);
  const ids = layers.map((layer) => layer.id);

  assert.equal(ids[0], 'streets-background');
  assert.ok(ids.includes('streets-global-landcover'));
  assert.ok(ids.includes('streets-landuse-commercial'));
  assert.ok(ids.includes('streets-landcover-wood'));
  assert.ok(ids.includes('streets-water'));
  assert.ok(ids.includes('streets-waterway-river-intermittent'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(layers.every((layer) => !String(layer.id).startsWith('landuse-')));
});

test('renders the seven global land-cover classes below OSM and fades them out at zoom 8', () => {
  const contributions = compileLand(undefined, context);
  const globalLandcover = contributions.find(
    (entry) => entry.layer.id === 'streets-global-landcover',
  )!;
  const osmLanduse = contributions.find(
    (entry) => entry.layer.id === 'streets-landuse-residential',
  )!;
  const osmLandcover = contributions.find((entry) => entry.layer.id === 'streets-landcover-wood')!;
  const paint = globalLandcover.layer.paint as Record<string, unknown>;

  assert.equal(globalLandcover.layer['source-layer'], 'globallandcover');
  assert.equal(globalLandcover.layer.minzoom, 0);
  assert.equal(globalLandcover.layer.maxzoom, 8);
  assert.deepEqual(paint['fill-color'], [
    'match',
    ['get', 'class'],
    'barren',
    context.colors.landcover.rock,
    'crop',
    context.colors.roadMajor,
    'grass',
    context.colors.landcover.grass,
    'shrub',
    context.colors.landcover.protected,
    'snow',
    context.colors.landcover.ice,
    'trees',
    context.colors.landcover.wood,
    'urban',
    context.colors.building,
    'rgba(0, 0, 0, 0)',
  ]);
  assert.deepEqual(paint['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    0.88,
    6,
    0.82,
    7,
    0.68,
    8,
    0,
  ]);
  assert.ok(globalLandcover.localOrder < osmLanduse.localOrder);
  assert.ok(globalLandcover.localOrder < osmLandcover.localOrder);

  const ordered = assembleTileflowLayers(contributions).map((layer) => layer.id);
  assert.ok(
    ordered.indexOf('streets-global-landcover') < ordered.indexOf('streets-landuse-residential'),
  );
  assert.ok(
    ordered.indexOf('streets-global-landcover') < ordered.indexOf('streets-landcover-wood'),
  );
});

test('remaps the global land-cover source-layer and class field', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {class: 'kind'},
      layers: {globalLandcover: 'worldcover_lowzoom'},
    }),
    url: '/tiles.json',
  });
  const globalLandcover = compileLand(undefined, {...context, data}).find(
    (entry) => entry.layer.id === 'streets-global-landcover',
  )!;

  assert.equal(globalLandcover.layer['source-layer'], 'worldcover_lowzoom');
  assert.deepEqual(
    ((globalLandcover.layer.paint as Record<string, unknown>)['fill-color'] as unknown[]).slice(
      0,
      2,
    ),
    ['match', ['get', 'kind']],
  );
});

test('applies exact water overrides without mutating defaults', () => {
  const first = compileWater(
    water({
      waterways: {river: {color: '#123456', width: 9}},
      intermittent: {waterways: {visible: false}},
    }),
    context,
  );
  const second = compileWater(undefined, context);
  const river = first.find((entry) => entry.layer.id === 'streets-waterway-river')!;
  const defaultRiver = second.find((entry) => entry.layer.id === 'streets-waterway-river')!;

  assert.equal((river.layer.paint as Record<string, unknown>)['line-color'], '#123456');
  assert.equal((river.layer.paint as Record<string, unknown>)['line-width'], 9);
  assert.equal(
    first.some((entry) => entry.layer.id.endsWith('river-intermittent')),
    false,
  );
  assert.notDeepEqual(river.layer.paint, defaultRiver.layer.paint);
});

test('compilers honor remapped OpenMapTiles layers and fields', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({layers: {waterway: 'hydro_lines'}, fields: {class: 'kind'}}),
    url: '/tiles.json',
  });
  const river = compileWater(undefined, {...context, data}).find(
    (entry) => entry.layer.id === 'streets-waterway-river',
  )!;

  assert.equal(river.layer['source-layer'], 'hydro_lines');
  assert.deepEqual(river.layer.filter, [
    'all',
    ['match', ['get', 'kind'], ['river'], true, false],
    ['!=', ['get', 'intermittent'], 1],
  ]);
});

test('compiles buildings, boundaries, aeroways, and transit without shared layer ownership', () => {
  const layers = assembleTileflowLayers([
    ...compileBuildings(undefined, context),
    ...compileBoundaries(undefined, context),
    ...compileAeroways(undefined, context),
    ...compileTransit(undefined, context),
  ]);
  const ids = layers.map((layer) => layer.id);

  assert.ok(ids.includes('streets-buildings-fill'));
  assert.ok(ids.includes('streets-boundary-admin2'));
  assert.ok(ids.includes('streets-aeroway-runway-fill'));
  assert.ok(ids.includes('streets-transit-rail-surface'));
  assert.equal(new Set(ids).size, ids.length);
});

test('compiles road classes, structures, phases, and exact semantic overrides', () => {
  const contributions = compileRoads(
    roads({
      detail: 'major',
      hierarchy: 'strong',
      classes: {
        primary: {
          surface: {
            fill: {
              color: '#D99A42',
              width: zoom.linear([
                [7, 0.6],
                [16, 8],
              ]),
            },
          },
          tunnel: {
            hatch: {
              angle: 5,
              color: '#8EA3B8',
              opacity: 0.3,
              size: 14,
              spacing: 9,
            },
          },
        },
      },
    }),
    context,
  );
  const ids = contributions.map((entry) => entry.layer.id);
  const primary = contributions.find(
    (entry) => entry.layer.id === 'streets-road-surface-primary-fill',
  )!;
  const tunnelCasing = contributions.find(
    (entry) => entry.layer.id === 'streets-road-tunnel-primary-casing',
  )!;
  const tunnelFill = contributions.find(
    (entry) => entry.layer.id === 'streets-road-tunnel-primary-fill',
  )!;
  const tunnelHatch = contributions.find(
    (entry) => entry.layer.id === 'streets-road-tunnel-primary-hatch',
  )!;

  assert.ok(ids.includes('streets-road-tunnel-motorway-fill'));
  assert.ok(ids.includes('streets-road-bridge-primary-casing'));
  assert.equal((tunnelCasing.layer.layout as Record<string, unknown>)['line-cap'], 'butt');
  assert.equal((tunnelFill.layer.layout as Record<string, unknown>)['line-cap'], 'butt');
  assert.equal((tunnelCasing.layer.paint as Record<string, unknown>)['line-dasharray'], undefined);
  assert.equal((tunnelFill.layer.paint as Record<string, unknown>)['line-dasharray'], undefined);
  assert.equal(tunnelHatch.layer.type, 'symbol');
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['symbol-placement'], 'line');
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['symbol-spacing'], 9);
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['text-field'], '╱');
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['text-rotate'], 5);
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['text-size'], 14);
  assert.equal((tunnelHatch.layer.paint as Record<string, unknown>)['text-color'], '#8EA3B8');
  assert.equal((tunnelHatch.layer.paint as Record<string, unknown>)['text-opacity'], 0.3);
  assert.equal(
    ids.some((id) => id.includes('-minor-')),
    false,
  );
  assert.equal((primary.layer.paint as Record<string, unknown>)['line-color'], '#D99A42');
  assert.deepEqual((primary.layer.paint as Record<string, unknown>)['line-width'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    7,
    0.6,
    16,
    8,
  ]);
});

test('applies road hierarchy, weight, and per-class width scales to generated widths', () => {
  const defaultPrimary = compileRoads(roads({detail: 'major'}), context).find(
    (entry) => entry.layer.id === 'streets-road-surface-primary-fill',
  )!;
  const emphasizedPrimary = compileRoads(
    roads({detail: 'major', hierarchy: 'strong', weight: 'bold', widthScale: {primary: 1.5}}),
    context,
  ).find((entry) => entry.layer.id === 'streets-road-surface-primary-fill')!;

  assert.notDeepEqual(
    emphasizedPrimary.layer.paint,
    defaultPrimary.layer.paint,
    'semantic width controls must affect generated paint',
  );
});

test('one-way markers use the resolved road font instead of MapLibre glyph defaults', () => {
  const marker = compileRoads(roads({oneWayMarkers: true}), context).find(
    (entry) => entry.layer.id === 'streets-road-oneway',
  );

  assert.deepEqual((marker?.layer.layout as Record<string, unknown>)['text-font'], [
    'Noto Sans Regular',
  ]);
});

test('compiles disjoint semantic path families across structures and remapped fields', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({fields: {class: 'kind', subclass: 'kind_detail'}}),
    url: '/tiles.json',
  });
  const contributions = compileRoads(roads({detail: 'all', extras: {paths: true}}), {
    ...context,
    data,
  });

  const expectedSubclasses = {
    pathway: ['path', 'bridleway', 'corridor'],
    footway: ['footway'],
    cycleway: ['cycleway'],
    steps: ['steps'],
    pedestrian: ['pedestrian'],
  } as const;

  for (const [roadClass, subclasses] of Object.entries(expectedSubclasses)) {
    for (const structure of ['surface', 'tunnel', 'bridge']) {
      const layer = contributions.find(
        (entry) => entry.layer.id === `streets-road-${structure}-${roadClass}-fill`,
      )?.layer;
      assert.ok(layer, `${roadClass} ${structure} fill must exist`);
      assert.deepEqual(layer.filter, [
        'all',
        [
          'all',
          ['match', ['get', 'kind'], ['path', 'path_construction'], true, false],
          ['match', ['get', 'kind_detail'], subclasses, true, false],
        ],
        structure === 'surface'
          ? ['match', ['get', 'brunnel'], ['tunnel', 'bridge'], false, true]
          : ['==', ['get', 'brunnel'], structure],
      ]);
    }
  }

  assert.equal(
    contributions.some((entry) => entry.layer.id.includes('-path-')),
    false,
    'the old overlapping path target must not be emitted',
  );
});

test('composes remapping-aware road treatments without multiplying generated layers', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {
        access: 'permission',
        bicycle: 'bike_permission',
        class: 'kind',
        layer: 'stack_order',
        level: 'floor_level',
        ramp: 'ramp_flag',
        service: 'service_kind',
        subclass: 'kind_detail',
        surface: 'pavement',
      },
    }),
    url: '/tiles.json',
  });
  const contributions = compileRoads(
    roads({
      classes: {
        primary: {surface: {fill: {color: '#AABBCC', opacity: 1, width: 10}}},
        service: {surface: {fill: {color: '#F5F5F5', opacity: 1, width: 8}}},
      },
      detail: 'all',
      modifiers: {
        construction: {surface: {fill: {color: '#DDEEFF'}}},
        ramp: {widthScale: 0.5},
        unpaved: {surface: {fill: {dash: [2, 1]}}},
      },
      restrictions: {
        access: {surface: {fill: {opacity: 0.4}}},
        bicycle: {surface: {fill: {color: '#778899'}}},
      },
      serviceTypes: {driveway: {widthScale: 0.6}},
    }),
    {...context, data},
  );
  const primary = contributions.find(
    (entry) => entry.layer.id === 'streets-road-surface-primary-fill',
  )!;
  const service = contributions.find(
    (entry) => entry.layer.id === 'streets-road-surface-service-fill',
  )!;
  const primaryPaint = primary.layer.paint as Record<string, unknown>;
  const serializedPrimary = JSON.stringify(primary.layer);
  const serializedService = JSON.stringify(service.layer);

  assert.match(serializedPrimary, /primary_construction/);
  assert.match(serializedPrimary, /ramp_flag/);
  assert.match(serializedPrimary, /pavement/);
  assert.match(serializedPrimary, /permission/);
  assert.match(serializedPrimary, /bike_permission/);
  assert.match(serializedService, /service_kind/);
  assert.match(serializedService, /driveway/);
  assert.deepEqual(primary.layer.layout, {
    'line-sort-key': ['coalesce', ['get', 'stack_order'], ['get', 'floor_level'], 0],
    'line-cap': 'round',
    'line-join': 'round',
  });
  assert.deepEqual(primaryPaint['line-width'], [
    'case',
    ['==', ['get', 'ramp_flag'], 1],
    ['*', 10, 0.5],
    10,
  ]);
  assert.deepEqual(primaryPaint['line-dasharray'], [
    'case',
    ['==', ['get', 'pavement'], 'unpaved'],
    ['literal', [2, 1]],
    ['literal', [1, 0]],
  ]);
  assert.equal(
    contributions.filter((entry) => entry.layer.id === primary.layer.id).length,
    1,
    'treatments must remain data-driven instead of duplicating semantic class layers',
  );
});

test('keeps zoom interpolation at the expression root when treatments refine widths', () => {
  const primary = compileRoads(
    roads({
      classes: {
        primary: {
          surface: {
            fill: {
              width: expression<number>([
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                2,
                16,
                ['match', ['get', 'oneway'], [1, -1], 8, 12],
              ]),
            },
          },
        },
      },
      detail: 'major',
      modifiers: {ramp: {widthScale: 0.7}},
    }),
    context,
  ).find((entry) => entry.layer.id === 'streets-road-surface-primary-fill')!;
  const width = (primary.layer.paint as Record<string, unknown>)['line-width'] as unknown[];

  assert.equal(width[0], 'interpolate');
  assert.deepEqual(width.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 10]);
  assert.match(JSON.stringify(width), /"ramp"/);
  assert.match(JSON.stringify(width), /"oneway"/);
});

test('an explicit semantic path class has an effect without enabling the whole path family', () => {
  const contributions = compileRoads(
    roads({
      classes: {cycleway: {surface: {fill: {color: '#123456'}}}},
      detail: 'none',
    }),
    context,
  );

  const cycleway = contributions.find(
    (entry) => entry.layer.id === 'streets-road-surface-cycleway-fill',
  );
  assert.equal((cycleway?.layer.paint as Record<string, unknown>)['line-color'], '#123456');
  assert.equal(
    contributions.some((entry) => entry.layer.id === 'streets-road-surface-footway-fill'),
    false,
  );

  const labelsForCycleway = compileLabels(
    labels({roadClasses: ['cycleway'], roads: 'all'}),
    roads({classes: {cycleway: {}}}),
    context,
  );
  assert.equal(
    labelsForCycleway.some((entry) => entry.layer.id === 'streets-label-road-cycleway'),
    true,
  );
});

test('compiles pedestrian polygons as a semantic road area even without line classes', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({fields: {class: 'kind', subclass: 'kind_detail'}}),
    url: '/tiles.json',
  });
  const contributions = compileRoads(
    roads({
      areas: {
        pedestrian: {
          fill: {color: '#F1F3F5'},
          outline: {color: '#D5DCE3', width: 1},
        },
      },
      detail: 'none',
    }),
    {...context, data},
  );
  const pedestrianArea = contributions.find(
    (entry) => entry.layer.id === 'streets-road-pedestrian-area',
  );

  assert.ok(pedestrianArea);
  assert.deepEqual(pedestrianArea.layer.filter, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    [
      'all',
      ['match', ['get', 'kind'], ['path', 'path_construction'], true, false],
      ['match', ['get', 'kind_detail'], ['pedestrian'], true, false],
    ],
  ]);
  assert.deepEqual(pedestrianArea.layer.paint, {
    'fill-color': '#F1F3F5',
    'fill-opacity': 1,
  });
  const pedestrianOutline = contributions.find(
    (entry) => entry.layer.id === 'streets-road-pedestrian-area-outline',
  );
  assert.equal(
    (pedestrianOutline?.layer.paint as Record<string, unknown>)['line-color'],
    '#D5DCE3',
  );
  assert.equal(
    contributions.some((entry) => entry.layer.id.includes('surface-pedestrian')),
    false,
  );
  assert.equal(pedestrianArea.slot, 'transport-areas');
});

test('orders road areas below every generated road line stack', () => {
  const ids = assembleTileflowLayers(
    compileRoads(
      roads({
        areas: {pedestrian: {fill: {color: '#F1F3F5'}}},
        detail: 'all',
        extras: {paths: true},
      }),
      context,
    ),
  ).map((layer) => layer.id);

  assert.ok(
    ids.indexOf('streets-road-pedestrian-area') <
      ids.indexOf('streets-road-surface-pedestrian-casing'),
  );
  assert.ok(
    ids.indexOf('streets-road-pedestrian-area') <
      ids.indexOf('streets-road-surface-pedestrian-fill'),
  );
});

test('coordinates label eligibility with roads and compiles exact label and POI styles', () => {
  const labelContributions = compileLabels(
    labels({
      roads: 'all',
      styles: {roads: {primary: {text: {color: '#112233', size: 15}}}},
    }),
    roads({detail: 'major'}),
    context,
  );
  const poiContributions = compilePoi(
    poi({
      categories: ['food', 'transit'],
      preset: 'balanced',
      styles: {food: {text: {color: '#AA4422'}}},
    }),
    context,
  );
  const primary = labelContributions.find(
    (entry) => entry.layer.id === 'streets-label-road-primary',
  )!;

  assert.equal(
    labelContributions.some((entry) => entry.layer.id.includes('road-minor')),
    false,
  );
  assert.equal((primary.layer.paint as Record<string, unknown>)['text-color'], '#112233');
  assert.deepEqual(
    poiContributions.map((entry) => entry.layer.id),
    [
      'streets-poi-food-icon',
      'streets-poi-food-label',
      'streets-poi-transit-icon',
      'streets-poi-transit-label',
    ],
  );
  assert.match(JSON.stringify(poiContributions[0]?.layer.filter), /14/);
  assert.match(JSON.stringify(poiContributions[1]?.layer.filter), /80/);
});

test('compiles a semantic POI marker through the shared circle primitive', () => {
  const contributions = compilePoi(
    poi({
      categories: ['culture'],
      icons: false,
      labels: 'none',
      styles: {
        culture: {
          marker: {
            color: '#7755AA',
            radius: 5,
            strokeColor: '#FFFFFF',
            strokeWidth: 2,
          },
        },
      },
    }),
    context,
  );
  const marker = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-culture-marker',
  )?.layer;

  assert.equal(marker?.type, 'circle');
  assert.equal((marker?.paint as Record<string, unknown>)['circle-color'], '#7755AA');
  assert.equal((marker?.paint as Record<string, unknown>)['circle-stroke-width'], 2);
});

test('road labels use the same semantic path selectors as road geometry', () => {
  const selectedRoadClasses = ['pedestrian', 'footway', 'cycleway', 'steps', 'pathway'] as const;
  const labelContributions = compileLabels(
    labels({
      roadClasses: selectedRoadClasses,
      roads: 'all',
    }),
    roads({detail: 'all', extras: {paths: true}}),
    context,
  );

  const subclasses = new Set<string>();
  for (const roadClass of ['pedestrian', 'footway', 'cycleway', 'steps', 'pathway']) {
    const layer = labelContributions.find(
      (entry) => entry.layer.id === `streets-label-road-${roadClass}`,
    )?.layer;
    assert.ok(layer, `${roadClass} label must exist`);
    const serialized = JSON.stringify(layer.filter);
    assert.match(serialized, /"class"/);
    assert.match(serialized, /"subclass"/);
    for (const value of ['pedestrian', 'footway', 'cycleway', 'steps']) {
      if (serialized.includes(`"${value}"`)) subclasses.add(value);
    }
  }
  assert.deepEqual([...subclasses].sort(), ['cycleway', 'footway', 'pedestrian', 'steps']);
  assert.deepEqual(
    compileLabels(
      labels({roadClasses: [...selectedRoadClasses].reverse(), roads: 'all'}),
      roads({detail: 'all', extras: {paths: true}}),
      context,
    ).map((entry) => entry.layer.id),
    labelContributions.map((entry) => entry.layer.id),
    'selection array order must not control symbol layer order',
  );
});

test('composes expressway, toll, indoor, official, and mountain-bike intelligence from bound data', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {
        expressway: 'fast_flag',
        indoor: 'inside_flag',
        mtbScale: 'trail_grade',
        official: 'official_flag',
        toll: 'paid_flag',
      },
    }),
    url: '/tiles.json',
  });
  const contributions = compileRoads(
    roads({
      detail: 'all',
      extras: {paths: true},
      modifiers: {
        expressway: {surface: {fill: {color: '#112233'}}},
        indoor: {surface: {fill: {opacity: 0.35}}},
        official: {surface: {casing: {color: '#445566'}}},
      },
      mountainBike: {
        '0': {surface: {fill: {color: '#55AA66'}}},
        '3+': {surface: {fill: {color: '#AA5544'}}},
      },
      restrictions: {toll: {surface: {fill: {dash: [3, 1]}}}},
    }),
    {...context, data},
  );
  const primary = JSON.stringify(
    contributions.find((entry) => entry.layer.id === 'streets-road-surface-primary-fill')?.layer,
  );
  const pathway = JSON.stringify(
    contributions.find((entry) => entry.layer.id === 'streets-road-surface-pathway-fill')?.layer,
  );
  const pathwayCasing = JSON.stringify(
    contributions.find((entry) => entry.layer.id === 'streets-road-surface-pathway-casing')?.layer,
  );

  assert.match(primary, /fast_flag/);
  assert.match(primary, /paid_flag/);
  assert.match(primary, /inside_flag/);
  assert.match(pathway, /trail_grade/);
  assert.match(pathway, /3\+/);
  assert.match(pathwayCasing, /official_flag/);
  assert.equal(
    contributions.filter((entry) => entry.layer.id === 'streets-road-surface-primary-fill').length,
    1,
  );
});

test('compiles network-specific road shields and motorway junction labels without raw IDs', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {
        class: 'kind',
        name: 'label',
        network: 'route_network',
        ref: 'route_ref',
        subclass: 'detail',
      },
      layers: {roadName: 'road_labels'},
    }),
    url: '/tiles.json',
  });
  const contributions = compileLabels(
    labels({
      junctions: true,
      roads: 'all',
      shields: 'all',
      styles: {
        junctions: {text: {color: '#556677'}},
        shields: {
          default: {text: {color: '#334455'}},
          networks: {'gb-motorway': {text: {color: '#FFFFFF'}}},
        },
      },
    }),
    roads({detail: 'all'}),
    {...context, data},
  );
  const generic = contributions.find(
    (entry) => entry.layer.id === 'streets-label-road-shield',
  )?.layer;
  const network = contributions.find(
    (entry) => entry.layer.id === 'streets-label-road-shield-gb-motorway',
  )?.layer;
  const junction = contributions.find(
    (entry) => entry.layer.id === 'streets-label-road-junction',
  )?.layer;

  assert.equal(generic?.['source-layer'], 'road_labels');
  assert.match(JSON.stringify(generic?.filter), /route_network/);
  assert.match(JSON.stringify(network?.filter), /gb-motorway/);
  assert.match(JSON.stringify(network?.layout), /route_ref/);
  assert.match(JSON.stringify(junction?.filter), /motorway_junction/);
  assert.match(JSON.stringify(junction?.filter), /detail/);
  assert.equal((junction?.paint as Record<string, unknown>)['text-color'], '#556677');
});

test('POI density, label detail, icon detail, and coupling change emitted layers', () => {
  const uncoupled = compilePoi(
    poi({categories: ['food'], density: 'dense', icons: 'full', labels: 'full'}),
    context,
  );
  const coupled = compilePoi(
    poi({
      categories: ['food'],
      density: 'balanced',
      icons: 'essential',
      labels: 'balanced',
      placement: {coupleIconAndLabel: true},
    }),
    context,
  );

  assert.deepEqual(
    uncoupled.map((entry) => entry.layer.id),
    ['streets-poi-food-icon', 'streets-poi-food-label'],
  );
  assert.doesNotMatch(JSON.stringify(uncoupled[0]?.layer.filter), /rank/);
  assert.deepEqual(
    coupled.map((entry) => entry.layer.id),
    ['streets-poi-food'],
  );
  assert.match(JSON.stringify(coupled[0]?.layer.filter), /14/);

  const balancedLabels = compilePoi(
    poi({categories: ['food'], density: 'balanced', icons: false, labels: 'balanced'}),
    context,
  );
  assert.match(JSON.stringify(balancedLabels[0]?.layer.filter), /80/);
});

test('POI categories can introduce their labels at different zoom levels', () => {
  const contributions = compilePoi(
    poi({
      categories: ['culture', 'food'],
      icons: false,
      labels: 'balanced',
      minZoom: 12.5,
      styles: {
        culture: {marker: {radius: 3}, minZoom: 12.5},
        food: {marker: {radius: 3}, minZoom: 15.5},
      },
    }),
    context,
  );
  const culture = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-culture-label',
  )?.layer;
  const food = contributions.find((entry) => entry.layer.id === 'streets-poi-food-label')?.layer;
  const cultureMarker = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-culture-marker',
  )?.layer;
  const foodMarker = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-food-marker',
  )?.layer;

  assert.equal(culture?.minzoom, 12.5);
  assert.equal(food?.minzoom, 15.5);
  assert.equal(cultureMarker?.minzoom, 12.5);
  assert.equal(foodMarker?.minzoom, 15.5);
});

test('POI categories can replace global rank presets with exact semantic ceilings', () => {
  const contributions = compilePoi(
    poi({
      categories: ['culture', 'lodging'],
      density: 'balanced',
      icons: false,
      labels: 'balanced',
      styles: {
        culture: {maxRank: 120},
        lodging: {marker: {radius: 3}, maxRank: 360},
      },
    }),
    context,
  );
  const culture = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-culture-label',
  )?.layer;
  const lodgingLabel = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-lodging-label',
  )?.layer;
  const lodgingMarker = contributions.find(
    (entry) => entry.layer.id === 'streets-poi-lodging-marker',
  )?.layer;

  assert.match(JSON.stringify(culture?.filter), /120/);
  assert.match(JSON.stringify(lodgingLabel?.filter), /360/);
  assert.match(JSON.stringify(lodgingMarker?.filter), /360/);
});
