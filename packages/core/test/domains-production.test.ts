import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aeroways,
  openMapTiles,
  resolveTileflowData,
  tileflowWorldV1Schema,
  vectorTiles,
  vegetation,
  water,
} from '../src';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {assembleTileflowLayers} from '../src/cartography/graph';
import {compileAeroways} from '../src/modules/aeroways/compiler';
import {compileBoundaries} from '../src/modules/boundaries/compiler';
import {compileBuildings} from '../src/modules/buildings/compiler';
import {compileLand} from '../src/modules/land/compiler';
import {compileTransit} from '../src/modules/transit/compiler';
import {compileVegetation} from '../src/modules/vegetation/compiler';
import {compileWater} from '../src/modules/water/compiler';
import {resolveColors} from '../src/themes';

const context = {
  colors: resolveColors(),
  data: resolveTileflowData(undefined),
  typography: {
    font: 'Noto Sans Regular',
    places: {font: 'Noto Sans Bold'},
    roads: {font: 'Noto Sans Regular'},
    water: {font: 'Noto Sans Regular'},
    poi: {font: 'Noto Sans Regular'},
  },
};

test('park source semantics keep protected areas and urban parks disjoint', () => {
  const mixedData = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {class: 'kind'}, layers: {park: 'protected_and_parks'}}),
      url: '/tiles.json',
    }),
  );
  const mixed = compileLand(undefined, {...context, data: mixedData});
  const legacyPark = contribution(mixed, 'streets-landcover-legacy-park');
  const mixedProtected = contribution(mixed, 'streets-landcover-protected');
  const urbanPark = contribution(mixed, 'streets-landcover-urbanPark');

  assert.equal(legacyPark.layer['source-layer'], 'protected_and_parks');
  assert.equal(mixedProtected.layer['source-layer'], 'protected_and_parks');
  assert.equal(urbanPark.layer['source-layer'], 'landcover');
  assert.equal(matches(legacyPark.layer.filter, {kind: 'protected_area'}), false);
  assert.equal(matches(mixedProtected.layer.filter, {kind: 'protected_area'}), true);
  assert.equal(matches(legacyPark.layer.filter, {kind: 'park'}), true);
  assert.equal(matches(urbanPark.layer.filter, {kind: 'grass', subclass: 'park'}), true);
  assertValid(mixed);

  const protectedOnlyData = resolveTileflowData(
    vectorTiles({
      attribution: '© Tileflow fixture',
      schema: tileflowWorldV1Schema({layers: {park: 'protected_only'}}),
      url: '/world-v1.json',
    }),
  );
  const protectedOnly = compileLand(undefined, {...context, data: protectedOnlyData});
  const protectedArea = contribution(protectedOnly, 'streets-landcover-protected');
  assert.equal(protectedArea.layer['source-layer'], 'protected_only');
  assert.equal(protectedArea.layer.filter, undefined);
  assert.equal(
    protectedOnly.some(({layer}) => layer.id === 'streets-landcover-legacy-park'),
    false,
  );
  assertValid(protectedOnly);
});

test('every typed grass subclass selects exactly one landcover fill', () => {
  const contributions = compileLand(undefined, context);
  const ids = [
    'streets-landcover-grass',
    'streets-landcover-scrub',
    'streets-landcover-meadow',
    'streets-landcover-urbanPark',
    'streets-landcover-recreationGround',
    'streets-landcover-villageGreen',
    'streets-landcover-flowerbed',
  ];
  const layers = ids.map((id) => contribution(contributions, id).layer);
  for (const subclass of [
    undefined,
    'scrub',
    'meadow',
    'park',
    'garden',
    'recreation_ground',
    'village_green',
    'flowerbed',
  ]) {
    const properties = {class: 'grass', ...(subclass ? {subclass} : {})};
    const selected = layers.filter(({filter}) => matches(filter, properties));
    assert.equal(selected.length, 1, `${subclass ?? 'plain grass'} must select exactly one fill`);
  }
});

