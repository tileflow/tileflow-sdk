import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import {createTileflowStyleFamily, materializeTileflowStyleFamily} from '../src/style-family';
import {createTileflowFamilyAnimator} from '../src/style-family-browser';
import {prepareTileflowStyleFamilyForRendering} from '../src/style-family-render';
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

test('prepared landcover fades retain their colour when interrupted and reversed', async () => {
  const make = (crop: string): MapLibreStyle => ({
    version: 8,
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/world.json'}},
    layers: [
      {
        id: 'landcover',
        type: 'fill',
        source: 'world',
        'source-layer': 'landcover',
        paint: {'fill-color': ['match', ['get', 'class'], 'crop', crop, '#aaddaa']},
      },
    ],
  });
  const transparent = 'rgba(0, 0, 0, 0)';
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily({day: make(transparent), dawn: make('#C9F2D0')}),
  );
  const crop = materializeTileflowStyleFamily(family, 'day').layers.find(
    (layer) => (layer.paint as Record<string, unknown>)['fill-color'] === transparent,
  )!;
  assert.ok(crop);
  let now = 0;
  let frame: (time: number) => void = () => assert.fail('no pending animation');
  const paints = new Map<string, unknown>();
  const animator = createTileflowFamilyAnimator({
    family,
    initialTheme: 'day',
    now: () => now,
    requestFrame(callback) {
      frame = callback;
      return 1;
    },
    cancelFrame() {},
    writePaint(id, property, value) {
      if (property === 'fill-color') paints.set(id, value);
    },
    onFrame() {},
  });
  const forward = animator.setTheme('dawn', 100);
  now = 50;
  frame(now);
  assert.equal(paints.get(String(crop.id)), 'rgba(201, 242, 208, 0.5)');
  const reverse = animator.setTheme('day', 100);
  assert.equal((await forward).status, 'superseded');
  now = 100;
  frame(now);
  assert.equal(paints.get(String(crop.id)), 'rgba(201, 242, 208, 0.25)');
  now = 150;
  frame(now);
  assert.equal((await reverse).status, 'applied');
  assert.equal(paints.get(String(crop.id)), transparent);
  assert.equal((await animator.setBlend(['day', 'dawn'], 0.5)).status, 'applied');
  assert.equal(paints.get(String(crop.id)), 'rgba(201, 242, 208, 0.5)');
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

test('a theme change before the style has loaded waits for it instead of failing', async () => {
  const family = createTileflowStyleFamily(styles);
  const paints = new Map();
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    style: {_loaded: false},
    on(name: string, listener: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
    },
    setStyle() {
      assert.fail('appearance changes must not call setStyle');
    },
    setPaintProperty(id: string, name: string, value: unknown) {
      // MapLibre's own check while the style document is still loading.
      if (!map.style._loaded) throw new Error('Style is not done loading.');
      paints.set(`${id}/${name}`, value);
    },
  };
  const runtime = (theme: string) => ({
    theme,
    family,
    style: materializeTileflowStyleFamily(family, theme),
  });
  const controller = createTileflowThemeController({initial: runtime('theme-0'), map});
  const change = controller.setTheme(runtime('theme-3'), {transition: {duration: 0}});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(paints.size, 0);

  map.style._loaded = true;
  for (const listener of [...(listeners.get('style.load') ?? [])]) listener();
  assert.equal((await change).status, 'applied');
  assert.equal(
    paints.get('water/background-color'),
    (styles['theme-3']!.layers[0]!.paint as Record<string, unknown>)['background-color'],
  );
  controller.dispose();
});
