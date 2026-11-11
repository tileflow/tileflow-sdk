import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec-v6';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {basename} from 'node:path';
import test from 'node:test';
import {createStyle, defineMap, parseTileflowContourSourceUrl, resolveMap} from '@tileflow/core';
import {streets, terrain} from '../src';
import {streetsPreparedModels} from './streets-assets';

async function preparedAssets() {
  const files = await readdir(new URL('../assets/', import.meta.url), {recursive: true});
  return {
    models: streetsPreparedModels,
    icons: {
      ids: files
        .filter((file) => /\.svg$/u.test(file))
        .map((file) => basename(file).replace(/(?:\.pattern)?\.svg$/u, '')),
      sprite: '/terrain/sprite',
    },
  };
}

test('Terrain compiles every appearance with one elevation source for relief and contours', async () => {
  const assets = await preparedAssets();
  for (const theme of Object.keys(terrain.themes ?? {})) {
    const style = createStyle(terrain, {theme, preparedAssets: assets});
    assert.deepEqual(validateStyleMin(style as never), [], theme);
    assert.ok(style.terrain);
    assert.equal(style.terrain.exaggeration, 1.2);
    assert.deepEqual(style.metadata?.['tileflow:camera'], {
      version: 1,
      adaptivePerspective: false,
      pitchLimit: {maxZoom: 24, maxPitch: 60},
    });
    const lines = style.layers.filter(
      (layer) => layer.type === 'line' && layer.source === 'terrain-contours',
    );
    assert.equal(lines.length, 2);
    // Overzoom the final contour tiles without hiding their lines at close camera zooms.
    for (const line of lines) assert.ok(line.maxzoom === undefined || line.maxzoom >= 22);
    const dem = style.sources[style.terrain.source] as {url: string; tileSize: number};
    const contours = style.sources['terrain-contours'] as {tiles: string[]};
    assert.equal(parseTileflowContourSourceUrl(contours.tiles[0]!).demTileJson, dem.url);
    assert.equal(dem.tileSize, 512);
    assert.doesNotMatch(JSON.stringify(style), /elevation-tiles-prod/u);
  }
});

test('Terrain can switch elevation providers without retaining the public DEM in contours', async () => {
  const resolved = resolveMap(terrain);
  assert.ok(resolved.terrain && typeof resolved.terrain === 'object');
  const url = 'https://example.com/elevation/tiles.json';
  const custom = defineMap({
    id: 'custom-terrain',
    version: 1,
    extends: terrain,
    terrain: {...resolved.terrain, url},
  });
  const style = createStyle(custom, {preparedAssets: await preparedAssets()});
  assert.deepEqual(validateStyleMin(style as never), []);
  assert.equal((style.sources[style.terrain!.source] as {url: string}).url, url);
  const contours = style.sources['terrain-contours'] as {tiles: string[]};
  assert.equal(parseTileflowContourSourceUrl(contours.tiles[0]!).demTileJson, url);
});

test('Terrain remains an immutable independent root and extending it does not mutate Streets', () => {
  const original = JSON.stringify(streets);
  assert.equal(terrain.extends, undefined);
  assert.equal(Object.isFrozen(terrain), true);
  const custom = resolveMap(
    defineMap({id: 'flat-terrain', version: 1, extends: terrain, terrain: 'none'}),
  );
  assert.equal(custom.terrain, 'none');
  assert.equal(JSON.stringify(streets), original);
  assert.equal(resolveMap(terrain).terrain && typeof resolveMap(terrain).terrain, 'object');
});
