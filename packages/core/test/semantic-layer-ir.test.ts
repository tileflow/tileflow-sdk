import assert from 'node:assert/strict';
import test from 'node:test';
import {openMapTiles, resolveTileflowData, vectorTiles} from '../src';
import type {TileflowLayerContribution} from '../src/cartography/contributions';
import {
  createTileflowLayerFamilyIR,
  lowerTileflowDomainIR,
  physicalLayerIdForSemanticKey,
  type TileflowLayerFamilyIR,
} from '../src/cartography/domain-ir';
import {planTileflowLayerFamilies} from '../src/cartography/physical-planner';
import {createSemanticDataView, dataLayer, field} from '../src/cartography/semantic-bindings';

const data = resolveTileflowData(
  vectorTiles({
    attribution: 'Semantic IR fixture',
    schema: openMapTiles({fields: {class: 'kind'}, layers: {road: 'roads_v2'}}),
    url: 'https://example.test/semantic-ir.json',
  }),
);
const semanticData = createSemanticDataView(data);

test('keeps physical Style keys and data bindings out of LayerFamilyIR until final lowering', () => {
  const family = createTileflowLayerFamilyIR(roadContribution('motorway', 'logical-a'));
  const forbidden = new Set([
    'filter',
    'id',
    'layout',
    'metadata',
    'paint',
    'source',
    'source-layer',
    'type',
  ]);
  visitKeys(family, (key) => assert.equal(forbidden.has(key), false, `physical key ${key}`));
  visitStrings(family, (value) =>
    assert.notEqual(value, 'logical-a', `physical identifier ${value}`),
  );
  assert.match(JSON.stringify(family), /tileflow-data-layer/u);
  assert.match(JSON.stringify(family), /tileflow-data-field/u);

  const [layer] = lowerTileflowDomainIR([family], data).layers;
  assert.equal(layer?.id, 'tileflow-road-surface-motorway-fill');
  assert.equal(layer?.type, 'line');
  assert.equal(layer?.source, data.sourceId);
  assert.equal(layer?.['source-layer'], 'roads_v2');
  assert.match(JSON.stringify(layer?.filter), /"get","kind"/u);
});

test('plans only explicit families, ignores target spelling, and preserves every origin', () => {
  const first = createTileflowLayerFamilyIR(roadContribution('motorway', 'arbitrary-a'));
  const second = createTileflowLayerFamilyIR(roadContribution('trunk', 'arbitrary-b'));
  const renamed: TileflowLayerFamilyIR[] = [
    {...first, target: 'roads.renamed.first'},
    {...second, target: 'roads.renamed.second'},
  ];
  const planned = planTileflowLayerFamilies(renamed);
  visitStrings(planned, (value) =>
    assert.equal(
      value === 'arbitrary-a' || value === 'arbitrary-b',
      false,
      `physical identifier ${value}`,
    ),
  );
  const cohort = planned.find(({key}) => key === 'roads.cohorts.surface.major.fill');
  assert.ok(cohort);
  assert.deepEqual(
    cohort.origins.map(({target}) => target),
    [first.target, second.target],
  );
  assert.equal(Object.hasOwn(cohort, 'id'), false);
  assert.equal(
    lowerTileflowDomainIR(planned, data).layers.some(
      ({id}) => id === 'tileflow-road-surface-highzoom-major-fill',
    ),
    true,
  );

  const withoutFamily = renamed.map(({family: _family, ...entry}) => entry);
  assert.equal(planTileflowLayerFamilies(withoutFamily).length, 2);
});

