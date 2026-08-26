import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as publicCore from '@tileflow/core';
import {
  addresses,
  aeroways,
  boundaries,
  buildings,
  createStyle,
  defineMap,
  labels,
  land,
  landforms,
  poi,
  resolveMap,
  roads,
  type TileflowStreetsModules,
  tileflowWorldV1Schema,
  transit,
  vectorTiles,
  vegetation,
  water,
} from '@tileflow/core';
import {getResolvedModuleEffects} from '@tileflow/core/recipe';
import {
  cyberpunk,
  ferraris,
  harad,
  matrix,
  siegfried,
  soundings,
  streets,
  streetsDark,
  verdant,
} from '../src';

const moduleFactories = {
  addresses,
  aeroways,
  boundaries,
  buildings,
  labels,
  land,
  landforms,
  poi,
  roads,
  transit,
  vegetation,
  water,
} as const;

type Domain = keyof typeof moduleFactories;

const officialEffectIds: Partial<Record<Domain, readonly string[]>> = {
  boundaries: ['streets-boundary-admin2-background'],
  buildings: [
    'streets-buildings-3d-shadow-soft',
    'streets-buildings-3d-shadow-core',
    'streets-buildings-3d',
    'cyberpunk-buildings-circuit-fill',
    'cyberpunk-buildings-ghost-aura',
    'cyberpunk-buildings-ghost-glow',
    'cyberpunk-buildings-signal-trace',
    'matrix-buildings-ghost-aura',
    'matrix-buildings-ghost-glow',
    'matrix-buildings-signal-trace',
    'ferraris-building-print-shadow',
    'verdant-building-print-shadow',
  ],
  labels: ['streets-label-place-settlement-marker', 'matrix-crt-mask', 'verdant-landscape-label'],
  land: [
    'streets-landuse-business-area',
    'cyberpunk-landuse-business-grid',
    'cyberpunk-landuse-sector-trace',
    'cyberpunk-urban-park-circuit-trace',
    'matrix-landuse-business-grid',
    'matrix-landuse-sector-trace',
    'matrix-urban-park-circuit-trace',
    'verdant-landcover-farmland-pattern',
    'verdant-landcover-scrub-pattern',
    'verdant-landcover-meadow-pattern',
    'verdant-landcover-orchard-pattern',
    'verdant-landcover-rock-pattern',
    'verdant-landcover-wetland-pattern',
    'verdant-landcover-wood-pattern',
    'verdant-landuse-residential-pattern',
    'ferraris-landcover-farmland-pattern',
    'ferraris-landcover-heath-pattern',
    'ferraris-landcover-orchard-pattern',
    'ferraris-landcover-sand-pattern',
    'ferraris-landcover-wetland-pattern',
    'ferraris-landcover-wood-pattern',
    'ferraris-landuse-residential-pattern',
    'harad-landcover-arable-pattern',
    'harad-landcover-conifer-pattern',
    'harad-landcover-deciduous-pattern',
    'harad-landcover-orchard-pattern',
    'harad-landcover-sand-pattern',
    'harad-landcover-wetland-pattern',
    'harad-landuse-settlement-pattern',
    'harad-field-boundaries',
    'siegfried-landcover-forest-pattern',
    'siegfried-landcover-gravel-pattern',
    'siegfried-landcover-orchard-pattern',
    'siegfried-landcover-rock-pattern',
    'siegfried-landcover-scree-pattern',
    'siegfried-landcover-wetland-pattern',
  ],
  poi: [
    'streets-parking-symbol-disc',
    'streets-parking-symbol-label',
    'cyberpunk-destination-scan-ring',
    'cyberpunk-destination-beacon-core',
    'cyberpunk-destination-target-brackets',
    'matrix-destination-scan-ring',
    'matrix-destination-beacon-core',
    'matrix-destination-poi-node',
  ],
  roads: [
    'cyberpunk-road-principal-neon-aura',
    'cyberpunk-road-principal-neon-glow',
    'cyberpunk-road-principal-neon-core',
    'matrix-road-principal-neon-aura',
    'matrix-road-principal-neon-glow',
    'verdant-trail-emphasis',
  ],
  water: [
    'cyberpunk-water-shore-aura',
    'cyberpunk-water-shore-core',
    'matrix-water-shore-aura',
    'matrix-water-shore-core',
    'ferraris-water-ripples-pattern',
    'ferraris-water-intermittent-ripples-pattern',
    'harad-water-lines-pattern',
    'harad-water-intermittent-lines-pattern',
    'siegfried-glacier-mask',
    'siegfried-landcover-glacier-pattern',
    'siegfried-glacier-outline',
    'soundings-water-dots-pattern',
    'soundings-water-intermittent-dots-pattern',
    'siegfried-water-lines-pattern',
    'siegfried-water-intermittent-lines-pattern',
    'verdant-water-lines-pattern',
    'verdant-water-intermittent-lines-pattern',
  ],
};