test('transit modes are disjoint and funiculars remain rail', () => {
  const contributions = compileTransit(undefined, context);
  const ferry = contribution(contributions, 'streets-transit-ferry');
  const cableway = contribution(contributions, 'streets-transit-cableway');
  const rail = contribution(contributions, 'streets-transit-rail-surface');
  const railHatching = contribution(contributions, 'streets-transit-rail-hatching-surface');
  const serviceRail = contribution(contributions, 'streets-transit-service-rail-surface');

  const funicular = {class: 'transit', subclass: 'funicular'};
  assert.equal(matches(ferry.layer.filter, funicular), false);
  assert.equal(matches(cableway.layer.filter, funicular), false);
  assert.equal(matches(rail.layer.filter, funicular), true);

  const gondola = {class: 'transit', subclass: 'gondola'};
  assert.equal(matches(cableway.layer.filter, gondola), true);
  assert.equal(matches(rail.layer.filter, gondola), false);

  for (const mode of ['light_rail', 'monorail', 'subway', 'tram']) {
    assert.equal(matches(rail.layer.filter, {class: mode}), true, `${mode} should map to rail`);
    assert.equal(matches(cableway.layer.filter, {class: mode}), false);
  }

  const tramService = {class: 'transit', service: 'yard', subclass: 'tram'};
  assert.equal(matches(rail.layer.filter, tramService), false);
  assert.equal(matches(serviceRail.layer.filter, tramService), true);
  assert.equal(matches(railHatching.layer.filter, tramService), true);
  assert.ok(serviceRail.localOrder < railHatching.localOrder);
  assertValid(contributions);
});

test('disputed maritime boundaries retain both strokes with disputed priority', () => {
  const contributions = compileBoundaries(undefined, context);
  const maritime = contribution(contributions, 'streets-boundary-maritime');
  const disputed = contribution(contributions, 'streets-boundary-disputed');
  const combined = contribution(contributions, 'streets-boundary-disputed-maritime');
  const both = {admin_level: 2, disputed: 1, maritime: 1};

  assert.equal(matches(maritime.layer.filter, both), true);
  assert.equal(matches(disputed.layer.filter, both), false);
  assert.equal(matches(combined.layer.filter, both), true);
  assert.ok(maritime.localOrder < combined.localOrder);
  assert.equal(matches(disputed.layer.filter, {...both, maritime: 0}), true);
  assert.equal(matches(combined.layer.filter, {...both, maritime: 0}), false);
  assertValid(contributions);
});

