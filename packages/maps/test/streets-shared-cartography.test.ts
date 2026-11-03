import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {createStyle, type MapLibreStyle, resolveTileflowTheme} from '@tileflow/core';
import {createTileflowStyleFamily} from '@tileflow/core/build';
import {
  materializeTileflowStyleFamily,
  prepareTileflowStyleFamilyForRendering,
} from '@tileflow/core/runtime';
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

function canonicalIcons(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/^unified-day-/u, '')
      .replace(/-(?:monochrome-dark|monochrome|dark)$/u, '');
  if (Array.isArray(value)) return value.map(canonicalIcons);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, node]) => [key, canonicalIcons(node)]),
    );
  return value;
}
function cartography(style: MapLibreStyle) {
  return {
    sources: style.sources,
    sprite: style.sprite,
    glyphs: style.glyphs,
    layers: style.layers.map(({paint, ...layer}) => ({
      ...layer,
      ...(layer.layout
        ? {
            layout: {
              ...layer.layout,
              'icon-image': canonicalIcons((layer.layout as Record<string, unknown>)['icon-image']),
            },
          }
        : {}),
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
    assert.deepEqual(
      canonicalIcons(resolved.tokens.image),
      canonicalIcons(day.tokens.image),
      `${name}: icon artwork`,
    );
    assert.deepEqual(
      cartography(createStyle(streets, {theme: name, preparedAssets})),
      expected,
      name,
    );
  }
});

test('Streets icon palettes preserve source geometry and dimensions', () => {
  const files = readdirSync(new URL('../assets/streets/icons/', import.meta.url));
  const geometry = (name: string) =>
    readFileSync(
      new URL(
        `../assets/streets/icons/${files.includes(`${name}.svg`) ? `${name}.svg` : `${name}.pattern.svg`}`,
        import.meta.url,
      ),
      'utf8',
    )
      .replace(/<(?:title|desc)>[\s\S]*?<\/(?:title|desc)>/gu, '')
      .replace(/(?:fill|stroke)="[^"]*"/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  const names = preparedAssets.icons.ids;
  for (const name of names) {
    const original = canonicalIcons(name) as string;
    if (name !== original && names.includes(original))
      assert.equal(geometry(name), geometry(original), name);
  }
});

test('Streets keeps the authored day inks and selects different night and monochrome artwork', () => {
  const icon = (theme: string) =>
    resolveTileflowTheme(streetsThemes[theme]!).tokens.image['poi.pictogram.food'];
  assert.equal(icon('light'), 'unified-day-food');
  assert.equal(icon('dark'), 'food-dark');
  assert.equal(icon('monochrome'), 'food-monochrome');
  assert.equal(icon('dusk-monochrome'), 'food-monochrome-dark');
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily(
      Object.fromEntries(
        ['light', 'dark', 'monochrome', 'dusk-monochrome'].map((theme) => [
          theme,
          createStyle(streets, {theme, preparedAssets, runtimeColors: true}),
        ]),
      ),
    ),
  );
  const style = materializeTileflowStyleFamily(family, 'monochrome');
  const images = style.metadata!['tileflow:family-images'] as {names: string[]}[];
  assert.ok(
    images.some(
      (image) =>
        image.names.includes('unified-day-food') && image.names.includes('food-monochrome'),
    ),
  );
  assert.equal(style.metadata!['tileflow:family-image-theme'], 'monochrome');
});
