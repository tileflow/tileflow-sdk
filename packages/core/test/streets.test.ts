import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createStreetsStyle, labels, patchLayer, roads, streets, water} from '../src';

test('compiles a complete deterministic Streets map from omitted data and modules', () => {
  const first = createStreetsStyle({basemap: streets()});
  const second = createStreetsStyle({basemap: streets()});

  assert.deepEqual(first, second);
  assert.equal(first.metadata?.['tileflow:basemap'], 'streets');
  assert.equal(first.metadata?.['tileflow:basemapVersion'], 2);
  assert.equal(first.metadata?.['tileflow:variant'], 'light');
  assert.equal(first.metadata?.['tileflow:internalMigration'], undefined);
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