test('water consumes remapped bathymetry capability and omits it when absent', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        capabilities: {bathymetry: true},
        fields: {bathymetryMinDepth: 'depth_floor', bathymetrySortKey: 'depth_order'},
        layers: {bathymetry: 'depth_bands'},
      }),
      url: '/tiles.json',
    }),
  );
  const contributions = compileWater(water({bathymetryContours: {}, bathymetryLabels: {}}), {
    ...context,
    data,
  });
  const bathymetry = contribution(contributions, 'streets-bathymetry');
  const bathymetryContours = contribution(contributions, 'streets-bathymetry-contours');
  const bathymetryLabels = contribution(contributions, 'streets-bathymetry-labels');

  assert.equal(bathymetry.layer['source-layer'], 'depth_bands');
  assert.equal(bathymetry.layer.maxzoom, 10);
  assert.match(JSON.stringify(bathymetry.layer.layout), /depth_order/);
  assert.match(JSON.stringify(bathymetry.layer.paint), /depth_floor/);
  assert.equal(bathymetryContours.layer['source-layer'], 'depth_bands');
  assert.match(JSON.stringify(bathymetryContours.layer.filter), /depth_floor/);
  assert.equal(
    (bathymetryContours.layer.paint as Record<string, unknown>)['line-color'],
    context.colors.hydro.label,
  );
  assert.equal(bathymetryContours.slot, 'hydro');
  assert.equal(bathymetryContours.target, 'water.bathymetryContours');
  assert.equal(bathymetryLabels.layer['source-layer'], 'depth_bands');
  assert.equal(bathymetryLabels.layer.minzoom, 3);
  assert.equal(bathymetryLabels.layer.maxzoom, 10);
  assert.deepEqual((bathymetryLabels.layer.layout as Record<string, unknown>)['text-field'], [
    'to-string',
    ['abs', ['to-number', ['get', 'depth_floor'], 0]],
  ]);
  assert.equal(
    (bathymetryLabels.layer.paint as Record<string, unknown>)['text-color'],
    context.colors.hydro.label,
  );
  assert.equal(bathymetryLabels.slot, 'symbols');
  assert.equal(bathymetryLabels.target, 'water.bathymetryLabels');
  assertValid(contributions);
  assert.equal(
    compileWater(undefined, {...context, data}).some(
      ({layer}) => layer.id === 'streets-bathymetry-labels',
    ),
    false,
  );
  assert.equal(
    compileWater(undefined, {...context, data}).some(
      ({layer}) => layer.id === 'streets-bathymetry-contours',
    ),
    false,
  );

  const portableData = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const portable = compileWater(water({bathymetryContours: {}, bathymetryLabels: {}}), {
    ...context,
    data: portableData,
  });
  assert.equal(
    portable.some(({layer}) => layer.id === 'streets-bathymetry'),
    false,
  );
  assert.equal(
    portable.some(({layer}) => layer.id === 'streets-bathymetry-labels'),
    false,
  );
  assert.equal(
    portable.some(({layer}) => layer.id === 'streets-bathymetry-contours'),
    false,
  );
});

test('3D vegetation keeps a portable styled fallback and exposes runtime parameters', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const portable = contribution(
    compileVegetation(
      vegetation({
        flat: {color: '#123456', opacity: 0.74},
        mode: '3d',
        threeDimensional: {
          barkColor: '#654321',
          broadleafColors: ['#112233'],
          coniferColors: ['#334455'],
          crownScale: 1.2,
          heightScale: 1.4,
        },
      }),
      {...context, data},
    ),
    'streets-vegetation-trees',
  );
  const hosted = contribution(
    compileVegetation(vegetation({mode: '3d'}), context),
    'streets-vegetation-trees',
  );

  assert.equal(portable.layer.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(portable.layer.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');
  assert.equal(portable.layer.metadata?.['tileflow:tree-bark-color'], '#654321');
  assert.deepEqual(portable.layer.metadata?.['tileflow:tree-broadleaf-colors'], ['#112233']);
  assert.deepEqual(portable.layer.metadata?.['tileflow:tree-conifer-colors'], ['#334455']);
  assert.equal(portable.layer.metadata?.['tileflow:tree-crown-scale'], 1.2);
  assert.equal(portable.layer.metadata?.['tileflow:tree-height-scale'], 1.4);
  assert.equal((portable.layer.paint as Record<string, unknown>)['circle-color'], '#123456');
  assert.equal((portable.layer.paint as Record<string, unknown>)['circle-opacity'], 0.74);
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-fallback'], 'flat-circle');
  assertValid([portable]);
  assertValid([hosted]);
});

test('current building tones use bound fields and the available semantic theme colors', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {
          buildingKind: 'legacy_kind',
          buildingTone: 'tone',
          hasBusiness: 'legacy_business',
        },
      }),
      url: '/tiles.json',
    }),
  );
  const buildings = contribution(
    compileBuildings(undefined, {...context, data}),
    'streets-buildings-fill',
  );
  const color = JSON.stringify((buildings.layer.paint as Record<string, unknown>)['fill-color']);

  for (const tone of ['active', 'commercial', 'destination']) assert.match(color, new RegExp(tone));
  assert.match(color, /tone/);
  assert.match(color, /legacy_kind/);
  assert.match(color, /legacy_business/);
  assertValid([buildings]);
});

