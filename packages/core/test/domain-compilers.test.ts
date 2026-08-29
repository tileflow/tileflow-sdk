import assert from 'node:assert/strict';
import test from 'node:test';
import {labels, land, openMapTiles, poi, resolveTileflowData, roads, water, zoom} from '../src';
import {expression} from '../src/cartography/values';
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
import {assembleTileflowLayers} from './layer-ir-fixture';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  images: {'poi.transport': 'transit'},
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Bold'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

test('compiles complete land and water domains into stable direct layers', () => {
  const layers = assembleTileflowLayers([
    ...compileLand(undefined, context),
    ...compileWater(undefined, context),
  ]);
  const ids = layers.map((layer) => layer.id);

  assert.equal(ids[0], 'tileflow-background');
  assert.ok(ids.includes('tileflow-global-landcover'));
  assert.ok(ids.includes('tileflow-landuse-commercial'));
  assert.ok(ids.includes('tileflow-landuse-education'));
  assert.ok(ids.includes('tileflow-landuse-government'));
  assert.ok(ids.includes('tileflow-landuse-medical'));
  assert.ok(ids.includes('tileflow-landuse-parking'));
  assert.ok(ids.includes('tileflow-landcover-wood'));
  assert.ok(ids.includes('tileflow-water'));
  assert.ok(ids.includes('tileflow-waterway-river-intermittent'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(layers.every((layer) => !String(layer.id).startsWith('landuse-')));

  const commercial = layers.find((layer) => layer.id === 'tileflow-landuse-commercial');
  assert.deepEqual(commercial?.filter, [
    'match',
    ['get', 'class'],
    ['commercial', 'retail', 'business_area'],
    true,
    false,
  ]);
});

test('renders the seven global land-cover classes below OSM and fades them out at zoom 8', () => {
  const contributions = compileLand(undefined, context);
  const globalLandcover = contributions.find(
    (entry) => entry.layer.id === 'tileflow-global-landcover',
  )!;
  const osmLanduse = contributions.find(
    (entry) => entry.layer.id === 'tileflow-landuse-residential',
  )!;
  const osmLandcover = contributions.find((entry) => entry.layer.id === 'tileflow-landcover-wood')!;
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
    context.colors.landcover.farmland,
    'grass',
    context.colors.landcover.grass,
    'shrub',
    context.colors.landcover.protected,
    'snow',
    context.colors.landcover.ice,
    'trees',
    context.colors.landcover.wood,
    'urban',
    context.colors.buildings.active,
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
    ordered.indexOf('tileflow-global-landcover') < ordered.indexOf('tileflow-landuse-residential'),
  );
  assert.ok(
    ordered.indexOf('tileflow-global-landcover') < ordered.indexOf('tileflow-landcover-wood'),
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
    (entry) => entry.layer.id === 'tileflow-global-landcover',
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

test('applies public global land-cover and bathymetry styles without raw patches', () => {
  const globalLandcover = compileLand(
    land({globalLandcover: {color: '#123456', maxZoom: 7, opacity: 0.45}}),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-global-landcover')!;
  const bathymetry = compileWater(
    water({bathymetry: {color: '#234567', maxZoom: 9, opacity: 0.52}}),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-bathymetry')!;

  assert.equal(globalLandcover.layer.maxzoom, 7);
  assert.equal((globalLandcover.layer.paint as Record<string, unknown>)['fill-color'], '#123456');
  assert.equal((globalLandcover.layer.paint as Record<string, unknown>)['fill-opacity'], 0.45);
  assert.equal(bathymetry.layer.maxzoom, 9);
  assert.equal((bathymetry.layer.paint as Record<string, unknown>)['fill-color'], '#234567');
  assert.equal((bathymetry.layer.paint as Record<string, unknown>)['fill-opacity'], 0.52);

  assert.equal(
    compileLand(land({globalLandcover: {visible: false}}), context).some(
      (entry) => entry.layer.id === 'tileflow-global-landcover',
    ),
    false,
  );
  assert.equal(
    compileWater(water({bathymetry: {visible: false}}), context).some(
      (entry) => entry.layer.id === 'tileflow-bathymetry',
    ),
    false,
  );
});

test('applies semantic bathymetry label overrides while retaining band-depth defaults', () => {
  const defaults = compileWater(water({bathymetryLabels: {}}), context).find(
    (entry) => entry.layer.id === 'tileflow-bathymetry-labels',
  )!;
  const customized = compileWater(
    water({
      bathymetryLabels: {
        maxZoom: 9,
        minZoom: 5,
        priority: 42,
        spacing: 160,
        text: {
          color: '#123456',
          field: 'custom-depth',
          font: 'Noto Sans Bold',
          haloColor: '#ABCDEF',
          haloWidth: 2,
          opacity: 0.9,
          size: 12,
        },
        zOrder: 'source',
      },
    }),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-bathymetry-labels')!;
  const defaultLayout = defaults.layer.layout as Record<string, unknown>;
  const layout = customized.layer.layout as Record<string, unknown>;
  const paint = customized.layer.paint as Record<string, unknown>;

  assert.deepEqual(defaultLayout['text-field'], [
    'to-string',
    ['abs', ['to-number', ['get', 'min_depth'], 0]],
  ]);
  assert.equal(defaults.layer.minzoom, 3);
  assert.equal(defaults.layer.maxzoom, 10);
  assert.equal(customized.layer.minzoom, 5);
  assert.equal(customized.layer.maxzoom, 9);
  assert.equal(layout['symbol-sort-key'], -42);
  assert.equal(layout['symbol-spacing'], 160);
  assert.equal(layout['symbol-z-order'], 'source');
  assert.equal(layout['text-field'], 'custom-depth');
  assert.deepEqual(layout['text-font'], ['Noto Sans Bold']);
  assert.equal(layout['text-size'], 12);
  assert.equal(paint['text-color'], '#123456');
  assert.equal(paint['text-halo-color'], '#ABCDEF');
  assert.equal(paint['text-halo-width'], 2);
  assert.equal(paint['text-opacity'], 0.9);
  assert.equal(customized.target, 'water.bathymetryLabels');
  assert.equal(
    compileWater(undefined, context).some(
      (entry) => entry.layer.id === 'tileflow-bathymetry-labels',
    ),
    false,
  );

  assert.equal(
    compileWater(water({bathymetryLabels: {visible: false}}), context).some(
      (entry) => entry.layer.id === 'tileflow-bathymetry-labels',
    ),
    false,
  );
});

test('applies opt-in bathymetry contour overrides to discrete depth-band edges', () => {
  const defaults = compileWater(water({bathymetryContours: {}}), context).find(
    (entry) => entry.layer.id === 'tileflow-bathymetry-contours',
  )!;
  const customized = compileWater(
    water({
      bathymetryContours: {
        cap: 'round',
        color: '#123456',
        dash: [3, 2],
        join: 'bevel',
        maxZoom: 9,
        minZoom: 5,
        opacity: 0.8,
        width: 1.25,
      },
    }),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-bathymetry-contours')!;
  const defaultPaint = defaults.layer.paint as Record<string, unknown>;
  const layout = customized.layer.layout as Record<string, unknown>;
  const paint = customized.layer.paint as Record<string, unknown>;

  assert.equal(defaults.layer.minzoom, 3);
  assert.equal(defaults.layer.maxzoom, 10);
  assert.equal(defaultPaint['line-color'], context.colors.hydro.label);
  assert.deepEqual(defaults.layer.filter, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['has', 'min_depth'],
    ['<', ['to-number', ['get', 'min_depth'], 0], 0],
  ]);
  assert.equal(customized.layer.minzoom, 5);
  assert.equal(customized.layer.maxzoom, 9);
  assert.equal(layout['line-cap'], 'round');
  assert.equal(layout['line-join'], 'bevel');
  assert.equal(paint['line-color'], '#123456');
  assert.deepEqual(paint['line-dasharray'], [3, 2]);
  assert.equal(paint['line-opacity'], 0.8);
  assert.equal(paint['line-width'], 1.25);
  assert.equal(customized.slot, 'hydro');
  assert.equal(customized.target, 'water.bathymetryContours');
  assert.equal(
    compileWater(undefined, context).some(
      (entry) => entry.layer.id === 'tileflow-bathymetry-contours',
    ),
    false,
  );
  assert.equal(
    compileWater(water({bathymetryContours: {visible: false}}), context).some(
      (entry) => entry.layer.id === 'tileflow-bathymetry-contours',
    ),
    false,
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
  const river = first.find((entry) => entry.layer.id === 'tileflow-waterway-river')!;
  const defaultRiver = second.find((entry) => entry.layer.id === 'tileflow-waterway-river')!;

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
    (entry) => entry.layer.id === 'tileflow-waterway-river',
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

  assert.ok(ids.includes('tileflow-buildings-fill'));
  assert.ok(ids.includes('tileflow-business-corridor'));
  assert.ok(ids.includes('tileflow-boundary-admin2'));
  assert.ok(ids.includes('tileflow-aeroway-runway-fill'));
  assert.ok(ids.includes('tileflow-transit-rail-surface'));
  assert.equal(new Set(ids).size, ids.length);
});

test('colors building tones without making geometry visibility semantic', () => {
  const contributions = compileBuildings(undefined, context);
  const corridor = contributions.find((entry) => entry.layer.id === 'tileflow-business-corridor')!;
  const buildings = contributions.find((entry) => entry.layer.id === 'tileflow-buildings-fill')!;
  const paint = buildings.layer.paint as Record<string, unknown>;

  assert.equal(corridor.layer['source-layer'], 'business_corridor');
  assert.deepEqual(buildings.layer.filter, ['>=', ['zoom'], 15]);
  assert.deepEqual(paint['fill-color'], [
    'case',
    ['==', ['coalesce', ['get', 'building_tone'], ''], 'active'],
    context.colors.buildings.active,
    ['==', ['coalesce', ['get', 'building_tone'], ''], 'destination'],
    context.colors.buildings.destination,
    ['==', ['coalesce', ['get', 'building_tone'], ''], 'commercial'],
    context.colors.buildings.commercial,
    [
      'any',
      ['==', ['get', 'has_business'], true],
      ['==', ['get', 'has_business'], 1],
      ['==', ['get', 'has_business'], '1'],
      ['==', ['coalesce', ['get', 'building_kind'], 'generic'], 'commercial'],
    ],
    context.colors.buildings.commercial,
    context.colors.buildings.generic,
  ]);
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
    (entry) => entry.layer.id === 'tileflow-road-surface-primary-fill',
  )!;
  const tunnelCasing = contributions.find(
    (entry) => entry.layer.id === 'tileflow-road-tunnel-primary-casing',
  )!;
  const tunnelFill = contributions.find(
    (entry) => entry.layer.id === 'tileflow-road-tunnel-primary-fill',
  )!;
  const tunnelHatch = contributions.find(
    (entry) => entry.layer.id === 'tileflow-road-tunnel-primary-hatch',
  )!;

  assert.ok(ids.includes('tileflow-road-tunnel-motorway-fill'));
  assert.ok(ids.includes('tileflow-road-bridge-primary-casing'));
  assert.equal((tunnelCasing.layer.layout as Record<string, unknown>)['line-cap'], 'butt');
  assert.equal((tunnelFill.layer.layout as Record<string, unknown>)['line-cap'], 'butt');
  assert.equal((tunnelCasing.layer.paint as Record<string, unknown>)['line-dasharray'], undefined);
  assert.equal((tunnelFill.layer.paint as Record<string, unknown>)['line-dasharray'], undefined);
  assert.equal(tunnelHatch.layer.type, 'symbol');
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['symbol-placement'], 'line');
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['symbol-spacing'], 9);
  assert.equal((tunnelHatch.layer.layout as Record<string, unknown>)['text-field'], '|');
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

test('matches intrinsic hatch patterns to the fully rendered road width', () => {
  const contributions = compileRoads(
    roads({
      detail: 'major',
      classes: {
        primary: {
          tunnel: {
            fill: {
              width: zoom.linear([
                [17, 10],
                [19, 20],
              ]),
            },
            hatch: {
              minZoom: 17,
              pattern: 'tunnel-hatch',
              patternWidths: [8, 16, 32],
            },
          },
        },
      },
    }),
    context,
  );
  const hatch = contributions.find(
    (entry) => entry.layer.id === 'tileflow-road-tunnel-primary-hatch',
  )!;
  const paint = hatch.layer.paint as Record<string, unknown>;

  assert.equal(hatch.layer.type, 'line');
  assert.equal(hatch.layer.minzoom, 17);
  assert.match(JSON.stringify(paint['line-pattern']), /__tileflow_hatch_width/);
  assert.match(JSON.stringify(paint['line-pattern']), /tunnel-hatch-8/);
  assert.match(JSON.stringify(paint['line-pattern']), /tunnel-hatch-32/);
  assert.deepEqual(paint['line-width'], ['interpolate', ['linear'], ['zoom'], 17, 10, 19, 20]);
});

test('applies road hierarchy, weight, and per-class width scales to generated widths', () => {
  const defaultPrimary = compileRoads(roads({detail: 'major'}), context).find(
    (entry) => entry.layer.id === 'tileflow-road-surface-primary-fill',
  )!;
  const emphasizedPrimary = compileRoads(
    roads({detail: 'major', hierarchy: 'strong', weight: 'bold', widthScale: {primary: 1.5}}),
    context,
  ).find((entry) => entry.layer.id === 'tileflow-road-surface-primary-fill')!;

  assert.notDeepEqual(
    emphasizedPrimary.layer.paint,
    defaultPrimary.layer.paint,
    'semantic width controls must affect generated paint',
  );
});

test('one-way markers use the resolved road font instead of MapLibre glyph defaults', () => {
  const marker = compileRoads(roads({oneWayMarkers: true}), context).find(
    (entry) => entry.layer.id === 'tileflow-road-oneway',
  );
  const layout = marker?.layer.layout as Record<string, unknown>;

  assert.deepEqual(layout['text-font'], ['Noto Sans Regular']);
  assert.equal(layout['text-keep-upright'], false);
  assert.equal(layout['text-pitch-alignment'], 'map');
  assert.equal(layout['text-rotation-alignment'], 'map');
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
        (entry) => entry.layer.id === `tileflow-road-${structure}-${roadClass}-fill`,
      )?.layer;
      assert.ok(layer, `${roadClass} ${structure} fill must exist`);
      assert.deepEqual(layer.filter, [
        'all',
        ['==', ['geometry-type'], 'LineString'],
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
    (entry) => entry.layer.id === 'tileflow-road-surface-primary-fill',
  )!;
  const service = contributions.find(
    (entry) => entry.layer.id === 'tileflow-road-surface-service-fill',
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
  ).find((entry) => entry.layer.id === 'tileflow-road-surface-primary-fill')!;
  const width = (primary.layer.paint as Record<string, unknown>)['line-width'] as unknown[];

  assert.equal(width[0], 'interpolate');
  assert.deepEqual(width.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 10]);
  assert.match(JSON.stringify(width), /"ramp"/);
  assert.match(JSON.stringify(width), /"oneway"/);
  assert.equal(JSON.stringify(width).match(/"oneway"/g)?.length, 1);
  assert.match(JSON.stringify(width), /"let","__tileflow_road_base"/);
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
    (entry) => entry.layer.id === 'tileflow-road-surface-cycleway-fill',
  );
  assert.equal((cycleway?.layer.paint as Record<string, unknown>)['line-color'], '#123456');
  assert.equal(
    contributions.some((entry) => entry.layer.id === 'tileflow-road-surface-footway-fill'),
    false,
  );

  const labelsForCycleway = compileLabels(
    labels({roadClasses: ['cycleway'], roads: 'all'}),
    roads({classes: {cycleway: {}}}),
    context,
  );
  assert.equal(
    labelsForCycleway.some((entry) => entry.layer.id === 'tileflow-label-road-cycleway'),
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
    (entry) => entry.layer.id === 'tileflow-road-pedestrian-area',
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
    (entry) => entry.layer.id === 'tileflow-road-pedestrian-area-outline',
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
    ids.indexOf('tileflow-road-pedestrian-area') <
      ids.indexOf('tileflow-road-surface-pedestrian-casing'),
  );
  assert.ok(
    ids.indexOf('tileflow-road-pedestrian-area') <
      ids.indexOf('tileflow-road-surface-pedestrian-fill'),
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
      categories: ['food-drink', 'transport'],
      density: 3,
      styles: {'food-drink': {density: 2, text: {color: '#AA4422'}}},
    }),
    context,
  );
  const primary = labelContributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-primary',
  )!;

  assert.equal(
    labelContributions.some((entry) => entry.layer.id.includes('road-minor')),
    false,
  );
  assert.equal((primary.layer.paint as Record<string, unknown>)['text-color'], '#112233');
  assert.deepEqual(
    poiContributions.map((entry) => entry.layer.id),
    [
      'tileflow-poi-food-drink-icon',
      'tileflow-poi-food-drink-label',
      'tileflow-poi-transport-icon',
      'tileflow-poi-transport-label',
    ],
  );
  assert.match(JSON.stringify(poiContributions[0]?.layer.filter), /filter_rank/);
  assert.match(JSON.stringify(poiContributions[1]?.layer.filter), /size_rank/);
  assert.deepEqual((poiContributions[0]?.layer.filter as unknown[])[4], [
    '<=',
    ['to-number', ['get', 'filter_rank'], 6],
    2,
  ]);
  assert.deepEqual((poiContributions[2]?.layer.filter as unknown[])[4], [
    '<=',
    ['to-number', ['get', 'filter_rank'], 6],
    3,
  ]);
});

test('partitions point and line water labels without duplicate candidates', () => {
  const contributions = compileLabels(labels({water: 'all'}), roads({detail: 'major'}), context);
  const ocean = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-water-ocean',
  )?.layer;
  const other = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-water-other',
  )?.layer;
  const line = contributions.find((entry) => entry.layer.id === 'tileflow-label-water-line')?.layer;
  const waterway = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-water-waterway',
  )?.layer;

  assert.match(JSON.stringify(ocean?.filter), /Point/);
  assert.match(JSON.stringify(other?.filter), /Point/);
  assert.doesNotMatch(JSON.stringify(ocean?.filter), /LineString/);
  assert.match(JSON.stringify(line?.filter), /LineString/);
  assert.match(JSON.stringify(line?.filter), /ocean/);
  assert.match(JSON.stringify(line?.filter), /reservoir/);
  assert.match(JSON.stringify(waterway?.filter), /LineString/);
});

