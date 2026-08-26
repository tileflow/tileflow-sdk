import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyle, openMapTiles, resolveMap, vectorTiles} from '@tileflow/core';
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

test('Härad is a deeply frozen root with no Streets map dependency', async () => {
  assert.equal(harad.id, 'harad');
  assert.equal(harad.name, 'Härad');
  assert.deepEqual(harad.root, {compiler: 'streets', compilerVersion: 1});
  assert.equal('extends' in harad, false);
  assertDeepFrozen(harad);

  const source = await readFile(new URL('../src/official/harad.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /\bextends\s*:/u);
  assert.doesNotMatch(source, /\bstreets\.icons\b/u);

  const resolved = resolveMap(harad);
  assert.deepEqual(resolved.icons, [haradIcons]);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.aeroways?.enabled, false);
  assert.equal(resolved.modules?.labels?.roads, 'none');
  assert.equal(resolved.modules?.poi?.preset, 'none');
  assert.equal(resolved.modules?.roads?.oneWayMarkers, false);
  assert.deepEqual(resolved.modules?.roads?.sidewalks, {
    outline: {visible: false},
    surface: {visible: false},
  });
});

test('Härad compiles only against its own patterns and keeps its historical effects', () => {
  const style = createStyle(harad, {preparedAssets});
  assert.equal(style.metadata?.['tileflow:map'], 'harad');
  assert.equal(style.metadata?.['tileflow:root'], 'streets');
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

  const layerIds = new Set(style.layers.map((layer) => layer.id));
  for (const id of [
    'harad-landcover-arable-pattern',
    'harad-landcover-conifer-pattern',
    'harad-landcover-deciduous-pattern',
    'harad-landcover-orchard-pattern',
    'harad-landcover-sand-pattern',
    'harad-landcover-wetland-pattern',
    'harad-landuse-settlement-pattern',
    'harad-field-boundaries',
    'harad-water-lines-pattern',
    'harad-water-intermittent-lines-pattern',
  ]) {
    assert.equal(layerIds.has(id), true, `Missing Härad effect layer ${id}`);
  }

  assert.equal(layerIds.has('harad-building-ink-shadow'), false);
  assert.equal(layerIds.has('streets-road-surface-cycleway-fill'), false);
  assert.equal(layerIds.has('streets-road-surface-steps-fill'), false);

  const buildingFill = style.layers.find((layer) => layer.id === 'streets-buildings-fill');
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

  const settlement = style.layers.find((layer) => layer.id === 'harad-landuse-settlement-pattern');
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
    (layer) => layer.id === 'streets-road-surface-primary-fill',
  );
  assert.equal(primaryRoad?.paint?.['line-color'], '#F7EED9');

  for (const id of [
    'streets-addresses',
    'streets-aeroway-area',
    'streets-aeroway-runway',
    'streets-road-oneway',
    'streets-road-surface-cycleway-fill',
    'streets-road-surface-steps-fill',
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

  assert.equal(layerIds.has('streets-bathymetry'), false);
  assert.equal(layerIds.has('streets-global-landcover'), false);
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