test('binds closed semantic keys to the existing physical ID contract only at lowering', () => {
  const bindings = {
    'addresses.labels': 'tileflow-addresses-labels',
    'aeroways.area.outline': 'tileflow-aeroway-area-outline',
    'aeroways.runway.fill': 'tileflow-aeroway-runway-fill',
    'boundaries.disputed.maritime': 'tileflow-boundary-disputed-maritime',
    'buildings.businessCorridor.fill': 'tileflow-business-corridor',
    'buildings.extrusion': 'tileflow-buildings-3d',
    'labels.cohorts.roads.cohort2': 'tileflow-label-road-cohort-2',
    'labels.places.city': 'tileflow-label-place-city',
    'labels.shields.detail': 'tileflow-label-road-shield-detail',
    'land.cohorts.landcover': 'tileflow-landcover',
    'land.cohorts.landuse.cohort1': 'tileflow-landuse-1',
    'land.compatibility.legacyPark.outline': 'tileflow-landcover-legacy-park-outline',
    'land.landcover.wood.fill': 'tileflow-landcover-wood',
    'landforms.classes.volcano': 'tileflow-landform-volcano',
    'nautical.coverage.outline': 'tileflow-nautical-coverage-outline',
    'nautical.labels.navigationAreas': 'tileflow-nautical-navigation-area-labels',
    'nautical.lighthouses.marker': 'tileflow-nautical-lighthouses-marker',
    'nautical.lighthouses.symbol': 'tileflow-nautical-lighthouses',
    'poi.food-drink.label': 'tileflow-poi-food-drink-label',
    'roads.areas.pedestrian.outline': 'tileflow-road-pedestrian-area-outline',
    'roads.classes.primary.bridge.casing': 'tileflow-road-bridge-primary-casing',
    'roads.cohorts.surface.hatch': 'tileflow-road-surface-hatch',
    'roads.cohorts.surface.major.fill': 'tileflow-road-surface-highzoom-major-fill',
    'roads.roundabouts.fill': 'tileflow-road-circular-fill',
    'terrain.contours.labels': 'tileflow-terrain-contour-labels',
    'transit.service-rail.bridge': 'tileflow-transit-service-rail-bridge',
    'vegetation.trees': 'tileflow-vegetation-trees',
    'water.bathymetryRelief.hillshade': 'tileflow-bathymetry-relief',
    'water.intermittent.bodies.outline': 'tileflow-water-intermittent-outline',
    'water.intermittent.waterways.stream': 'tileflow-waterway-stream-intermittent',
    'water.render.foam.overlay': 'tileflow-water-render-foam-overlay',
  } as const;

  for (const [semanticKey, physicalId] of Object.entries(bindings)) {
    assert.equal(physicalLayerIdForSemanticKey(semanticKey), physicalId, semanticKey);
  }
  assert.throws(
    () => physicalLayerIdForSemanticKey('custom.unregistered'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'TILEFLOW_DOMAIN_IR_UNKNOWN_PHYSICAL_KEY',
  );
});

function roadContribution(roadClass: 'motorway' | 'trunk', id: string): TileflowLayerContribution {
  return {
    family: {
      group: `surface:fill:major`,
      kind: 'road-line',
      member: roadClass,
      outputKey: 'roads.cohorts.surface.major.fill',
    },
    kind: 'layer',
    layer: {
      id,
      type: 'line',
      source: semanticData.sourceId,
      'source-layer': dataLayer('road'),
      filter: ['==', ['get', field('class')], roadClass],
      minzoom: 5,
      paint: {'line-color': '#ffffff', 'line-width': roadClass === 'motorway' ? 8 : 6},
    },
    localOrder: roadClass === 'motorway' ? 10 : 20,
    owner: 'roads',
    slot: 'transport-surface-fill',
    target: `roads.classes.${roadClass}.surface.fill`,
  };
}

function visitStrings(
  value: unknown,
  visitor: (value: string) => void,
  visited = new WeakSet<object>(),
): void {
  if (typeof value === 'string') {
    visitor(value);
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    visitStrings(child, visitor, visited);
  }
}

function visitKeys(
  value: unknown,
  visitor: (key: string) => void,
  visited = new WeakSet<object>(),
): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const child of value) visitKeys(child, visitor, visited);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(key);
    visitKeys(child, visitor, visited);
  }
}