test('compiles a semantic POI marker through the shared circle primitive', () => {
  const contributions = compilePoi(
    poi({
      categories: ['arts-entertainment'],
      icons: false,
      labels: false,
      styles: {
        'arts-entertainment': {
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
    (entry) => entry.layer.id === 'tileflow-poi-arts-entertainment-marker',
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
      (entry) => entry.layer.id === `tileflow-label-road-${roadClass}`,
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
    contributions.find((entry) => entry.layer.id === 'tileflow-road-surface-primary-fill')?.layer,
  );
  const pathway = JSON.stringify(
    contributions.find((entry) => entry.layer.id === 'tileflow-road-surface-pathway-fill')?.layer,
  );
  const pathwayCasing = JSON.stringify(
    contributions.find((entry) => entry.layer.id === 'tileflow-road-surface-pathway-casing')?.layer,
  );

  assert.match(primary, /fast_flag/);
  assert.match(primary, /paid_flag/);
  assert.match(primary, /inside_flag/);
  assert.match(pathway, /trail_grade/);
  assert.match(pathway, /3\+/);
  assert.match(pathwayCasing, /official_flag/);
  assert.equal(
    contributions.filter((entry) => entry.layer.id === 'tileflow-road-surface-primary-fill').length,
    1,
  );
});

test('compiles global road-shield phases and allowlisted visuals without raw IDs', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {
        class: 'kind',
        name: 'label',
        ref: 'route_ref',
        refLength: 'route_ref_length',
        shieldKind: 'shield_family',
        shieldLineLengthMeters: 'shield_line_length',
        shieldRank: 'shield_rank',
        shieldText: 'shield_text',
        shieldTextColor: 'shield_ink',
        subclass: 'detail',
      },
      layers: {roadName: 'road_labels', roadShield: 'road_shields'},
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
          default: {
            icon: {
              image: 'route-shield',
              optional: false,
              textFit: 'width',
              textFitPadding: [0, 5, 0, 5],
            },
            text: {color: '#334455', optional: false},
          },
          detail: {spacing: 600},
          kinds: {'rectangle-blue': {image: 'route-shield-blue'}},
          overview: {priority: 90},
          textColors: {light: {color: '#FFFFFF'}},
        },
      },
    }),
    roads({detail: 'all'}),
    {...context, data},
  );
  const overview = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-shield-overview',
  )?.layer;
  const detail = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-shield-detail',
  )?.layer;
  const junction = contributions.find(
    (entry) => entry.layer.id === 'tileflow-label-road-junction',
  )?.layer;

  assert.equal(overview?.['source-layer'], 'road_shields');
  assert.equal(detail?.['source-layer'], 'road_labels');
  assert.equal(overview?.minzoom, 6);
  assert.equal(overview?.maxzoom, 11);
  assert.equal(detail?.minzoom, 11);
  assert.match(JSON.stringify(overview?.filter), /Point/);
  assert.match(
    JSON.stringify(overview?.filter),
    /\[">=",\["to-number",\["get","route_ref_length"\],0\],1\]/u,
  );
  assert.doesNotMatch(
    JSON.stringify(overview?.filter),
    /\[">=",\["to-number",\["get","route_ref_length"\],0\],2\]/u,
  );
  assert.match(JSON.stringify(detail?.filter), /LineString/);
  assert.match(JSON.stringify(overview?.filter), /shield_family/);
  assert.match(JSON.stringify(detail?.filter), /route_ref_length/);
  assert.match(JSON.stringify(detail?.filter), /shield_line_length/);
  assert.match(JSON.stringify(detail?.layout), /shield_text/);
  assert.match(JSON.stringify(detail?.layout?.['symbol-sort-key']), /shield_rank/);
  assert.match(JSON.stringify(detail?.layout?.['icon-image']), /route-shield-blue/);
  assert.match(JSON.stringify(detail?.layout?.['icon-image']), /shield_family/);
  assert.match(JSON.stringify(detail?.paint?.['text-color']), /shield_ink/);
  assert.equal(overview?.layout?.['symbol-placement'], 'point');
  assert.equal(detail?.layout?.['symbol-placement'], 'line');
  assert.equal(overview?.layout?.['icon-rotation-alignment'], 'viewport');
  assert.equal(overview?.layout?.['text-rotation-alignment'], 'viewport');
  assert.equal(detail?.layout?.['icon-rotation-alignment'], 'viewport');
  assert.equal(detail?.layout?.['text-rotation-alignment'], 'viewport');
  assert.equal(detail?.layout?.['symbol-spacing'], 600);
  assert.equal((overview?.layout as Record<string, unknown>)['icon-text-fit'], 'width');
  assert.deepEqual(
    (overview?.layout as Record<string, unknown>)['icon-text-fit-padding'],
    [0, 5, 0, 5],
  );
  assert.equal((overview?.layout as Record<string, unknown>)['icon-optional'], false);
  assert.equal((overview?.layout as Record<string, unknown>)['text-optional'], false);
  assert.match(JSON.stringify(junction?.filter), /motorway_junction/);
  assert.match(JSON.stringify(junction?.filter), /detail/);
  assert.equal((junction?.paint as Record<string, unknown>)['text-color'], '#556677');
});

