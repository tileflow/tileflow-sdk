import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labels,
  land,
  openMapTiles,
  poi,
  resolveTileflowData,
  roads,
  vectorTiles,
  water,
  zoom,
} from '../src';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {createSemanticDataView} from '../src/cartography/semantic-bindings';
import {expression} from '../src/cartography/values';
import {compileAeroways} from '../src/modules/aeroways/compiler';
import {compileBoundaries} from '../src/modules/boundaries/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {compileLabels} from '../src/modules/labels/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compilePoi} from '../src/modules/poi/compiler';
import {TileflowPoiPlacementError} from '../src/modules/poi/placement';
import {compileRoads} from '../src/modules/roads/compiler';
import {compileTransit} from '../src/modules/transit/compiler';
import {compileVegetation} from '../src/modules/vegetation/compiler';
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

/** Compile against other data as a map does: through World names, lowered by the data's adapter. */
function compileThrough(
  data: ReturnType<typeof resolveTileflowData>,
  compile: (context: ReturnType<typeof contextWith>) => readonly TileflowLayerContribution[],
) {
  return assembleTileflowLayers(compile(contextWith(createSemanticDataView(data))), data);
}

function contextWith(data: ReturnType<typeof resolveTileflowData>) {
  return {...context, data};
}

const openMapTilesConstruction = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'path',
  'raceway',
].map((value) => `${value}_construction`);

/** The World road `class` the OpenMapTiles adapter reads from `class` and `subclass`. */
function openMapTilesRoadClass(classField: string, subclassField: string): unknown[] {
  return [
    'match',
    ['get', classField],
    'minor',
    'street',
    openMapTilesConstruction,
    'construction',
    'bus_guideway',
    'busway',
    'path',
    ['match', ['get', subclassField], 'pedestrian', 'pedestrian', 'path'],
    ['to-string', ['get', classField]],
  ];
}

