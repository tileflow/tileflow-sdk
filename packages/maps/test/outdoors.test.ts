import {createExpression, validateStyleMin} from '@maplibre/maplibre-gl-style-spec-v6';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {basename} from 'node:path';
import test from 'node:test';
import {createStyle, defineMap, parseTileflowContourSourceUrl, resolveMap} from '@tileflow/core';
import {outdoors, streets} from '../src';
import {streetsPreparedModels} from './streets-assets';

async function preparedAssets() {
  const files = await readdir(new URL('../assets/', import.meta.url), {recursive: true});
  return {
    models: streetsPreparedModels,
    icons: {
      ids: files
        .filter((file) => /\.svg$/u.test(file))
        .map((file) => basename(file).replace(/(?:\.pattern)?\.svg$/u, '')),
      sprite: '/outdoors/sprite',
    },
  };
}

test('Outdoors compiles every appearance with one elevation source for relief and contours', async () => {
  const assets = await preparedAssets();
  for (const theme of Object.keys(outdoors.themes ?? {})) {
    const style = createStyle(outdoors, {theme, preparedAssets: assets});
    assert.deepEqual(validateStyleMin(style as never), [], theme);
    assert.equal(style.sources['tileflow-path-ground'], undefined, theme);
    for (const kind of ['peak', 'volcano']) {
      const index = style.layers.findIndex((layer) => layer.id === `tileflow-landform-${kind}`);
      const summit = style.layers[index];
      assert.ok(summit?.type === 'symbol');
      const label = createExpression(
        summit.layout?.['text-field'],
        `layers[${index}].layout.text-field`,
      );
      assert.equal(label.result, 'success');
      if (label.result !== 'success') throw new Error('Invalid summit label expression');
      assert.equal(
        label.value.evaluate({zoom: 12}, {properties: {name: 'Mont Blanc', ele: 4806}}),
        'Mont Blanc\n4806 m',
      );
      assert.equal(
        label.value.evaluate({zoom: 12}, {properties: {name: 'Unnamed height'}}),
        'Unnamed height',
      );
    }
    assert.ok(style.terrain);
    assert.equal(style.terrain.exaggeration, 1.2);
    assert.deepEqual(style.metadata?.['tileflow:camera'], {
      version: 1,
      adaptivePerspective: false,
      pitchLimit: {maxZoom: 24, maxPitch: 60},
    });
    const lines = style.layers.filter(
      (layer) => layer.type === 'line' && layer.source === 'outdoors-contours',
    );
    assert.equal(lines.length, 2);
    // Overzoom the final contour tiles without hiding their lines at close camera zooms.
    for (const line of lines) assert.ok(line.maxzoom === undefined || line.maxzoom >= 22);
    const dem = style.sources[style.terrain.source] as {url: string; tileSize: number};
    const contours = style.sources['outdoors-contours'] as {tiles: string[]};
    assert.equal(parseTileflowContourSourceUrl(contours.tiles[0]!).demTileJson, dem.url);
    assert.equal(dem.tileSize, 512);
    assert.doesNotMatch(JSON.stringify(style), /elevation-tiles-prod/u);
  }
});

test('Outdoors can switch elevation providers without retaining the public DEM in contours', async () => {
  const resolved = resolveMap(outdoors);
  assert.ok(resolved.terrain && typeof resolved.terrain === 'object');
  const url = 'https://example.com/elevation/tiles.json';
  const custom = defineMap({
    id: 'custom-outdoors',
    version: 1,
    extends: outdoors,
    terrain: {...resolved.terrain, url},
  });
  const style = createStyle(custom, {preparedAssets: await preparedAssets()});
  assert.deepEqual(validateStyleMin(style as never), []);
  assert.equal((style.sources[style.terrain!.source] as {url: string}).url, url);
  const contours = style.sources['outdoors-contours'] as {tiles: string[]};
  assert.equal(parseTileflowContourSourceUrl(contours.tiles[0]!).demTileJson, url);
});

test('Outdoors remains an immutable independent root and extending it does not mutate Streets', () => {
  const original = JSON.stringify(streets);
  assert.equal(outdoors.extends, undefined);
  assert.equal(Object.isFrozen(outdoors), true);
  const custom = resolveMap(
    defineMap({id: 'flat-outdoors', version: 1, extends: outdoors, terrain: 'none'}),
  );
  assert.equal(custom.terrain, 'none');
  assert.equal(JSON.stringify(streets), original);
  assert.equal(resolveMap(outdoors).terrain && typeof resolveMap(outdoors).terrain, 'object');
});
