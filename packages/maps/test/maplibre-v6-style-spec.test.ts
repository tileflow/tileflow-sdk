import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec-v6';
import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {basename} from 'node:path';
import test from 'node:test';
import {createStyle} from '@tileflow/core';
import {
  baedeker,
  cyberpunk,
  ferraris,
  harad,
  matrix,
  sanFrancisto,
  siegfried,
  soundings,
  streets,
  verdant,
} from '../src';

const officialMaps = [
  baedeker,
  cyberpunk,
  ferraris,
  harad,
  matrix,
  sanFrancisto,
  siegfried,
  soundings,
  streets,
  verdant,
] as const;

test('official styles remain valid for MapLibre GL JS 6 style-spec', async () => {
  const iconIds = await readIconIds(new URL('../assets/', import.meta.url));
  const preparedAssets = {
    icons: {
      ids: iconIds,
      sprite: '/tileflow/test/official/sprite',
    },
  };

  for (const map of officialMaps) {
    for (const theme of Object.keys(map.themes ?? {})) {
      const style = createStyle(map, {preparedAssets, theme});
      assert.deepEqual(validateStyleMin(style as never), [], `${map.id}:${theme}`);
    }
  }
});

async function readIconIds(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const ids = await Promise.all(
    entries.map(async (entry) => {
      const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
      if (entry.isDirectory()) return readIconIds(path);
      if (!/\.(?:png|svg)$/u.test(entry.name)) return [];
      return [
        basename(entry.name)
          .replace(/\.pattern\.(?:png|svg)$/u, '')
          .replace(/\.(?:png|svg)$/u, ''),
      ];
    }),
  );
  return ids.flat();
}
