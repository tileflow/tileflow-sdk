import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, readTileflowBuildings3D} from '@tileflow/core';
import {streets} from '../src';
import {streetsPreparedModels} from './streets-assets';

test('Streets omits underground footprints without rejecting ordinary buildings with missing fields', () => {
  const style = createStyle(streets, {
    theme: 'light',
    preparedAssets: {
      models: streetsPreparedModels,
      icons: {
        ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
          .filter((file) => file.endsWith('.svg'))
          .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
        sprite: '/test/sprite',
      },
    },
  });
  const flat = readTileflowBuildings3D(style.metadata)?.flatLayers;
  assert.ok(flat?.some((layer) => layer.id === 'tileflow-buildings-fill'));
  assert.ok(flat?.some((layer) => layer.id === 'tileflow-buildings-fill-outline'));
  assert.equal(
    flat?.some((layer) => layer.id.includes('road') || layer.id.includes('business-corridor')),
    false,
  );
  for (const id of [
    'tileflow-buildings-fill',
    'tileflow-buildings-fill-outline',
    'tileflow-buildings-render-flatShadow',
  ]) {
    const layer = style.layers.find((entry) => entry.id === id);
    assert.ok(layer);
    const accepts = featureFilter(layer.filter as never).filter;
    assert.equal(accepts({zoom: 19}, {type: 3, properties: {render_height: 3}} as never), true);
    assert.equal(accepts({zoom: 19}, {type: 3, properties: {}} as never), true);
    for (const hide_3d of [true, 1, '1', 'true'])
      assert.equal(
        accepts({zoom: 19}, {type: 3, properties: {render_height: 5, hide_3d}} as never),
        false,
      );
  }
});