const officialMaps = {
  streets,
  'streets-dark': streetsDark,
  cyberpunk,
  ferraris,
  harad,
  matrix,
  siegfried,
  soundings,
  verdant,
};

const preparedOfficialAssets = {
  preparedAssets: {
    icons: {
      ids: [
        'coffee',
        'crosswalk',
        'culture',
        'cyber-circuit',
        'cyber-data-grid',
        'cyber-target-brackets',
        'education',
        'ferraris-crop-hatch',
        'ferraris-heath',
        'ferraris-orchard',
        'ferraris-paper-grain',
        'ferraris-residential',
        'ferraris-sand',
        'ferraris-water-ripples',
        'ferraris-wetland',
        'ferraris-woodland',
        'food',
        'harad-arable',
        'harad-conifer',
        'harad-deciduous',
        'harad-orchard',
        'harad-paper-grain',
        'harad-sand',
        'harad-settlement',
        'harad-water-lines',
        'harad-wetland',
        'health',
        'lodging',
        'major-transit',
        'matrix-crt-scanlines',
        'matrix-data-grid',
        'matrix-poi-node',
        'oneway',
        'services',
        'shopping',
        'sidewalk-dot',
        'siegfried-forest',
        'siegfried-glacier',
        'siegfried-gravel',
        'siegfried-orchard',
        'siegfried-paper-grain',
        'siegfried-rock',
        'siegfried-scree',
        'siegfried-water-lines',
        'siegfried-wetland',
        'soundings-buoy-cardinal',
        'soundings-buoy-port',
        'soundings-buoy-starboard',
        'soundings-harbor',
        'soundings-light-flare',
        'soundings-lighthouse',
        'soundings-paper-grain',
        'soundings-rock-awash',
        'soundings-water-dots',
        'soundings-wreck',
        'verdant-field-hatch',
        'verdant-forest-canopy',
        'verdant-heath-tufts',
        'verdant-meadow-tufts',
        'verdant-orchard',
        'verdant-paper-fiber',
        'verdant-residential-hatch',
        'verdant-scree',
        'verdant-water-lines',
        'verdant-wetland-reeds',
      ],
      sprite: '/tileflow/test/official/sprite',
    },
  },
} as const;

test('raw layer overrides are absent from the public authoring surface', () => {
  for (const name of ['addLayer', 'moveLayer', 'patchLayer', 'removeLayer']) {
    assert.equal(name in publicCore, false, `Unexpected public raw override export ${name}`);
  }
});

