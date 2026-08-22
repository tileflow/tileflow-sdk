import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStreetsStyle,
  labels,
  patchLayer,
  roads,
  streets,
  tileflowWorld,
  water,
  type WorldGenerationDescriptor,
} from '../src';

const worldGenerationFixture: WorldGenerationDescriptor = {
  schemaVersion: 1,
  generation: 'v1',
  tileUrl: 'https://world.tileflow.dev/world/v1/{z}/{x}/{y}.pbf',
  vectorSchema: {id: 'tileflow-world-v1-test', sha256: 'a'.repeat(64)},
  tileEncoding: {format: 'mvt', compression: 'gzip', scheme: 'xyz', extent: 4096},
  minzoom: 0,
  maxzoom: 15,
  bounds: [-180, -85.0511288, 180, 85.0511288],
  attribution: '© OpenStreetMap contributors · Tileflow test fixture',
  assetSet: {
    id: 'a1-0123456789abcdef',
    glyphs: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/glyphs/{fontstack}/{range}.pbf',
    spriteBase: 'https://assets.tileflow.dev/base/a1-0123456789abcdef/sprites/base',
  },
};

test('compiles a complete deterministic Streets map from omitted data and modules', () => {
  const first = createStreetsStyle({basemap: streets()});
  const second = createStreetsStyle({basemap: streets()});

  assert.deepEqual(first, second);
  assert.equal(first.metadata?.['tileflow:basemap'], 'streets');
  assert.equal(first.metadata?.['tileflow:basemapVersion'], 3);
  assert.equal(first.metadata?.['tileflow:variant'], 'light');
  assert.equal(first.metadata?.['tileflow:internalMigration'], undefined);
  assert.equal(first.projection, undefined);
  assert.equal(first.sprite, undefined);
  assert.equal(
    first.layers.some(
      (layer) =>
        layer.layout && Object.hasOwn(layer.layout as Record<string, unknown>, 'icon-image'),
    ),
    false,
  );
  assert.ok(first.layers.length > 50);
  assert.ok(first.layers.every((layer) => String(layer.id).startsWith('streets-')));
  assert.equal(new Set(first.layers.map((layer) => layer.id)).size, first.layers.length);
  assert.deepEqual(
    validateStyleMin(first as never).map((error) => error.message),
    [],
  );
});

test('validates the public Streets compiler before emitting versioned metadata', () => {
  assert.throws(
    () =>
      createStreetsStyle({
        basemap: {type: 'streets', basemapVersion: 999, variant: 'light'},
      } as never),
    /basemapVersion/,
  );
  assert.throws(
    () =>
      createStreetsStyle({
        basemap: streets(),
        modules: {roads: {...roads(), unknownControl: true}},
      } as never),
    /modules\.roads\.unknownControl/,
  );
});

test('emits an explicit adaptive globe projection', () => {
  const globe = createStreetsStyle({basemap: streets(), projection: 'globe'});
  const mercator = createStreetsStyle({basemap: streets(), projection: 'mercator'});

  assert.deepEqual(globe.projection, {type: 'globe'});
  assert.deepEqual(mercator.projection, {type: 'mercator'});
  assert.deepEqual(validateStyleMin(globe as never), []);
});

test('emits bounded root lighting for low-contrast 3d faces', () => {
  const style = createStreetsStyle({
    basemap: streets(),
    light: {
      anchor: 'viewport',
      color: '#FFF8E8',
      intensity: 0.18,
      position: [1.15, 210, 30],
    },
  });

  assert.deepEqual(style.light, {
    anchor: 'viewport',
    color: '#FFF8E8',
    intensity: 0.18,
    position: [1.15, 210, 30],
  });
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('module key order does not change Streets output', () => {
  const left = createStreetsStyle({
    basemap: streets(),
    modules: {
      roads: roads({detail: 'major'}),
      labels: labels({roads: 'major'}),
      water: water({bodies: {fill: {color: '#ABCDEF'}}}),
    },
  });
  const right = createStreetsStyle({
    basemap: streets(),
    modules: {
      water: water({bodies: {fill: {color: '#ABCDEF'}}}),
      labels: labels({roads: 'major'}),
      roads: roads({detail: 'major'}),
    },
  });

  assert.deepEqual(left, right);
});

test('compiles a complete World generation to direct immutable asset URLs', () => {
  const first = createStreetsStyle(
    {basemap: streets(), data: tileflowWorld()},
    {apiBaseUrl: 'https://api-one.example.test', worldGeneration: worldGenerationFixture},
  );
  const second = createStreetsStyle(
    {basemap: streets(), data: tileflowWorld()},
    {apiBaseUrl: 'https://api-two.example.test', worldGeneration: worldGenerationFixture},
  );
  const source = first.sources.tileflow as Record<string, unknown>;

  assert.deepEqual(first, second);
  assert.equal(Object.hasOwn(source, 'url'), false);
  assert.deepEqual(source.tiles, [worldGenerationFixture.tileUrl]);
  assert.deepEqual(source.bounds, worldGenerationFixture.bounds);
  assert.equal(source.minzoom, worldGenerationFixture.minzoom);
  assert.equal(source.maxzoom, worldGenerationFixture.maxzoom);
  assert.equal(source.attribution, worldGenerationFixture.attribution);
  assert.equal(first.glyphs, worldGenerationFixture.assetSet.glyphs);
  assert.equal(first.sprite, worldGenerationFixture.assetSet.spriteBase);
  assert.ok(first.layers.some((layer) => layer.id === 'streets-poi-food-icon'));
  assert.deepEqual(first.metadata?.['tileflow:data'], {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
  assert.deepEqual(
    validateStyleMin(first as never).map((error) => error.message),
    [],
  );
});

test('raw overrides run last and fail closed', () => {
  const style = createStreetsStyle({
    basemap: streets(),
    overrides: [patchLayer('streets-water', {paint: {'fill-color': '#0000FF'}})],
  });
  const waterLayer = style.layers.find((layer) => layer.id === 'streets-water')!;

  assert.equal((waterLayer.paint as Record<string, unknown>)['fill-color'], '#0000FF');
  assert.throws(
    () =>
      createStreetsStyle({
        basemap: streets(),
        overrides: [patchLayer('missing', {paint: {'fill-color': '#000'}})],
      }),
    /targets unknown layer/,
  );
});

test('terrain cannot overwrite the stable primary vector source', () => {
  assert.throws(
    () =>
      createStreetsStyle({
        basemap: streets(),
        terrain: {mode: 'hillshade', sourceId: 'tileflow'},
      }),
    /conflicts with the primary vector source/,
  );
});
