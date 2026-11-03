import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTileflowAppearance} from '../src/appearance';
import {createTileflowAppearanceController} from '../src/appearance-browser';
import type {TileflowRuntimeManifestMap} from '../src/runtime';

const map: TileflowRuntimeManifestMap = {
  name: 'example',
  defaultTheme: 'blue',
  themes: {
    blue: {styleUrl: '/blue.json'},
    evening: {styleUrl: '/evening.json'},
    black: {styleUrl: '/black.json'},
    morning: {styleUrl: '/morning.json'},
  },
  timeOfDay: {blue: {day: 'blue', dawn: 'morning', dusk: 'evening', night: 'black'}},
};
const date = (hour: number) => new Date(2026, 0, 10, hour);

test('fixed, system and clock modes select independently and blend across midnight', () => {
  const context = {date: date(12), colorScheme: 'dark' as const};
  assert.deepEqual(
    resolveTileflowAppearance(map, {mode: 'fixed', palette: 'blue', moment: 'day'}, context),
    {themes: ['blue'], position: 0},
  );
  assert.deepEqual(
    resolveTileflowAppearance(map, {mode: 'system', light: 'day', dark: 'night'}, context),
    {themes: ['black'], position: 0},
  );
  const selection = {
    mode: 'clock' as const,
    blend: true,
    schedule: [
      {hour: 6, moment: 'dawn' as const},
      {hour: 22, moment: 'night' as const},
    ],
  };
  assert.deepEqual(resolveTileflowAppearance(map, selection, {...context, date: date(2)}), {
    themes: ['black', 'morning'],
    position: 0.5,
  });
  assert.throws(
    () =>
      resolveTileflowAppearance(
        map,
        {
          ...selection,
          schedule: [
            {hour: 6, moment: 'day'},
            {hour: 6, moment: 'night'},
          ],
        },
        context,
      ),
    /distinct/,
  );
});

test('invalid automation changes leave the existing selection intact and disposal prevents writes', async () => {
  const shown: string[] = [];
  const automation = createTileflowAppearanceController({
    map,
    initial: {mode: 'fixed', moment: 'day'},
    now: () => date(12),
    resolve: (theme) => ({theme, style: map.themes[theme]!.styleUrl}),
    controller: {
      async setTheme(style) {
        shown.push(style.theme!);
        return {status: 'applied', theme: style.theme};
      },
      async setBlend() {
        assert.fail('No blend requested');
      },
    },
  });
  await automation.ready;
  assert.equal((await automation.set({mode: 'fixed', palette: 'missing'})).status, 'failed');
  await automation.refresh();
  assert.deepEqual(shown, ['blue', 'blue']);
  automation.dispose();
  assert.equal((await automation.set({mode: 'fixed', moment: 'night'})).status, 'superseded');
  assert.equal(shown.length, 2);
});