test('generic OpenMapTiles degrades road shields to one neutral detail layer', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles(),
    url: '/tiles.json',
  });
  const contributions = compileLabels(
    labels({
      roads: 'all',
      shields: 'all',
      styles: {
        shields: {
          default: {
            icon: {image: 'shield-neutral'},
            text: {color: '#223344'},
          },
          kinds: {'rectangle-blue': {image: 'shield-blue'}},
          textColors: {light: {color: '#FFFFFF'}},
        },
      },
    }),
    roads({detail: 'all'}),
    {...context, data},
  );
  const shields = contributions.filter((entry) => entry.layer.id.includes('road-shield'));

  assert.equal(shields.length, 1);
  assert.equal(shields[0]?.layer.id, 'tileflow-label-road-shield-detail');
  assert.equal(shields[0]?.layer['source-layer'], 'transportation_name');
  assert.equal(shields[0]?.layer.layout?.['icon-image'], 'shield-neutral');
  assert.equal(shields[0]?.layer.paint?.['text-color'], '#223344');
  assert.doesNotMatch(JSON.stringify(shields[0]?.layer), /shield_kind|shield_text_color/u);
});

test('POI numeric density and coupling change emitted layers', () => {
  const uncoupled = compilePoi(
    poi({categories: ['food-drink'], density: 5, icons: true, labels: true}),
    context,
  );
  const coupled = compilePoi(
    poi({
      categories: ['food-drink'],
      density: 3,
      icons: true,
      labels: true,
      placement: {coupleIconAndLabel: true},
    }),
    context,
  );

  assert.deepEqual(
    uncoupled.map((entry) => entry.layer.id),
    ['tileflow-poi-food-drink-icon', 'tileflow-poi-food-drink-label'],
  );
  assert.match(JSON.stringify(uncoupled[0]?.layer.filter), /filter_rank/);
  assert.match(JSON.stringify(uncoupled[0]?.layer.filter), /,5\]/);
  assert.deepEqual(
    coupled.map((entry) => entry.layer.id),
    ['tileflow-poi-food-drink'],
  );
  assert.match(JSON.stringify(coupled[0]?.layer.filter), /,3\]/);

  const labelsOnly = compilePoi(
    poi({categories: ['food-drink'], density: 1, icons: false, labels: true}),
    context,
  );
  assert.deepEqual(
    labelsOnly.map((entry) => entry.layer.id),
    ['tileflow-poi-food-drink-label'],
  );
  assert.match(JSON.stringify(labelsOnly[0]?.layer.filter), /,1\]/);
});

