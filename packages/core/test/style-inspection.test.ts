import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  disable,
  fixed,
  land,
  parseTileflowMap,
  refineRenderTarget,
  renderPass,
  roads,
  withRenderStack,
} from '../src';
import {
  createManifest,
  createStyleFromCatalogWithInspection,
  createStylesFromCatalogWithInspection,
  createStyleWithInspection,
  tileflowStyleInspectionSchemaVersion,
} from '../src/build';
import {tileflowCompilerProvenanceMetadataKey} from '../src/cartography/compiler-inspection';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {extendStreets} from './map-fixture';

function inspectionMap() {
  const target = 'land.render.inspectionAdded';
  const roadTarget = 'roads.classes.motorway.surface.fill';
  return extendStreets({
    id: 'sidecar-map',
    modules: {
      land: withRenderStack(land({}), {
        inspectionAdded: renderPass({
          attachTo: 'land.background',
          feature: 'landuse',
          phase: 'overlay',
          renderer: 'fill',
          style: {
            color: fixed('#008000', {reason: 'Inspection render-pass fixture.'}),
          },
        }),
        inspectionRecolor: refineRenderTarget({
          renderer: 'fill',
          style: {
            color: fixed('#006400', {reason: 'Inspection refinement fixture.'}),
          },
          target,
        }),
        inspectionOpacity: refineRenderTarget({
          renderer: 'fill',
          style: {opacity: 0.75},
          target,
        }),
      }),
      poi: disable(),
      roads: withRenderStack(roads({}), {
        motorwayOpacity: refineRenderTarget({
          renderer: 'line',
          style: {opacity: 0.9},
          target: roadTarget,
        }),
      }),
    },
  });
}

test('emits a separate complete provenance sidecar without changing Style bytes', () => {
  const map = inspectionMap();
  const ordinaryStyle = createStyle(map);
  const {inspection, style} = createStyleWithInspection(map);

  assert.equal(JSON.stringify(style), JSON.stringify(ordinaryStyle));
  assert.equal(inspection.schemaVersion, tileflowStyleInspectionSchemaVersion);
  assert.equal(inspection.map, 'sidecar-map');
  assert.equal(inspection.theme, 'light');
  assert.equal(inspection.layers.length, style.layers.length);
  assert.deepEqual(
    inspection.layers.map(({id, index, type}) => ({id, index, type})),
    style.layers.map(({id, type}, index) => ({id, index, type})),
  );
  assert.ok(inspection.layers.every(({contributions}) => contributions.length > 0));

  const privateKeys = [
    ...Object.values(tileflowCompilerMetadataKeys),
    tileflowCompilerProvenanceMetadataKey,
  ];
  for (const layer of style.layers) {
    const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
    for (const key of privateKeys) assert.equal(metadata[key], undefined);
  }
});

test('retains physical-planner cohorts and the ordered render-operation chain', () => {
  const {inspection} = createStyleWithInspection(inspectionMap());
  const added = inspection.layers.find(({id}) => id === 'tileflow-land-render-inspectionAdded');

  assert.deepEqual(added?.contributions, [
    {
      owner: 'land',
      slot: 'background',
      target: 'land.render.inspectionAdded',
      operations: [
        {kind: 'pass', owner: 'land', target: 'land.render.inspectionAdded'},
        {kind: 'refinement', owner: 'land', target: 'land.render.inspectionAdded'},
        {kind: 'refinement', owner: 'land', target: 'land.render.inspectionAdded'},
      ],
    },
  ]);

  const cohort = inspection.layers.find(
    ({id}) => id === 'tileflow-road-surface-highzoom-major-fill',
  );
  assert.ok(cohort);
  assert.ok(cohort.contributions.length > 1);
  assert.equal(
    new Set(cohort.contributions.map(({target}) => target)).size,
    cohort.contributions.length,
  );
  assert.ok(
    cohort.contributions.some(
      ({owner, slot, target}) =>
        owner === 'roads' &&
        slot === 'transport-surface-fill' &&
        target === 'roads.classes.motorway.surface.fill',
    ),
  );
  assert.deepEqual(
    cohort.contributions.find(({target}) => target === 'roads.classes.motorway.surface.fill')
      ?.operations,
    [
      {
        kind: 'refinement',
        owner: 'roads',
        target: 'roads.classes.motorway.surface.fill',
      },
    ],
  );
});

test('catalog inspection APIs preserve theme addressing and runtime manifest bytes', () => {
  const map = inspectionMap();
  const catalog = {maps: {'sidecar-map': parseTileflowMap(map)}};
  const manifestBytes = JSON.stringify(createManifest(catalog));
  const single = createStyleFromCatalogWithInspection(catalog, 'sidecar-map');
  const family = createStylesFromCatalogWithInspection(catalog);

  assert.equal(JSON.stringify(single), JSON.stringify(family['sidecar-map']?.light));
  assert.equal(JSON.stringify(createManifest(catalog)), manifestBytes);
  assert.doesNotMatch(manifestBytes, /contributions|schemaVersion/u);
});
