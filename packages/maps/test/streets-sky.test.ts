import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, readTileflowSky} from '@tileflow/core';
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

test('every Streets theme paints its own opaque sky and carries the skies of its family', () => {
  const skies = new Map<string, string>();
  for (const theme of Object.keys(streetsThemes)) {
    const style = createStyle(streets, {theme, preparedAssets});
    const sky = style.sky as Record<string, unknown> | undefined;
    assert.match(String(sky?.['sky-color']), /^#[0-9a-f]{6}$/u, theme);
    assert.match(String(sky?.['horizon-color']), /^#[0-9a-f]{6}$/u, theme);
    const metadata = readTileflowSky(style.metadata?.['tileflow:sky']);
    assert.equal(metadata?.starIntensity, 0.6, theme);
    // Every Streets theme belongs to a time-of-day family, so a placed sun can mix its skies.
    assert.ok(metadata?.timesOfDay, theme);
    skies.set(theme, String(sky?.['sky-color']));
  }
  assert.equal(skies.get('light'), '#4aa0e2');
  assert.equal(skies.get('dusk'), '#4a4784');
  assert.equal(skies.get('dark'), '#0b1630');
  // Monochrome skies are grey; faded skies stay distinct from the default family.
  const [red, green, blue] = skies.get('monochrome')!.slice(1).match(/../gu)!;
  assert.ok(red === green && green === blue);
  assert.notEqual(skies.get('faded'), skies.get('light'));
});

test('each time-of-day family lends its own skies, so monochrome stays grey', () => {
  const read = (theme: string) =>
    readTileflowSky(createStyle(streets, {theme, preparedAssets}).metadata?.['tileflow:sky'])!
      .timesOfDay!;
  const light = read('light');
  assert.deepEqual(read('dark'), light);
  assert.equal(light.dusk.color, '#4a4784');
  assert.equal(light.night.color, '#0b1630');
  assert.equal(light.dawn.glowColor, '#ffc77a');
  for (const moment of Object.values(read('dusk-monochrome'))) {
    for (const colour of [moment.color, moment.horizonColor, moment.glowColor]) {
      const [red, green, blue] = colour.slice(1).match(/../gu)!;
      assert.ok(red === green && green === blue, colour);
    }
  }
});
