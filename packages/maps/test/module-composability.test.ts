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
  disable,
  labels,
  land,
  landforms,
  nautical,
  poi,
  resolveMap,
  roads,
  type TileflowAuthoringModules,
  tileflowWorldV1Schema,
  transit,
  vectorTiles,
  vegetation,
  water,
} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {cyberpunk, ferraris, harad, matrix, siegfried, soundings, streets, verdant} from '../src';

const moduleFactories = {
  addresses,
  aeroways,
  boundaries,
  buildings,
  labels,
  land,
  landforms,
  nautical,
  poi,
  roads,
  transit,
  vegetation,
  water,
} as const;

type Domain = keyof typeof moduleFactories;

const officialMaps = {
  streets,
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
        'parking',
        'road-shield-circle-neutral',
        'road-shield-rectangle-blue',
        'road-shield-rectangle-green',
        'road-shield-rectangle-neutral',
        'road-shield-rectangle-orange',
        'road-shield-rectangle-red',
        'road-shield-rectangle-yellow',
        'services',
        'shopping',
        'sidewalk-dot',
        'siegfried-dark-forest',
        'siegfried-dark-glacier',
        'siegfried-dark-gravel',
        'siegfried-dark-orchard',
        'siegfried-dark-paper-grain',
        'siegfried-dark-rock',
        'siegfried-dark-scree',
        'siegfried-dark-water-lines',
        'siegfried-dark-wetland',
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
const compiledOfficialMaps = new Map<string, ReturnType<typeof createStyleWithInspection>>();

function compileOfficialMap(
  mapName: string,
  map: (typeof officialMaps)[keyof typeof officialMaps],
) {
  const cached = compiledOfficialMaps.get(mapName);
  if (cached) return cached;
  const compiled = createStyleWithInspection(map, preparedOfficialAssets);
  compiledOfficialMaps.set(mapName, compiled);
  return compiled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolvedRenderTargets(resolved: ReturnType<typeof resolveMap>, domain: Domain): string[] {
  const modules = resolved.modules as Readonly<Record<string, unknown>> | undefined;
  const module = modules?.[domain];
  if (!isRecord(module) || !isRecord(module.renderStack)) return [];

  return Object.entries(module.renderStack)
    .map(([name, operation]) => {
      assert.ok(isRecord(operation), `${domain}.renderStack.${name} is not an operation`);
      if (operation.kind === 'render-pass') return `${domain}.render.${name}`;
      assert.equal(operation.kind, 'refine-render-target');
      assert.equal(typeof operation.target, 'string');
      return operation.target as string;
    })
    .sort();
}

function compiledRenderTargets(
  compiled: ReturnType<typeof createStyleWithInspection>,
  domain: Domain,
): string[] {
  return compiled.inspection.layers
    .flatMap((layer) =>
      layer.contributions.flatMap((contribution) =>
        contribution.operations
          .filter((operation) => operation.owner === domain)
          .map((operation) => operation.target),
      ),
    )
    .sort();
}

test('raw layer overrides are absent from the public authoring surface', () => {
  for (const name of ['addLayer', 'moveLayer', 'patchLayer', 'removeLayer']) {
    assert.equal(name in publicCore, false, `Unexpected public raw override export ${name}`);
  }
});

for (const [mapName, parent] of Object.entries(officialMaps)) {
  for (const domain of Object.keys(moduleFactories) as Domain[]) {
    for (const mode of ['omitted', 'exact', 'custom', 'disabled'] as const) {
      test(`${mapName}: ${mode} ${domain} is owner-atomic`, () => {
        const replacement =
          mode === 'exact'
            ? (moduleFactories[domain] as () => unknown)()
            : mode === 'custom'
              ? {type: domain}
              : mode === 'disabled'
                ? disable()
                : undefined;
        const child = defineMap({
          id: `${mapName}-${domain}-${mode}`,
          version: 1,
          extends: parent,
          ...(mode === 'omitted'
            ? {}
            : {modules: {[domain]: replacement} as TileflowAuthoringModules}),
        });
        const resolved = resolveMap(child);
        const parentResolved = resolveMap(parent);
        const renderTargets = resolvedRenderTargets(resolved, domain);
        const parentRenderTargets = resolvedRenderTargets(parentResolved, domain);

        const inherits = mode === 'omitted';
        if (inherits) {
          assert.deepEqual(resolved.modules?.[domain], parentResolved.modules?.[domain]);
          assert.deepEqual(renderTargets, parentRenderTargets);
        } else {
          assert.deepEqual(
            renderTargets,
            [],
            `${mapName}.${domain} retained its inherited public render stack`,
          );
        }
        const compiled = createStyleWithInspection(child, preparedOfficialAssets);
        assert.deepEqual(validateStyleMin(compiled.style as never), []);
        const compiledTargets = compiledRenderTargets(compiled, domain);
        let parentCompiled: ReturnType<typeof createStyleWithInspection> | undefined;
        if (inherits) {
          parentCompiled = compileOfficialMap(mapName, parent);
          const parentCompiledTargets = compiledRenderTargets(parentCompiled, domain);
          assert.deepEqual(parentCompiledTargets, parentRenderTargets);
          assert.deepEqual(compiledTargets, parentCompiledTargets);
        } else {
          assert.deepEqual(
            compiledTargets,
            [],
            `${mapName}.${domain} compiled an inherited semantic render operation`,
          );
        }
        const compiledModules = compiled.style.metadata?.['tileflow:modules'] as readonly string[];
        if (inherits) {
          assert.ok(parentCompiled);
          const parentModules = parentCompiled.style.metadata?.[
            'tileflow:modules'
          ] as readonly string[];
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
