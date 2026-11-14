import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  fixed,
  refine,
  renderPass,
  transit,
  withRenderStack,
} from '@tileflow/core';
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
const pathClasses = ['pathway', 'footway', 'pedestrian', 'steps', 'cycleway'];

test('Streets consumers use ordinary road sources for paths in every appearance', () => {
  const consumer = defineMap({id: 'consumer', version: 1, extends: streets});
  for (const theme of Object.keys(streetsThemes)) {
    const style = createStyle(consumer, {theme, preparedAssets});
    assert.deepEqual(
      Object.keys(style.sources).filter((id) => id.includes('path')),
      [],
      theme,
    );
    // Stretches on green ground come from the World source's path_ground layer, right above the
    // fill of their path, with its filter. Cycleways keep their colour.
    for (const roadClass of pathClasses) {
      const index = style.layers.findIndex(
        (layer) => layer.id === `tileflow-road-surface-${roadClass}-fill`,
      );
      const base = style.layers[index] as {filter?: unknown};
      const onGreen = style.layers.find(
        (layer) => layer.id === `tileflow-road-surface-${roadClass}-fill-on-green`,
      );
      if (roadClass === 'cycleway') {
        assert.equal(onGreen, undefined, theme);
        continue;
      }
      assert.equal(style.layers[index + 1], onGreen, `${theme}: ${roadClass}`);
      assert.ok(onGreen?.type === 'line');
      assert.equal(onGreen.source, 'tileflow');
      assert.equal(onGreen['source-layer'], 'path_ground');
      assert.deepEqual(onGreen.filter, base.filter);
    }
    for (const structure of ['surface', 'bridge', 'tunnel']) {
      for (const roadClass of pathClasses) {
        for (const phase of ['fill', 'casing']) {
          const id = `tileflow-road-${structure}-${roadClass}-${phase}`;
          const layer = style.layers.find((candidate) => candidate.id === id);
          assert.ok(layer?.type === 'line', `${theme}: ${id}`);
          assert.equal(layer.source, 'tileflow', `${theme}: ${id}`);
          assert.equal(layer['source-layer'], 'road', `${theme}: ${id}`);
        }
      }
    }
  }
});

test('paths keep ordinary road hierarchy and structure ordering', () => {
  const style = createStyle(streets, {theme: 'light', preparedAssets});
  for (const structure of ['surface', 'bridge', 'tunnel']) {
    const carriageway = style.layers.findIndex((layer) =>
      new RegExp(
        `^tileflow-road-${structure}-(track|service|minor|tertiary|secondary|primary|trunk|motorway)-fill$`,
      ).test(layer.id),
    );
    assert.ok(carriageway >= 0, structure);
    for (const roadClass of pathClasses) {
      const target = `tileflow-road-${structure}-${roadClass}`;
      const casing = style.layers.findIndex((layer) => layer.id === `${target}-casing`);
      const fill = style.layers.findIndex((layer) => layer.id === `${target}-fill`);
      assert.ok(casing >= 0 && fill > casing && fill < carriageway, target);
    }
  }
});

test('derived Streets maps can disable cycleways or omit their tunnel casing', () => {
  for (const cycleway of [{enabled: false}, {tunnel: {casing: {visible: false}}}]) {
    const map = defineMap({
      id: 'custom-paths',
      version: 1,
      extends: streets,
      modules: {roads: refine({classes: {cycleway}})},
    });
    const style = createStyle(map, {theme: 'light', preparedAssets});
    const fill = style.layers.find((layer) => layer.id === 'tileflow-road-tunnel-cycleway-fill');
    const casing = style.layers.find(
      (layer) => layer.id === 'tileflow-road-tunnel-cycleway-casing',
    );
    if (cycleway.enabled === false) assert.equal(fill, undefined);
    else assert.ok(fill?.type === 'line');
    assert.equal(casing, undefined);
  }
});

test('adding World detail to a derived Streets map keeps paths on the World source', () => {
  const transitLines = withRenderStack(transit(), {
    lines: renderPass({
      placement: 'above-roads',
      feature: 'transitLine',
      renderer: 'line',
      style: {color: fixed('#123456', {reason: 'Test colour.'}), width: 2},
    }),
  });
  for (const modules of [{}, {transit: transitLines}]) {
    const style = createStyle(defineMap({id: 'consumer', version: 1, extends: streets, modules}), {
      theme: 'light',
      preparedAssets,
    });
    for (const id of [
      'tileflow-road-surface-footway-fill',
      'tileflow-road-surface-footway-fill-on-green',
    ]) {
      const fill = style.layers.find((layer) => layer.id === id);
      assert.ok(fill?.type === 'line', id);
      assert.equal(fill.source, 'tileflow');
      assert.match((style.sources[fill.source] as {url: string}).url, /^https?:/u);
    }
  }
});
