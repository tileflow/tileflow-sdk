import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, defineMap, refine, resolveTileflowTheme, token} from '@tileflow/core';
import {readTileflowBuildings3D} from '../../core/src/buildings-3d-design';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/model-colours/sprite',
  },
  models: streetsPreparedModels,
};

test('model part colours follow the selected theme through theme tokens', () => {
  const map = defineMap({
    id: 'model-colours',
    version: 1,
    extends: streets,
    modules: {
      buildings: refine({
        threeDimensional: {modelColors: {glass: token.color('surface.water')}},
      }),
    },
  });
  const glass = (['light', 'dark'] as const).map((theme) => {
    const metadata = createStyle(map, {theme, preparedAssets}).metadata;
    const colour = readTileflowBuildings3D(metadata)?.modelColors?.glass;
    assert.equal(
      colour,
      resolveTileflowTheme(streetsThemes[theme]).tokens.color['surface.water'],
      theme,
    );
    return colour;
  });
  assert.notEqual(glass[0], glass[1]);
});
