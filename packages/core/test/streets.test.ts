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
  tileflowWorldRevision,
  water,
} from '../src';

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

test('keeps legacy attribution inline and delegates versioned attribution to TileJSON', () => {
  const legacy = createStreetsStyle({
    basemap: streets(),
    data: tileflowWorld({revision: tileflowWorldRevision}),
  });
  const balanced = createStreetsStyle({
    basemap: streets(),
    data: tileflowWorld({revision: 'balanced_candidate_1'}),
  });
  const legacySource = legacy.sources.tileflow as Record<string, unknown>;
  const balancedSource = balanced.sources.tileflow as Record<string, unknown>;

  assert.equal(
    legacySource.attribution,
    '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors',
  );
  assert.equal(Object.hasOwn(balancedSource, 'attribution'), false);
  assert.equal(
    balancedSource.url,
    'https://api.tileflow.dev/tiles/world/tiles.json?archiveVersion=balanced_candidate_1',
  );
  assert.deepEqual(
    validateStyleMin(balanced as never).map((error) => error.message),
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