for (const [mapName, parent] of Object.entries(officialMaps)) {
  for (const domain of Object.keys(moduleFactories) as Domain[]) {
    for (const mode of ['omitted', 'explicit-undefined', 'exact', 'custom', 'disabled'] as const) {
      test(`${mapName}: ${mode} ${domain} is owner-atomic`, () => {
        const replacement =
          mode === 'exact'
            ? (moduleFactories[domain] as () => unknown)()
            : mode === 'custom'
              ? {type: domain, enabled: true}
              : mode === 'disabled'
                ? {type: domain, enabled: false}
                : undefined;
        const child = defineMap({
          id: `${mapName}-${domain}-${mode}`,
          version: 1,
          extends: parent,
          ...(mode === 'omitted'
            ? {}
            : {modules: {[domain]: replacement} as TileflowStreetsModules}),
        });
        const resolved = resolveMap(child);
        const parentResolved = resolveMap(parent);
        const ownedEffects = getResolvedModuleEffects(resolved).filter(
          (effect) => effect.owner === domain,
        );
        const parentOwnedEffects = getResolvedModuleEffects(parentResolved).filter(
          (effect) => effect.owner === domain,
        );

        const inherits = mode === 'omitted' || mode === 'explicit-undefined';
        if (inherits) {
          assert.deepEqual(resolved.modules?.[domain], parentResolved.modules?.[domain]);
          assert.deepEqual(ownedEffects, parentOwnedEffects);
        } else {
          assert.deepEqual(
            ownedEffects,
            [],
            `${mapName}.${domain} retained inherited compiler effects`,
          );
        }
        const style = createStyle(child, preparedOfficialAssets);
        assert.deepEqual(validateStyleMin(style as never), []);

        if (!inherits) {
          const ids = new Set(style.layers.map((layer) => layer.id));
          for (const id of officialEffectIds[domain] ?? []) {
            assert.equal(ids.has(id), false, `${mapName}.${domain} leaked owned effect ${id}`);
          }
        }
        const compiledModules = style.metadata?.['tileflow:modules'] as readonly string[];
        if (inherits) {
          const parentStyle = createStyle(parent, preparedOfficialAssets);
          const parentModules = parentStyle.metadata?.['tileflow:modules'] as readonly string[];
          assert.equal(compiledModules.includes(domain), parentModules.includes(domain));
        } else {
          assert.equal(compiledModules.includes(domain), mode !== 'disabled');
        }
      });
    }
  }
}

for (const [mapName, parent] of Object.entries(officialMaps)) {
  test(`${mapName}: all official contributions bind through a complete data schema remap`, () => {
    const canonical = tileflowWorldV1Schema();
    const fields = Object.fromEntries(
      Object.keys(canonical.fields).map((name) => [name, `remapped_field_${name}`]),
    ) as typeof canonical.fields;
    const layers = Object.fromEntries(
      Object.keys(canonical.layers).map((name) => [name, `remapped_layer_${name}`]),
    ) as typeof canonical.layers;
    const schema = tileflowWorldV1Schema({fields, layers});
    const child = defineMap({
      id: `${mapName}-remapped`,
      version: 1,
      extends: parent,
      fonts: ['./test-fonts'],
      data: vectorTiles({
        attribution: 'Schema remap fixture',
        schema,
        url: 'https://tiles.example.test/remapped.json',
      }),
    });

    const style = createStyle(child, preparedOfficialAssets);
    assert.deepEqual(validateStyleMin(style as never), []);
    const expectedLayers = new Set(Object.values(schema.layers));
    const expectedFields = new Set(Object.values(schema.fields));

    for (const layer of style.layers) {
      if (layer.source === publicCore.tileflowPrimarySourceId) {
        if (typeof layer['source-layer'] === 'string') {
          assert.ok(
            expectedLayers.has(layer['source-layer']),
            `${layer.id} retained source-layer ${layer['source-layer']}`,
          );
        }
        for (const field of collectExpressionFields(layer)) {
          assert.ok(expectedFields.has(field), `${layer.id} retained physical field ${field}`);
        }
      }
    }
  });
}

function collectExpressionFields(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if ((value[0] === 'get' || value[0] === 'has') && typeof value[1] === 'string') {
      output.add(value[1]);
    }
    for (const item of value) collectExpressionFields(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectExpressionFields(item, output);
    }
  }
  return output;
}
