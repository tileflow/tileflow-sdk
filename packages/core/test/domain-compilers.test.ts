import assert from 'node:assert/strict';
import test from 'node:test';
import {labels, openMapTiles, poi, resolveTileflowData, roads, water, zoom} from '../src';
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
  assert.ok(ids.includes('streets-landuse-commercial'));
  assert.ok(ids.includes('streets-landcover-wood'));
  assert.ok(ids.includes('streets-water'));
  assert.ok(ids.includes('streets-waterway-river-intermittent'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(layers.every((layer) => !String(layer.id).startsWith('landuse-')));
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
  assert.ok(ids.includes('streets-transit-rail'));
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
        },
      },
    }),
    context,
  );
  const ids = contributions.map((entry) => entry.layer.id);
  const primary = contributions.find(
    (entry) => entry.layer.id === 'streets-road-surface-primary-fill',
  )!;

  assert.ok(ids.includes('streets-road-tunnel-motorway-fill'));
  assert.ok(ids.includes('streets-road-bridge-primary-casing'));
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
          ['==', ['get', 'kind'], 'path'],
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

test('coordinates label eligibility with roads and compiles exact label and POI styles', () => {
  const labelContributions = compileLabels(
    labels({
      roads: 'all',
      styles: {roads: {primary: {color: '#112233', size: 15}}},
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
  assert.match(JSON.stringify(poiContributions[1]?.layer.filter), /24/);
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
});
