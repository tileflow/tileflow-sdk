import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/streets-sky/sprite',
  },
  models: streetsPreparedModels,
};

test('every Streets theme paints its own opaque sky and declares the same stars', () => {
  const skies = new Map<string, string>();
  for (const theme of Object.keys(streetsThemes)) {
    const style = createStyle(streets, {theme, preparedAssets});
    const sky = style.sky as Record<string, unknown> | undefined;
    assert.match(String(sky?.['sky-color']), /^#[0-9a-f]{6}$/u, theme);
    assert.match(String(sky?.['horizon-color']), /^#[0-9a-f]{6}$/u, theme);
    assert.deepEqual(style.metadata?.['tileflow:sky'], {version: 1, starIntensity: 0.6}, theme);
    skies.set(theme, String(sky?.['sky-color']));
  }
  assert.equal(skies.get('light'), '#5c9ce6');
  assert.equal(skies.get('dusk'), '#4a4784');
  assert.equal(skies.get('dark'), '#0b1630');
  // Monochrome skies are grey; faded skies stay distinct from the default family.
  const [red, green, blue] = skies.get('monochrome')!.slice(1).match(/../gu)!;
  assert.ok(red === green && green === blue);
  assert.notEqual(skies.get('faded'), skies.get('light'));
});
