import type {RasterLayerSpecification} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  disable,
  resolveMap,
  tileflowWorldAttribution,
} from '@tileflow/core';
import {streets} from '../src';
import {streetsTreeModels} from '../src/assets';
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

test('every Streets appearance shares one external climate image that only light draws', () => {
  const climateSource = {
    type: 'raster',
    tiles: [
      'https://api.tileflow.dev/base/2a01d3fc884ee9aea013c506a7e4625b5d869e45f1c467e63cc0829f2e7314a1/images/streets-climate-v1.png',
    ],
    tileSize: 512,
    minzoom: 0,
    maxzoom: 0,
    attribution: '<a href="https://tileflow.dev/copyright">© Tileflow</a>',
  };
  // Renderers drop a credit contained in another, so the visible World credit stays unchanged.
  assert.ok(tileflowWorldAttribution.includes(climateSource.attribution));
  const themes = Object.keys(resolveMap(streets).themes);
  assert.ok(themes.includes('light') && themes.length > 1);
  for (const theme of themes) {
    const style = createStyle(streets, {theme, preparedAssets});
    assert.deepEqual(style.sources['tileflow-landcover-underlay'], climateSource, theme);
    assert.ok(!JSON.stringify(style.sources.tileflow).includes('Beck et al.'), theme);
    const underlay = style.layers.findIndex((l) => l.id === 'tileflow-global-landcover-underlay');
    assert.ok(
      underlay > 0 &&
        underlay < style.layers.findIndex((l) => l.id === 'tileflow-global-landcover'),
      theme,
    );
    const layer = style.layers[underlay] as RasterLayerSpecification;
    assert.equal(layer.source, 'tileflow-landcover-underlay', theme);
    assert.equal(layer.maxzoom, 11, theme);
    const opacity = layer.paint?.['raster-opacity'];
    if (theme === 'light') {
      assert.ok(Array.isArray(opacity) && opacity[0] === 'interpolate', theme);
      assert.ok((opacity[4] as number) > 0, 'light draws the climate image at overview zooms');
      assert.deepEqual(opacity.slice(-2), [11, 0]);
    } else {
      assert.equal(opacity, 0, theme);
    }
    const sources = JSON.stringify(style.sources);
    assert.ok(!sources.includes('data:image/'), theme);
    assert.ok(!sources.includes('localhost'), theme);
    assert.ok(!sources.includes('127.0.0.1'), theme);
  }
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
  assert.deepEqual(resolveMap(composed).models, [streetsTreeModels]);
});
