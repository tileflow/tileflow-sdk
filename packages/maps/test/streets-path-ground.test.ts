import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, defineMap, refine} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  models: streetsPreparedModels,
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/sprite',
  },
};
const path = /^tileflow-road-(surface|bridge|tunnel)-(pathway|footway|steps|pedestrian|cycleway)-/;
test('Streets consumer compilation retains ground-aware paths with a packaged source and complete fallback', () => {
  const consumer = defineMap({id: 'consumer', version: 1, extends: streets});
  const style = createStyle(consumer, {theme: 'light', preparedAssets});
  const plain = createStyle(
    defineMap({
      id: 'without-context',
      version: 1,
      extends: streets,
      modules: {roads: refine({pathGround: {opacity: 0}})},
    }),
    {theme: 'light', preparedAssets},
  );
  const source = style.sources['tileflow-path-ground'] as {url: string};
  assert.ok(source);
  assert.match(source.url, /^tileflow-path-ground:/);
  assert.ok(!source.url.match(/localhost|127\.0\.0\.1|preview-path/));
  const overlays = style.layers.filter((l) => 'source' in l && l.source === 'tileflow-path-ground');
  assert.equal(overlays.length, 5);
  for (const layer of overlays) {
    assert.ok(layer.type === 'line');
    assert.equal(layer.paint?.['line-color'], '#FFFFFF');
  }
  for (const name of ['pathway', 'footway', 'pedestrian', 'steps']) {
    const fill = style.layers.find((l) => l.id === `tileflow-road-surface-${name}-fill`);
    const casing = style.layers.find((l) => l.id === `tileflow-road-surface-${name}-casing`);
    assert.ok(fill?.type === 'line' && casing?.type === 'line');
    assert.equal(fill.source, 'tileflow');
    assert.equal(fill.paint?.['line-color'], '#D5DAD7');
    assert.equal(casing.paint?.['line-opacity'], 0);
  }
  assert.deepEqual(
    style.layers.filter(
      (l) => !path.test(l.id) && !('source' in l && l.source === 'tileflow-path-ground'),
    ),
    plain.layers.filter((l) => !path.test(l.id)),
  );
  for (const structure of ['surface', 'bridge', 'tunnel']) {
    const border = style.layers.findIndex((l) =>
      new RegExp(
        `^tileflow-road-${structure}-(track|service|minor|tertiary|secondary|primary|trunk|motorway)-casing$`,
      ).test(l.id),
    );
    for (const [index, layer] of style.layers.entries()) {
      if (
        new RegExp(
          `^tileflow-road-${structure}-(pathway|footway|steps|pedestrian|cycleway)-fill$`,
        ).test(layer.id)
      )
        assert.ok(index < border, `${layer.id} must precede carriageway borders`);
      if (structure === 'surface' && 'source' in layer && layer.source === 'tileflow-path-ground')
        assert.ok(index < border);
    }
  }
});
test('other Streets themes do not gain the daylight path treatment', () => {
  for (const theme of Object.keys(streetsThemes).filter((name) => name !== 'light')) {
    const style = createStyle(streets, {theme, preparedAssets});
    assert.equal(style.sources['tileflow-path-ground'], undefined, theme);
    const casing = style.layers.find((l) => l.id === 'tileflow-road-surface-footway-casing');
    assert.ok(casing?.type === 'line');
    assert.notEqual(casing.paint?.['line-opacity'], 0, theme);
  }
});
