import {createPropertyExpression, latest as styleSpec} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  createStyle,
  decodeTileflowTreeModel,
  defineMap,
  disable,
  readTileflowVegetation3D,
  readTileflowVegetationDisplay,
  refine,
  resolveMap,
  resolveTileflowVegetationRepresentation,
} from '@tileflow/core';
import {buildStreetsTrees} from '../assets/streets/build-trees.mjs';
import {streets, streetsModels} from '../src';
import {streetsPreparedModels, streetsTreeForms} from './streets-assets';

// Use the package's image IDs: these tests exercise the real GLB preparation, while
// the package and atlas tests separately verify that every referenced SVG is shipped.
const {files} = buildStreetsTrees();
const iconIds = readdirSync(new URL('../assets/streets/icons/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.replace(/(?:\.pattern)?\.svg$/, ''));
const compile = (theme = 'light', map = streets) =>
  createStyle(map, {
    theme,
    preparedAssets: {
      icons: {ids: iconIds, sprite: '/test/sprite'},
      models: streetsPreparedModels,
    },
  });

test('Streets tree artwork is reproducible and bounded for near and far rendering', async () => {
  assert.equal(files.size, 28);
  for (const [path, bytes] of files) {
    assert.deepEqual(
      await readFile(new URL(`../assets/streets/${path}`, import.meta.url)),
      Buffer.from(bytes),
      path,
    );
  }
  for (const [id, model] of Object.entries(streetsPreparedModels)) {
    for (const level of ['near', 'far'] as const) {
      const mesh = decodeTileflowTreeModel(model[level]!, level);
      assert.ok(mesh, `${id}:${level}`);
      assert.ok(mesh.indices.length / 3 <= (level === 'near' ? 700 : 100));
      assert.ok(mesh.positions.every(Number.isFinite));
      for (let i = 0; i < mesh.normals.length; i += 3) {
        const length = Math.hypot(...mesh.normals.slice(i, i + 3));
        assert.ok(Math.abs(length - 1) < 0.02, `${id}: invalid normal`);
      }
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(streetsPreparedModels)) < 64 * 1024);
});

test('Streets owns both tree representations and an extension can disable both', () => {
  assert.deepEqual(resolveMap(streets).models, [streetsModels]);
  for (const theme of ['light', 'dark']) {
    const style = compile(theme);
    const description = readTileflowVegetation3D(style.metadata);
    assert.ok(description);
    assert.equal(Object.keys(description.models ?? {}).length, 7);
    assert.deepEqual(description.flatLayers, [
      'tileflow-vegetation-trees',
      'tileflow-vegetation-render-crowns',
    ]);
    const crown = style.layers.find((layer) => layer.id === 'tileflow-vegetation-render-crowns');
    assert.ok(crown);
    assert.equal(crown.layout?.visibility, 'none');
    assert.equal(readTileflowVegetationDisplay(style.metadata)?.mode, '3d');
    assert.equal(readTileflowVegetationDisplay(style.metadata)?.fallback, 'none');
    const policy = readTileflowVegetationDisplay(style.metadata);
    for (const viewMode of ['2d', '3d'] as const) {
      assert.equal(
        resolveTileflowVegetationRepresentation(policy, {viewMode, supports3D: true}),
        '3d',
      );
      assert.equal(
        resolveTileflowVegetationRepresentation(policy, {viewMode, supports3D: false}),
        'none',
      );
      assert.equal(
        resolveTileflowVegetationRepresentation(policy, {
          viewMode,
          supports3D: true,
          visible: false,
        }),
        'none',
      );
    }
    assert.equal(crown.layout?.['icon-ignore-placement'], true);
    assert.equal(crown.layout?.['icon-pitch-alignment'], 'map');
    for (const form of streetsTreeForms) {
      assert.ok(
        JSON.stringify(crown.layout?.['icon-image']).includes(
          `streets-tree-${form}${theme === 'dark' ? '-dark' : ''}`,
        ),
      );
    }
    const bare = compile(
      theme,
      defineMap({
        id: 'bare-streets',
        version: 1,
        extends: streets,
        modules: {vegetation: disable()},
      }),
    );
    assert.equal(readTileflowVegetation3D(bare.metadata), undefined);
    assert.equal(
      bare.layers.some((layer) => layer.id.startsWith('tileflow-vegetation-')),
      false,
    );
  }
});

test('flat crowns scale continuously at fractional zooms and bound malformed source sizes', () => {
  const crown = compile().layers.find((layer) => layer.id === 'tileflow-vegetation-render-crowns')!;
  const parsed = createPropertyExpression(
    crown.layout?.['icon-size'],
    styleSpec.layout_symbol['icon-size'],
  );
  assert.equal(parsed.result, 'success');
  if (parsed.result !== 'success') throw new Error('Invalid crown size');
  const size = (zoom: number, diameter?: unknown) =>
    Number(parsed.value.evaluate({zoom}, {type: 1, properties: {diameter_crown: diameter}}));
  for (let z = 15.5; z < 21; z += 0.125) {
    assert.ok(Math.abs(size(z + 1) / size(z) - 2) < 1e-8);
    assert.equal(size(z, -2), size(z));
    assert.equal(size(z, 'unknown'), size(z));
    assert.equal(size(z, 999), size(z, 18));
    assert.equal(size(z, 1), size(z, 3));
    assert.ok(size(z + 0.001) - size(z) < 0.004);
  }
});

test('Streets extensions select flat or automatic trees without replacing their artwork', () => {
  for (const mode of ['flat', 'auto'] as const) {
    const style = compile(
      'light',
      defineMap({
        id: `streets-${mode}`,
        version: 1,
        extends: streets,
        modules: {vegetation: refine({mode})},
      }),
    );
    const display = readTileflowVegetationDisplay(style.metadata)!;
    assert.equal(display.mode, mode);
    assert.equal(display.fallback, 'none');
    for (const {id, visible} of display.flatLayers) {
      assert.equal(visible, true);
      assert.notEqual(style.layers.find((layer) => layer.id === id)?.layout?.visibility, 'none');
    }
    assert.equal(Boolean(readTileflowVegetation3D(style.metadata)), mode === 'auto');
  }
  const hidden = compile(
    'light',
    defineMap({
      id: 'hidden-trees',
      version: 1,
      extends: streets,
      modules: {vegetation: refine({visible: false})},
    }),
  );
  assert.equal(readTileflowVegetationDisplay(hidden.metadata)?.visible, false);
  assert.ok(readTileflowVegetation3D(hidden.metadata));
});