/** The World road `type`: the subclass, or the class a road under construction becomes. */
function openMapTilesRoadType(classField: string, subclassField: string): unknown[] {
  return [
    'match',
    ['get', classField],
    openMapTilesConstruction,
    [
      'match',
      ['get', classField],
      'minor_construction',
      'street',
      [
        'slice',
        ['to-string', ['get', classField]],
        0,
        ['index-of', '_construction', ['get', classField]],
      ],
    ],
    ['get', subclassField],
  ];
}

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
  assert.ok(ids.includes('tileflow-activity-areas'));
  assert.ok(ids.includes('tileflow-water'));
  assert.ok(ids.includes('tileflow-waterway-river-intermittent'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(layers.every((layer) => !String(layer.id).startsWith('landuse-')));

  const commercial = layers.find((layer) => layer.id === 'tileflow-landuse-commercial');
  assert.equal(commercial?.['source-layer'], 'landuse');
  assert.deepEqual(commercial?.filter, [
    'match',
    ['get', 'class'],
    ['commercial', 'retail'],
    true,
    false,
  ]);
  // World's activity areas take their opacity from their activity level.
  const activity = layers.find((layer) => layer.id === 'tileflow-activity-areas');
  assert.equal(activity?.['source-layer'], 'landuse_overlay');
  assert.deepEqual(activity?.filter, ['==', ['get', 'class'], 'activity_area']);
  assert.deepEqual((activity?.paint as Record<string, unknown>)['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['to-number', ['coalesce', ['get', 'activity'], 1], 1],
    1,
    0.08,
    5,
    0.24,
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

  assert.equal(globalLandcover.layer['source-layer'], 'landcover');
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

test('land draws only the barriers a map styles, from the barrier layer, hedge areas as polygons', () => {
  const barriers = land({
    barriers: {
      fence: {line: {color: '#d9d9d9'}},
      hedge: {area: {color: '#90c58a'}, shadow: {color: '#6f9f69'}, line: {color: '#90c58a'}},
    },
  });
  const drawn = (module: Parameters<typeof compileLand>[0], data = context.data) =>
    assembleTileflowLayers(compileLand(module, {...context, data})).filter((layer) =>
      String(layer.id).startsWith('tileflow-barrier-'),
    );
  const layers = drawn(barriers);
  assert.deepEqual(
    layers.map((layer) => layer.id),
    [
      'tileflow-barrier-fence',
      'tileflow-barrier-hedge-area',
      'tileflow-barrier-hedge-shadow',
      'tileflow-barrier-hedge',
    ],
  );
  assert.ok(layers.every((layer) => layer['source-layer'] === 'traffic_control'));
  const matches = (id: string, type: 2 | 3, kind: string) =>
    featureFilter(layers.find((layer) => layer.id === id)?.filter as never).filter({zoom: 17}, {
      type,
      properties: {class: 'barrier', type: kind},
    } as never);
  assert.equal(matches('tileflow-barrier-hedge-area', 3, 'hedge'), true);
  assert.equal(matches('tileflow-barrier-hedge-area', 2, 'hedge'), false);
  assert.equal(matches('tileflow-barrier-hedge', 3, 'hedge'), true, 'an area hedge is outlined');
  assert.equal(matches('tileflow-barrier-fence', 2, 'hedge'), false);
  // No style draws no barrier, and neither does data without a barrier layer.
  assert.deepEqual(drawn(undefined), []);
  assert.deepEqual(
    drawn(
      barriers,
      resolveTileflowData(
        vectorTiles({attribution: 'Fixture', schema: openMapTiles(), url: '/t.json'}),
      ),
    ),
    [],
  );
});

test('draws global land cover only from data that has it', () => {
  // OpenMapTiles has no global land cover.
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({fields: {class: 'kind'}}),
    url: '/tiles.json',
  });
  assert.equal(
    compileLand(undefined, {...context, data}).some(
      (entry) => entry.layer.id === 'tileflow-global-landcover',
    ),
    false,
  );
  assert.equal(
    compileLand(undefined, context).some((entry) => entry.layer.id === 'tileflow-global-landcover'),
    true,
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
  assert.ok(ids.includes('tileflow-boundary-admin2'));
  assert.ok(ids.includes('tileflow-aeroway-runway-fill'));
  assert.ok(ids.includes('tileflow-transit-rail-surface'));
  assert.equal(new Set(ids).size, ids.length);
});

test('colors building tones and use classes without making geometry visibility semantic', () => {
  const contributions = compileBuildings(undefined, context);
  const buildings = contributions.find((entry) => entry.layer.id === 'tileflow-buildings-fill')!;
  const paint = buildings.layer.paint as Record<string, unknown>;

  assert.equal(buildings.layer['source-layer'], 'building');
  assert.deepEqual(buildings.layer.filter, ['>=', ['zoom'], 15]);
  assert.deepEqual(paint['fill-color'], [
    'case',
    ['==', ['coalesce', ['get', 'tone'], ''], 'active'],
    context.colors.buildings.active,
    ['==', ['coalesce', ['get', 'tone'], ''], 'destination'],
    context.colors.buildings.destination,
    ['==', ['coalesce', ['get', 'tone'], ''], 'commercial'],
    context.colors.buildings.commercial,
    [
      'match',
      ['coalesce', ['get', 'use'], ''],
      'residential',
      context.colors.buildings.residential,
      'commercial',
      context.colors.buildings.commercial,
      ['civic', 'education', 'entertainment', 'medical', 'military', 'religious', 'transportation'],
      context.colors.buildings.civic,
      ['agricultural', 'industrial', 'service'],
      context.colors.buildings.industrial,
      context.colors.buildings.generic,
    ],
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
  const request = roads({detail: 'all', extras: {paths: true}});
  const remapped = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({fields: {class: 'kind', subclass: 'kind_detail'}}),
    url: '/tiles.json',
  });
  const expectedTypes = {
    pathway: ['path', 'bridleway', 'corridor'],
    footway: ['footway'],
    cycleway: ['cycleway'],
    steps: ['steps'],
    pedestrian: ['pedestrian'],
  } as const;

  for (const {layers, roadClass, roadType, structureField} of [
    {
      layers: assembleTileflowLayers(compileRoads(request, context)),
      roadClass: ['get', 'class'],
      roadType: ['get', 'type'],
      structureField: 'structure',
    },
    {
      layers: compileThrough(remapped, (remappedContext) => compileRoads(request, remappedContext)),
      roadClass: openMapTilesRoadClass('kind', 'kind_detail'),
      roadType: openMapTilesRoadType('kind', 'kind_detail'),
      structureField: 'brunnel',
    },
  ]) {
    for (const [pathClass, types] of Object.entries(expectedTypes)) {
      for (const structure of ['surface', 'tunnel', 'bridge']) {
        const layer = layers.find(
          (entry) => entry.id === `tileflow-road-${structure}-${pathClass}-fill`,
        );
        assert.ok(layer, `${pathClass} ${structure} fill must exist`);
        assert.deepEqual(layer.filter, [
          'all',
          ['==', ['geometry-type'], 'LineString'],
          [
            'any',
            pathClass === 'pedestrian'
              ? ['match', roadClass, ['pedestrian'], true, false]
              : ['all', ['==', roadClass, 'path'], ['match', roadType, types, true, false]],
            ['all', ['==', roadClass, 'construction'], ['match', roadType, types, true, false]],
          ],
          structure === 'surface'
            ? ['match', ['get', structureField], ['tunnel', 'bridge'], false, true]
            : ['==', ['get', structureField], structure],
        ]);
      }
    }

    assert.equal(
      layers.some((entry) => entry.id.includes('-path-')),
      false,
      'the old overlapping path target must not be emitted',
    );
  }
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
  const layers = compileThrough(data, (remappedContext) =>
    compileRoads(
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
      remappedContext,
    ),
  );
  const primary = layers.find((layer) => layer.id === 'tileflow-road-surface-primary-fill')!;
  const service = layers.find((layer) => layer.id === 'tileflow-road-surface-service-fill')!;
  const primaryPaint = primary.paint as Record<string, unknown>;
  const serializedPrimary = JSON.stringify(primary);
  const serializedService = JSON.stringify(service);

  // OpenMapTiles' `primary_construction` reads as World's construction class.
  assert.match(serializedPrimary, /primary_construction/);
  assert.match(serializedPrimary, /ramp_flag/);
  assert.match(serializedPrimary, /pavement/);
  assert.match(serializedPrimary, /permission/);
  assert.match(serializedPrimary, /bike_permission/);
  assert.match(serializedService, /service_kind/);
  assert.match(serializedService, /driveway/);
  assert.deepEqual(primary.layout, {
    'line-sort-key': ['coalesce', ['get', 'stack_order'], ['get', 'floor_level'], 0],
    'line-cap': 'round',
    'line-join': 'round',
  });
  // OpenMapTiles' `ramp: 1` is World's `link: true`.
  assert.deepEqual(primaryPaint['line-width'], [
    'case',
    ['==', ['==', ['to-number', ['get', 'ramp_flag'], 0], 1], true],
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
    layers.filter((layer) => layer.id.startsWith(primary.id)).length,
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
                ['case', ['==', ['get', 'oneway'], true], 8, 12],
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
  assert.match(JSON.stringify(width), /"link"/);
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
    contextWith(createSemanticDataView(data)),
  );
  const layers = assembleTileflowLayers(contributions, data);
  const pedestrianArea = layers.find((layer) => layer.id === 'tileflow-road-pedestrian-area');
  const roadClass = openMapTilesRoadClass('kind', 'kind_detail');

  assert.ok(pedestrianArea);
  assert.deepEqual(pedestrianArea.filter, [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    [
      'any',
      ['match', roadClass, ['pedestrian'], true, false],
      [
        'all',
        ['==', roadClass, 'construction'],
        ['match', openMapTilesRoadType('kind', 'kind_detail'), ['pedestrian'], true, false],
      ],
    ],
  ]);
  assert.deepEqual(pedestrianArea.paint, {
    'fill-color': '#F1F3F5',
    'fill-opacity': 1,
  });
  const pedestrianOutline = layers.find(
    (layer) => layer.id === 'tileflow-road-pedestrian-area-outline',
  );
  assert.equal((pedestrianOutline?.paint as Record<string, unknown>)['line-color'], '#D5DCE3');
  assert.equal(
    layers.some((layer) => layer.id.includes('surface-pedestrian')),
    false,
  );
  assert.equal(
    contributions.find((entry) => entry.layer.id === 'tileflow-road-pedestrian-area')?.slot,
    'transport-areas',
  );
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
      styles: {'food-drink': {text: {color: '#AA4422'}}},
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
  // Coupled categories share one layer and importance order, retaining their label colors.
  assert.deepEqual(
    poiContributions.map((entry) => entry.layer.id),
    ['tileflow-poi'],
  );
  assert.equal(poiContributions[0]?.layer['source-layer'], 'poi_label');
  assert.match(JSON.stringify(poiContributions[0]?.layer.filter), /"filterrank"/);
  assert.match(JSON.stringify(poiContributions[0]?.layer.filter), /"sizerank"/);
  assert.deepEqual((poiContributions[0]?.layer.filter as unknown[])[1], [
    'match',
    ['get', 'class'],
    ['food-drink', 'transport'],
    true,
    false,
  ]);
  // The density threshold rises one rank at z16 and two from z17, past World's last POI zoom.
  assert.deepEqual((poiContributions[0]?.layer.filter as unknown[])[4], [
    '<=',
    ['to-number', ['get', 'filterrank'], 6],
    ['+', ['step', ['zoom'], 0, 16, 1, 17, 2], 3],
  ]);
  assert.deepEqual((poiContributions[0]?.layer.paint as Record<string, unknown>)['text-color'], [
    'match',
    ['get', 'class'],
    'transport',
    (context.colors.poi as Record<string, string>).label,
    '#AA4422',
  ]);
});

test('POI density shows more ranks as the camera passes World’s last POI zoom', () => {
  const [contribution] = compilePoi(
    poi({categories: ['food-drink'], density: 3, icons: true, labels: true}),
    context,
  );
  const filter = featureFilter(contribution?.layer.filter as never);
  const shownRanks = (zoom: number) =>
    [0, 1, 2, 3, 4, 5].filter((rank) =>
      filter.filter({zoom}, {
        type: 1,
        properties: {class: 'food-drink', filterrank: rank, name: 'Café', sizerank: 16},
      } as never),
    );
  assert.deepEqual(shownRanks(15), [0, 1, 2, 3]);
  assert.deepEqual(shownRanks(16), [0, 1, 2, 3, 4]);
  assert.deepEqual(shownRanks(17), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(shownRanks(19), [0, 1, 2, 3, 4, 5]);
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
  const marker = contributions.find((entry) => entry.layer.id === 'tileflow-poi-marker')?.layer;

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

  const types = new Set<string>();
  for (const roadClass of ['pedestrian', 'footway', 'cycleway', 'steps', 'pathway']) {
    const layer = labelContributions.find(
      (entry) => entry.layer.id === `tileflow-label-road-${roadClass}`,
    )?.layer;
    assert.ok(layer, `${roadClass} label must exist`);
    const serialized = JSON.stringify(layer.filter);
    assert.match(serialized, /"class"/);
    assert.match(serialized, /"type"/);
    for (const value of ['pedestrian', 'footway', 'cycleway', 'steps']) {
      if (serialized.includes(`"${value}"`)) types.add(value);
    }
  }
  assert.deepEqual([...types].sort(), ['cycleway', 'footway', 'pedestrian', 'steps']);
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

test('composes expressway, toll, indoor, and mountain-bike intelligence from bound data', () => {
  const data = resolveTileflowData({
    type: 'vector-tiles',
    attribution: '© Test',
    schema: openMapTiles({
      fields: {
        expressway: 'fast_flag',
        indoor: 'inside_flag',
        mtbScale: 'trail_grade',
        toll: 'paid_flag',
      },
    }),
    url: '/tiles.json',
  });
  const request = roads({
    detail: 'all',
    extras: {paths: true},
    modifiers: {
      expressway: {surface: {fill: {color: '#112233'}}},
      indoor: {surface: {fill: {opacity: 0.35}}},
    },
    mountainBike: {
      '0': {surface: {fill: {color: '#55AA66'}}},
      '3+': {surface: {fill: {color: '#AA5544'}}},
    },
    restrictions: {toll: {surface: {fill: {dash: [3, 1]}}}},
  });
  const layers = compileThrough(data, (remappedContext) => compileRoads(request, remappedContext));
  const serialized = (id: string) => JSON.stringify(layers.find((layer) => layer.id === id));
  const primary = serialized('tileflow-road-surface-primary-fill');
  const pathway = serialized('tileflow-road-surface-pathway-fill');

  assert.match(primary, /fast_flag/);
  assert.match(primary, /paid_flag/);
  assert.match(primary, /inside_flag/);
  assert.match(pathway, /trail_grade/);
  assert.match(pathway, /3\+/);
  assert.equal(
    layers.filter((layer) => layer.id.startsWith('tileflow-road-surface-primary-fill')).length,
    1,
  );
});

test('compiles global road-shield phases and allowlisted visuals without raw IDs', () => {
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
    context,
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

  assert.equal(overview?.['source-layer'], 'road_shield');
  assert.equal(detail?.['source-layer'], 'road_label');
  assert.equal(overview?.minzoom, 6);
  assert.equal(overview?.maxzoom, 11);
  assert.equal(detail?.minzoom, 11);
  assert.match(JSON.stringify(overview?.filter), /Point/);
  assert.match(
    JSON.stringify(overview?.filter),
    /\[">=",\["to-number",\["get","reflen"\],0\],1\]/u,
  );
  assert.doesNotMatch(
    JSON.stringify(overview?.filter),
    /\[">=",\["to-number",\["get","reflen"\],0\],2\]/u,
  );
  assert.match(JSON.stringify(detail?.filter), /LineString/);
  assert.match(JSON.stringify(overview?.filter), /"shield_kind"/);
  assert.match(JSON.stringify(detail?.filter), /"reflen"/);
  assert.match(JSON.stringify(detail?.filter), /"shield_line_length_m"/);
  assert.match(JSON.stringify(detail?.layout), /"shield_text"/);
  assert.match(JSON.stringify(detail?.layout?.['symbol-sort-key']), /shield_rank/);
  assert.match(JSON.stringify(detail?.layout?.['icon-image']), /route-shield-blue/);
  assert.match(JSON.stringify(detail?.layout?.['icon-image']), /"shield_kind"/);
  assert.match(JSON.stringify(detail?.paint?.['text-color']), /"shield_text_color"/);
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
  assert.match(JSON.stringify(junction?.filter), /\["get","type"\],"junction"/);
  assert.equal((junction?.paint as Record<string, unknown>)['text-color'], '#556677');
});

test('road names, shields and junctions draw above ground layers under every collision policy', () => {
  const routeReferences = [
    'tileflow-label-road-shield-overview',
    'tileflow-label-road-shield-detail',
    'tileflow-label-road-junction',
  ];
  const layerIds = (collisionPriority: 'balanced' | 'navigation') =>
    assembleTileflowLayers([
      ...compileBoundaries(undefined, context),
      ...compileBuildings(undefined, context),
      ...compileVegetation(undefined, context),
      ...compileLabels(
        labels({collisionPriority, junctions: true, roads: 'all', shields: 'all'}),
        roads({detail: 'all'}),
        context,
      ),
    ]).map((layer) => String(layer.id));
  const isRoadName = (id: string) =>
    id.startsWith('tileflow-label-road-') && !routeReferences.includes(id);

  for (const collisionPriority of ['balanced', 'navigation'] as const) {
    const ids = layerIds(collisionPriority);
    const groundEnd = ids.findLastIndex((id) =>
      /^tileflow-(boundar|building|vegetation)/u.test(id),
    );
    const roadNames = ids.filter(isRoadName);
    assert.ok(ids.includes('tileflow-vegetation-trees'));
    assert.ok(roadNames.includes('tileflow-label-road-primary'));
    for (const id of [...roadNames, ...routeReferences]) {
      assert.ok(ids.indexOf(id) > groundEnd, `${collisionPriority}: ${id} draws under ground`);
    }
  }

  // Route references and place names preserve orientation in both collision policies.
  for (const policy of ['balanced', 'navigation'] as const) {
    const ids = layerIds(policy);
    for (const ref of routeReferences) {
      assert.ok(ids.indexOf(ref) > ids.indexOf('tileflow-label-road-primary'));
      assert.ok(ids.indexOf(ref) < ids.indexOf('tileflow-label-place-city'));
    }
  }
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
    poi({
      categories: ['food-drink'],
      density: 5,
      icons: true,
      labels: true,
      placement: {coupleIconAndLabel: false},
    }),
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
    ['tileflow-poi-icon', 'tileflow-poi-label'],
  );
  assert.match(JSON.stringify(uncoupled[0]?.layer.filter), /"filterrank"/);
  assert.match(JSON.stringify(uncoupled[0]?.layer.filter), /,5\]/);
  assert.deepEqual(
    coupled.map((entry) => entry.layer.id),
    ['tileflow-poi'],
  );
  assert.match(JSON.stringify(coupled[0]?.layer.filter), /,3\]/);

  const labelsOnly = compilePoi(
    poi({categories: ['food-drink'], density: 1, icons: false, labels: true}),
    context,
  );
  assert.deepEqual(
    labelsOnly.map((entry) => entry.layer.id),
    ['tileflow-poi-label'],
  );
  assert.match(JSON.stringify(labelsOnly[0]?.layer.filter), /,1\]/);
});

test('POI categories with their own zoom ranges need the category placement order', () => {
  const request = poi({
    categories: ['arts-entertainment', 'food-drink'],
    icons: false,
    labels: true,
    minZoom: 12.5,
    styles: {
      'arts-entertainment': {marker: {radius: 3}, minZoom: 12.5},
      'food-drink': {marker: {radius: 3}, minZoom: 15.5},
    },
  });
  // One importance order means one layer, and a MapLibre layer has one zoom range.
  assert.throws(
    () => compilePoi(request, context),
    (error: unknown) =>
      error instanceof TileflowPoiPlacementError &&
      /minzoom/u.test(error.message) &&
      /placement\.order/u.test(error.message),
  );

  const contributions = compilePoi({...request, placement: {order: 'categories'}}, context);
  const culture = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-arts-entertainment-label',
  );
  const food = contributions.find((entry) => entry.layer.id === 'tileflow-poi-food-drink-label');
  const cultureMarker = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-arts-entertainment-marker',
  )?.layer;
  const foodMarker = contributions.find(
    (entry) => entry.layer.id === 'tileflow-poi-food-drink-marker',
  )?.layer;

  assert.equal(culture?.layer.minzoom, 12.5);
  assert.equal(food?.layer.minzoom, 15.5);
  assert.equal(cultureMarker?.minzoom, 12.5);
  assert.equal(foodMarker?.minzoom, 15.5);
  // The first category listed is drawn on top, so MapLibre places it first.
  assert.ok(culture!.localOrder > food!.localOrder);
});

test('POI categories are exact World classes and never fall back to the OSM type', () => {
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

  // World's POI `class` is the Tileflow category; the OSM value is its `type`.
  assert.deepEqual((contributions[0]?.layer.filter as unknown[])[1], [
    '==',
    ['get', 'class'],
    'transport',
  ]);
  assert.doesNotMatch(serializedFilter, /"type"|"subclass"|"category"|"rank"/u);
});

test('POI placement orders by filter rank and then physical size rank', () => {
  const [layer] = compilePoi(
    poi({categories: ['landmark'], density: 4, icons: true, labels: false}),
    context,
  );

  assert.deepEqual(layer?.layer.layout?.['symbol-sort-key'], [
    '+',
    ['*', ['to-number', ['get', 'filterrank'], 6], 17],
    ['to-number', ['get', 'sizerank'], 17],
  ]);
  assert.match(JSON.stringify(layer?.layer.layout?.['icon-image']), /"icon"/u);
  assert.match(JSON.stringify(layer?.layer.layout?.['icon-image']), /"culture"/u);
});
