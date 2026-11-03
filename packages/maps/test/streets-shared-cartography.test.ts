import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, type MapLibreStyle, resolveTileflowTheme} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/shared-cartography/sprite',
  },
  models: streetsPreparedModels,
};

function cartography(style: MapLibreStyle) {
  return {
    sources: style.sources,
    sprite: style.sprite,
    glyphs: style.glyphs,
    layers: style.layers.map(({paint, ...layer}) => ({
      ...layer,
      // Color expressions may differ; widths, visibility, opacity and placement may not.
      paint: Object.fromEntries(
        Object.entries(paint ?? {}).filter(([key]) => !key.includes('color')),
      ),
    })),
  };
}

test('all Streets appearances share daylight cartography, fonts and icon artwork', () => {
  const day = resolveTileflowTheme(streetsThemes.light);
  const expected = cartography(createStyle(streets, {theme: 'light', preparedAssets}));
  for (const [name, theme] of Object.entries(streetsThemes)) {
    const resolved = resolveTileflowTheme(theme);
    assert.deepEqual(resolved.typography, day.typography, `${name}: typography`);
    assert.deepEqual(resolved.tokens.font, day.tokens.font, `${name}: fonts`);
    assert.deepEqual(resolved.tokens.image, day.tokens.image, `${name}: icon artwork`);
    assert.deepEqual(
      cartography(createStyle(streets, {theme: name, preparedAssets})),
      expected,
      name,
    );
  }
});
