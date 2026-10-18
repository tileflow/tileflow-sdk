import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, defineMap, readTileflowStreetLights, refine} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/street-lights/sprite',
  },
  models: streetsPreparedModels,
};

test('every Streets palette and time of day compiles without street-lamp glows', () => {
  for (const theme of Object.keys(streetsThemes)) {
    const style = createStyle(streets, {theme, preparedAssets});
    assert.equal(readTileflowStreetLights(style.metadata), undefined, theme);
    assert.equal(style.metadata?.['tileflow:street-lights'], undefined, theme);
  }
});

test('an application can explicitly enable street lights when extending Streets', () => {
  const map = defineMap({
    id: 'streets-with-lamps',
    version: 1,
    extends: streets,
    modules: {roads: refine({streetLights: {enabled: true, estimate: 'none'}})},
  });
  const style = createStyle(map, {theme: 'dark', preparedAssets});
  const lights = readTileflowStreetLights(style.metadata);
  assert.ok(lights);
  assert.equal(lights.estimate, 'none');
  assert.equal(lights.layers.streetFurniture, 'street_furniture');
  assert.equal(lights.intensity, 1);
});
