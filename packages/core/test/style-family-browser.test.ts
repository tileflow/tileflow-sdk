import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import {createTileflowStyleFamily, materializeTileflowStyleFamily} from '../src/style-family';
import {createTileflowFamilyAnimator} from '../src/style-family-browser';
import type {MapLibreStyle} from '../src/types';

const styles = Object.fromEntries(
  Array.from({length: 12}, (_, i) => [
    `theme-${i}`,
    {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'water',
          type: 'background',
          paint: {'background-color': `#${(i * 20000).toString(16).padStart(6, '0')}`},
        },
      ],
      metadata: {
        'tileflow:theme': `theme-${i}`,
        'tileflow:vegetation': {colors: {bark: `#${(i * 20000).toString(16).padStart(6, '0')}`}},
      },
    } as MapLibreStyle,
  ]),
);

test('all 132 directed appearance changes keep the map style, sources and application content', async () => {
  const family = createTileflowStyleFamily(styles);
  const paints = new Map();
  const map = {
    on() {},
    off() {},
    setStyle() {
      assert.fail('appearance changes must not call setStyle');
    },
    setPaintProperty(id: string, name: string, value: unknown) {
      paints.set(`${id}/${name}`, value);
    },
  };
  const runtime = (theme: string) => ({
    theme,
    family,
    style: materializeTileflowStyleFamily(family, theme),
  });
  const controller = createTileflowThemeController({
    initial: runtime('theme-0'),
    map,
    loadFonts: async () => assert.fail('same-family colors do not reload fonts'),
  });
  for (const from of family.themes)
    for (const to of family.themes)
      if (from !== to) {
        assert.equal(
          (await controller.setTheme(runtime(from), {transition: {duration: 0}})).status,
          'applied',
        );
        assert.equal(
          (await controller.setTheme(runtime(to), {transition: {duration: 0}})).status,
          'applied',
        );
        assert.equal(
          paints.get('water/background-color'),
          (styles[to]!.layers[0]!.paint as Record<string, unknown>)['background-color'],
        );
        const metadata = controller.getThemeMetadata('tileflow:vegetation');
        assert.deepEqual(metadata.values.at(-1), styles[to]!.metadata!['tileflow:vegetation']);
      }
  controller.dispose();
});

test('a new request starts from the appearance on screen and cancels outstanding work', async () => {
  const family = createTileflowStyleFamily(styles);
  let now = 0;
  let next = 0;
  const callbacks = new Map<number, (time: number) => void>();
  let color: unknown;
  const animator = createTileflowFamilyAnimator({
    family,
    initialTheme: 'theme-0',
    now: () => now,
    requestFrame: (cb) => {
      callbacks.set(++next, cb);
      return next;
    },
    cancelFrame: (id) => {
      callbacks.delete(id);
    },
    writePaint(_id, _name, value) {
      color = value;
    },
    onFrame() {},
  });
  const first = animator.setTheme('theme-11', 100);
  now = 40;
  const frame = [...callbacks.values()][0]!;
  callbacks.clear();
  frame(now);
  const halfway = color;
  const second = animator.setTheme('theme-5', 100);
  assert.equal((await first).status, 'superseded');
  assert.equal(color, halfway);
  now = 150;
  const finish = [...callbacks.values()][0]!;
  callbacks.clear();
  finish(now);
  assert.equal((await second).status, 'applied');
  assert.equal(callbacks.size, 0);
  animator.dispose();
});

test('failed blend preparation and renderer writes retain the last valid appearance', async () => {
  const family = createTileflowStyleFamily(styles);
  let color: unknown;
  let failNext = false;
  const animator = createTileflowFamilyAnimator({
    family,
    initialTheme: 'theme-0',
    onFrame() {},
    writePaint(_layer, _property, value) {
      if (failNext) {
        failNext = false;
        throw new Error('Renderer unavailable');
      }
      color = value;
    },
  });
  await animator.setBlend(['theme-0', 'theme-11'], 0.5);
  const before = color;
  assert.equal((await animator.setBlend(['missing', 'theme-11'], 0.5)).status, 'failed');
  assert.equal(color, before);
  failNext = true;
  assert.equal((await animator.setBlend(['theme-0', 'theme-11'], 0.8)).status, 'failed');
  assert.equal(color, before);
  assert.equal((await animator.setTheme('theme-5', 0)).status, 'applied');
  animator.dispose();
});