test('POI categories can introduce their labels at different zoom levels', () => {
  const contributions = compilePoi(
    poi({
      categories: ['arts-entertainment', 'food-drink'],
      icons: false,
      labels: true,
      minZoom: 12.5,
      styles: {
        'arts-entertainment': {marker: {radius: 3}, minZoom: 12.5},
        'food-drink': {marker: {radius: 3}, minZoom: 15.5},
      },
    }),
    context,
  );
  const culture = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-arts-entertainment-label',
  )?.layer;
  const food = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-food-drink-label',
  )?.layer;
  const cultureMarker = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-arts-entertainment-marker',
  )?.layer;
  const foodMarker = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-food-drink-marker',
  )?.layer;

  assert.equal(culture?.minzoom, 12.5);
  assert.equal(food?.minzoom, 15.5);
  assert.equal(cultureMarker?.minzoom, 12.5);
  assert.equal(foodMarker?.minzoom, 15.5);
});

test('POI categories are exact and never fall back to class or subclass', () => {
  const contributions = compilePoi(
    poi({
      categories: ['transport'],
      density: 3,
      icons: false,
      labels: true,
    }),
    context,
  );
  const serializedFilter = JSON.stringify(contributions[0]?.layer.filter);

  assert.match(serializedFilter, /"category"/u);
  assert.match(serializedFilter, /"transport"/u);
  assert.doesNotMatch(serializedFilter, /"class"|"subclass"|"rank"/u);
});

test('POI placement orders by filter rank and then physical size rank', () => {
  const [layer] = compilePoi(
    poi({categories: ['landmark'], density: 4, icons: true, labels: false}),
    context,
  );

  assert.deepEqual(layer?.layer.layout?.['symbol-sort-key'], [
    '+',
    ['*', ['to-number', ['get', 'filter_rank'], 6], 17],
    ['to-number', ['get', 'size_rank'], 17],
  ]);
  assert.match(JSON.stringify(layer?.layer.layout?.['icon-image']), /"icon"/u);
  assert.match(JSON.stringify(layer?.layer.layout?.['icon-image']), /"culture"/u);
});
