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

test('continental context is portable, precedes cover and cannot tint city detail', () => {
  const style = createStyle(streets, {theme: 'light', preparedAssets});
  const underlay = style.layers.findIndex((l) => l.id === 'tileflow-global-landcover-underlay');
  assert.ok(
    underlay > 0 && underlay < style.layers.findIndex((l) => l.id === 'tileflow-global-landcover'),
  );
  assert.equal(style.layers[underlay]!.maxzoom, 11);
  const source = style.sources['tileflow-landcover-underlay'] as {
    url: string;
    coordinates: number[][];
  };
  assert.match(source.url, /^data:image\/png;base64,/);
  assert.equal(source.coordinates[1]![0]! - source.coordinates[0]![0]!, 360);
  assert.ok(source.coordinates[0]![1]! > 85 && source.coordinates[2]![1]! < -85);
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
