import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, defineMap, disable, resolveMap} from '@tileflow/core';
import {streets} from '../src';
import {streetsModels} from '../src/assets';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  models: streetsPreparedModels,
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((x) => x.endsWith('.svg'))
      .map((x) => x.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/sprite',
  },
};

test('Streets omits the climate image until shared external delivery is available', () => {
  const style = createStyle(streets, {theme: 'light', preparedAssets});
  assert.equal(style.sources['tileflow-landcover-underlay'], undefined);
  assert.ok(!style.layers.some((layer) => layer.id === 'tileflow-global-landcover-underlay'));
  assert.ok(!JSON.stringify(style.sources).includes('data:image/'));
  assert.ok(!JSON.stringify(style.sources).includes('localhost'));
  assert.ok(!JSON.stringify(style.sources).includes('127.0.0.1'));
});

test('land visibility removes its context resource and geometry together', () => {
  const design = defineMap({
    id: 'without-land',
    version: 1,
    extends: streets,
    modules: {land: disable()},
  });
  const style = createStyle(design, {theme: 'light', preparedAssets});
  assert.equal(style.sources['tileflow-landcover-underlay'], undefined);
  assert.ok(!style.layers.some((l) => l.id === 'tileflow-global-landcover-underlay'));
});

test('composed Streets retains its packaged tree resources for consumers adding landmarks', () => {
  const composed = defineMap({id: 'composed-streets', version: 1, extends: streets});
  assert.deepEqual(resolveMap(composed).models, [streetsModels]);
});
