import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {aeroways, openMapTiles, resolveTileflowData, vectorTiles, vegetation} from '../src';
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
    font: 'Noto Sans',
    fontFamily: 'Noto Sans',
    weight: 'regular' as const,
    places: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'bold' as const},
    roads: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    water: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
    poi: {font: 'Noto Sans', fontFamily: 'Noto Sans', weight: 'regular' as const},
  },
};

test('parks and protected areas share the bound OMT park layer without overlap', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles({fields: {class: 'kind'}, layers: {park: 'protected_and_parks'}}),
      url: '/tiles.json',
    }),
  );
  const contributions = compileLand(undefined, {...context, data});
  const park = contribution(contributions, 'streets-landcover-park');
  const protectedArea = contribution(contributions, 'streets-landcover-protected');

  assert.equal(park.layer['source-layer'], 'protected_and_parks');
  assert.equal(protectedArea.layer['source-layer'], 'protected_and_parks');
  assert.equal(matches(park.layer.filter, {kind: 'protected_area'}), false);
  assert.equal(matches(protectedArea.layer.filter, {kind: 'protected_area'}), true);
  assert.equal(matches(park.layer.filter, {kind: 'park'}), true);
  assert.equal(matches(protectedArea.layer.filter, {kind: 'park'}), false);
  assertValid(contributions);
});

test('transit modes are disjoint and funiculars remain rail', () => {
  const contributions = compileTransit(undefined, context);
  const ferry = contribution(contributions, 'streets-transit-ferry');
  const cableway = contribution(contributions, 'streets-transit-cableway');
  const rail = contribution(contributions, 'streets-transit-rail-surface');
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
  const contributions = compileWater(undefined, {...context, data});
  const bathymetry = contribution(contributions, 'streets-bathymetry');

  assert.equal(bathymetry.layer['source-layer'], 'depth_bands');
  assert.equal(bathymetry.layer.maxzoom, 10);
  assert.match(JSON.stringify(bathymetry.layer.layout), /depth_order/);
  assert.match(JSON.stringify(bathymetry.layer.paint), /depth_floor/);
  assertValid(contributions);

  const portableData = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  assert.equal(
    compileWater(undefined, {...context, data: portableData}).some(
      ({layer}) => layer.id === 'streets-bathymetry',
    ),
    false,
  );
});

test('portable vegetation reports its flat fallback instead of promising 3D', () => {
  const data = resolveTileflowData(
    vectorTiles({
      attribution: '© Test',
      schema: openMapTiles(),
      url: '/tiles.json',
    }),
  );
  const portable = contribution(
    compileVegetation(vegetation({mode: '3d'}), {...context, data}),
    'streets-vegetation-trees',
  );
  const hosted = contribution(
    compileVegetation(vegetation({mode: '3d'}), context),
    'streets-vegetation-trees',
  );

  assert.equal(portable.layer.metadata?.['tileflow:vegetation-mode'], 'flat');
  assert.equal(portable.layer.metadata?.['tileflow:vegetation-fallback'], 'portable-flat');
  assert.equal((portable.layer.paint as Record<string, unknown>)['circle-opacity'], 0.9);
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-mode'], '3d');
  assert.equal(hosted.layer.metadata?.['tileflow:vegetation-fallback'], undefined);
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