test('aeroways render bound runway references as high-zoom shared-typography symbols', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({
        fields: {class: 'kind', ref: 'runway_designator'},
        layers: {aeroway: 'airport_geometry'},
      }),
      url: '/tiles.json',
    }),
  );
  const contributions = compileAeroways(aeroways({runwayRef: {text: {size: 12}}}), {
    ...context,
    data,
  });
  const runwayRef = contribution(contributions, 'streets-aeroway-runway-ref');
  const layout = runwayRef.layer.layout as Record<string, unknown>;

  assert.equal(runwayRef.layer['source-layer'], 'airport_geometry');
  assert.equal(runwayRef.layer.minzoom, 14);
  assert.equal(runwayRef.slot, 'symbols');
  assert.equal(runwayRef.localOrder, 650);
  assert.equal(runwayRef.target, 'aeroways.runwayRef');
  assert.equal(layout['symbol-placement'], 'line-center');
  assert.deepEqual(layout['text-field'], ['to-string', ['get', 'runway_designator']]);
  assert.deepEqual(layout['text-font'], ['Noto Sans Regular']);
  assert.equal(layout['text-size'], 12);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'runway', runway_designator: '09/27'}), true);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'taxiway', runway_designator: 'A'}), false);
  assert.equal(matches(runwayRef.layer.filter, {kind: 'runway'}), false);
  assertValid(contributions);
});

test('the combined production domain output remains MapLibre-valid', () => {
  assertValid([
    ...compileLand(undefined, context),
    ...compileWater(undefined, context),
    ...compileBuildings(undefined, context),
    ...compileVegetation(vegetation({mode: '3d'}), context),
    ...compileTransit(undefined, context),
    ...compileAeroways(undefined, context),
    ...compileBoundaries(undefined, context),
  ]);
});

function contribution(
  contributions: readonly TileflowLayerContribution[],
  id: string,
): TileflowLayerContribution {
  const result = contributions.find(({layer}) => layer.id === id);
  assert.ok(result, `Missing ${id}`);
  return result;
}

function assertValid(contributions: readonly TileflowLayerContribution[]): void {
  const style = {
    version: 8 as const,
    glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    sources: {tileflow: {type: 'vector' as const, url: 'https://example.test/tiles.json'}},
    layers: assembleTileflowLayers(contributions),
  };
  assert.deepEqual(validateStyleMin(style), []);
}

function matches(filter: unknown, properties: Record<string, unknown>): boolean {
  return Boolean(evaluate(filter, properties));
}

function evaluate(value: unknown, properties: Record<string, unknown>): unknown {
  if (!Array.isArray(value)) return value;
  const [operator, ...args] = value;
  switch (operator) {
    case '!':
      return !evaluate(args[0], properties);
    case '!=':
      return evaluate(args[0], properties) !== evaluate(args[1], properties);
    case '==':
      return evaluate(args[0], properties) === evaluate(args[1], properties);
    case '>=':
      return Number(evaluate(args[0], properties)) >= Number(evaluate(args[1], properties));
    case 'all':
      return args.every((entry) => Boolean(evaluate(entry, properties)));
    case 'any':
      return args.some((entry) => Boolean(evaluate(entry, properties)));
    case 'geometry-type':
      return 'LineString';
    case 'get':
      return properties[String(args[0])];
    case 'has':
      return Object.prototype.hasOwnProperty.call(properties, String(args[0]));
    case 'match': {
      const input = evaluate(args[0], properties);
      const labels = args[1];
      const matched = Array.isArray(labels) ? labels.includes(input) : labels === input;
      return evaluate(matched ? args[2] : args[3], properties);
    }
    case 'to-number': {
      for (const candidate of args) {
        const number = Number(evaluate(candidate, properties));
        if (Number.isFinite(number)) return number;
      }
      return 0;
    }
    case 'zoom':
      return 16;
    default:
      throw new Error(`Unsupported test expression operator: ${String(operator)}`);
  }
}
