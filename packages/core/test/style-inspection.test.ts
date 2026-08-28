import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, fixed, land, poi, roads} from '../src';
import {
  createManifest,
  createStyleFromCatalogWithInspection,
  createStylesFromCatalogWithInspection,
  createStyleWithInspection,
  tileflowStyleInspectionSchemaVersion,
} from '../src/build';
import {tileflowCompilerProvenanceMetadataKey} from '../src/cartography/compiler-inspection';
import {tileflowCompilerMetadataKeys} from '../src/cartography/contributions';
import {
  addModuleLayer,
  internalModuleEffects,
  patchModuleLayer,
  semanticLayer,
  tileflowModuleEffectMetadataKey,
} from '../src/cartography/module-effects';
import {extendStreets} from './map-fixture';

function inspectionMap() {
  const target = 'land.inspection.added';
  const roadTarget = 'roads.classes.motorway.surface.fill';
  return extendStreets({
    id: 'sidecar-map',
    modules: {land: land({}), poi: poi({enabled: false}), roads: roads({})},
    ...internalModuleEffects([
      addModuleLayer(
        'land',
        target,
        {
          id: 'inspection-added-layer',
          type: 'fill',
          source: 'tileflow',
          'source-layer': semanticLayer('landuse'),
          paint: {
            'fill-color': fixed('#008000', {reason: 'Inspection add-effect fixture.'}),
          },
        },
        {after: 'land.background'},
      ),
      patchModuleLayer('land', target, {
        paint: {
          'fill-color': fixed('#006400', {reason: 'Inspection patch-effect fixture.'}),
        },
      }),
      patchModuleLayer('land', target, {paint: {'fill-opacity': 0.75}}),
      patchModuleLayer('roads', roadTarget, {paint: {'line-opacity': 0.9}}),
    ]),
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
    tileflowModuleEffectMetadataKey,
  ];
  for (const layer of style.layers) {
    const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
    for (const key of privateKeys) assert.equal(metadata[key], undefined);
  }
});

test('retains optimizer cohorts and the ordered add/patch chain', () => {
  const {inspection} = createStyleWithInspection(inspectionMap());
  const added = inspection.layers.find(({id}) => id === 'inspection-added-layer');

  assert.deepEqual(added?.contributions, [
    {
      owner: 'land',
      slot: 'background',
      target: 'land.inspection.added',
      effects: [
        {kind: 'add', owner: 'land', target: 'land.inspection.added'},
        {kind: 'patch', owner: 'land', target: 'land.inspection.added'},
        {kind: 'patch', owner: 'land', target: 'land.inspection.added'},
      ],
    },
  ]);

  const cohort = inspection.layers.find(
    ({id}) => id === 'streets-road-surface-highzoom-major-fill',
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
      ?.effects,
    [
      {
        kind: 'patch',
        owner: 'roads',
        target: 'roads.classes.motorway.surface.fill',
      },
    ],
  );
});

test('catalog inspection APIs preserve theme addressing and runtime manifest bytes', () => {
  const map = inspectionMap();
  const catalog = {maps: {'sidecar-map': map}};
  const manifestBytes = JSON.stringify(createManifest(catalog));
  const single = createStyleFromCatalogWithInspection(catalog, 'sidecar-map');
  const family = createStylesFromCatalogWithInspection(catalog);

  assert.equal(JSON.stringify(single), JSON.stringify(family['sidecar-map']?.light));
  assert.equal(JSON.stringify(createManifest(catalog)), manifestBytes);
  assert.doesNotMatch(manifestBytes, /contributions|schemaVersion/u);
});
