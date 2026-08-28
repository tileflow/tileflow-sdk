import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyle, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {harad, haradIcons} from '../src';

const haradPatternIds = [
  'harad-arable',
  'harad-conifer',
  'harad-deciduous',
  'harad-orchard',
  'harad-paper-grain',
  'harad-sand',
  'harad-settlement',
  'harad-water-lines',
  'harad-wetland',
] as const;

const preparedAssets = {
  icons: {ids: haradPatternIds, sprite: '/tileflow/icons/harad/sprite'},
} as const;

test('Härad is a deeply frozen map with no Streets map dependency', async () => {
  assert.equal(harad.id, 'harad');
  assert.equal(harad.name, 'Härad');
  assert.equal('root' in harad, false);
  assert.equal('extends' in harad, false);
  assertDeepFrozen(harad);

  const source = await readFile(new URL('../src/official/harad.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);
  assert.doesNotMatch(
    source,
    /@tileflow\/core\/recipe|defineModuleEffects|semanticField|semanticLayer/u,
  );

  const resolved = resolveMap(harad);
  assert.deepEqual(resolved.icons, [haradIcons]);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.aeroways?.enabled, false);
  assert.equal(resolved.modules?.labels?.roads, 'none');
  assert.equal(resolved.modules?.poi?.enabled, false);
  assert.equal(resolved.modules?.roads?.oneWayMarkers, false);
  assert.deepEqual(resolved.modules?.roads?.sidewalks, {
    outline: {visible: false},
    surface: {visible: false},
  });
});

test('Härad compiles only against its own patterns and keeps its semantic render stack', () => {
  const compiled = createStyleWithInspection(harad, {preparedAssets});
  const {style} = compiled;
  assert.equal(style.metadata?.['tileflow:map'], 'harad');
  assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
  assert.equal(style.metadata?.['tileflow:extends'], undefined);
  assert.deepEqual(validateStyleMin(style as never), []);

  const patternIds = new Set(
    style.layers.flatMap((layer) =>
      Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(([property, value]) =>
        property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
      ),
    ),
  );
  assert.deepEqual([...patternIds].sort(), [...haradPatternIds]);

  const targets = compiledTargets(compiled);
  for (const target of [
    'land.render.arableTexture',
    'land.render.coniferTexture',
    'land.render.deciduousTexture',
    'land.render.orchardTexture',
    'land.render.sandTexture',
    'land.render.wetlandTexture',
    'land.render.settlementTexture',
    'land.render.fieldBoundaries',
    'water.render.printLines',
    'water.render.intermittentPrintLines',
  ]) {
    assert.equal(targets.has(target), true, `Missing Härad render target ${target}`);
  }
  const targetOrder = compiled.inspection.layers.flatMap((layer) =>
    layer.contributions.map((contribution) => contribution.target),
  );
  assert.equal(
    targetOrder.indexOf('land.render.fieldBoundaries') + 1,
    targetOrder.indexOf('land.render.arableTexture'),
  );
  assert.equal(
    targetOrder.indexOf('land.render.orchardTexture') + 1,
    targetOrder.indexOf('land.render.deciduousTexture'),
  );

  const layerIds = new Set(style.layers.map((layer) => layer.id));
  assert.equal(layerIds.has('harad-building-ink-shadow'), false);
  assert.equal(layerIds.has('tileflow-road-surface-cycleway-fill'), false);
  assert.equal(layerIds.has('tileflow-road-surface-steps-fill'), false);

  const buildingFill = style.layers.find((layer) => layer.id === 'tileflow-buildings-fill');
  assert.equal(buildingFill?.paint?.['fill-color'], '#B64B35');
  assert.deepEqual(buildingFill?.paint?.['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    15,
    0,
    16,
    0.84,
    19,
    0.9,
  ]);

  const settlement = compiledLayer(compiled, 'land.render.settlementTexture');
  assert.equal(settlement?.maxzoom, 16);
  assert.deepEqual(settlement?.paint?.['fill-opacity'], [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    0,
    12,
    0.56,
    14,
    0.28,
    16,
    0,
  ]);

  const primaryRoad = style.layers.find(
    (layer) => layer.id === 'tileflow-road-surface-primary-fill',
  );
  assert.equal(primaryRoad?.paint?.['line-color'], '#F7EED9');

  for (const id of [
    'tileflow-addresses',
    'tileflow-aeroway-area',
    'tileflow-aeroway-runway',
    'tileflow-road-oneway',
    'tileflow-road-surface-cycleway-fill',
    'tileflow-road-surface-steps-fill',
  ]) {
    assert.equal(layerIds.has(id), false, `Härad emitted modern detail layer ${id}`);
  }
});

test('Härad publishes an exact original pattern directory', async () => {
  assert.deepEqual(
    (await readdir(new URL('../assets/harad/icons/', import.meta.url))).sort(),
    haradPatternIds.map((id) => `${id}.pattern.svg`),
  );

  const settlementPattern = await readFile(
    new URL('../assets/harad/icons/harad-settlement.pattern.svg', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(settlementPattern, /fill="#[0-9A-F]{6}"/iu);
});

test('Härad stays valid against generic OpenMapTiles without optional capabilities', () => {
  const data = vectorTiles({
    attribution: 'Fixture data',
    schema: openMapTiles({
      capabilities: {
        bathymetry: false,
        businessCorridor: false,
        globalLandcover: false,
        tree: false,
      },
    }),
    tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  });
  const style = createStyle({...harad, data}, {preparedAssets});
  const layerIds = new Set(style.layers.map((layer) => layer.id));

  assert.equal(layerIds.has('tileflow-bathymetry'), false);
  assert.equal(layerIds.has('tileflow-global-landcover'), false);
  assert.deepEqual(validateStyleMin(style as never), []);
});

function assertDeepFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertDeepFrozen(descriptor.value, visited);
  }
}

function compiledTargets(compiled: ReturnType<typeof createStyleWithInspection>): Set<string> {
  return new Set(
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.map((contribution) => contribution.target),
    ),
  );
}

function compiledLayer(compiled: ReturnType<typeof createStyleWithInspection>, target: string) {
  const layerId = compiled.inspection.layers.find((layer) =>
    layer.contributions.some((contribution) => contribution.target === target),
  )?.id;
  return compiled.style.layers.find((layer) => layer.id === layerId);
}
