import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import type {TileflowRuntimeStyle} from '../src/runtime';
import type {MapLibreStyle} from '../src/types';

type Listener = (event?: unknown) => void;

/** A MapLibre-shaped map that records what the controller asks of it. */
class FakeMap {
  readonly styles: unknown[] = [];
  readonly paints: [string, string, unknown][] = [];
  readonly layouts: [string, string, unknown][] = [];
  readonly updatedImages: string[] = [];
  readonly images = new Map<string, {data: Uint8Array; height: number; width: number}>();
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  fire(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }
  setStyle(style: unknown) {
    this.styles.push(style);
    queueMicrotask(() => this.fire('style.load'));
  }
  setPaintProperty(layer: string, name: string, value: unknown) {
    this.paints.push([layer, name, value]);
  }
  setLayoutProperty(layer: string, name: string, value: unknown) {
    this.layouts.push([layer, name, value]);
  }
  getImage(name: string) {
    const image = this.images.get(name);
    return image ? {data: image} : null;
  }
  updateImage(name: string, image: {data: Uint8Array; height: number; width: number}) {
    this.updatedImages.push(name);
    this.images.set(name, image);
  }
  setSky() {}
  setLight() {}
}

function theme(name: string, style: MapLibreStyle | string): TileflowRuntimeStyle {
  return {fontFaces: [], style, theme: name};
}

function ground(colour: string, opacity: number, label: string, icon: string): MapLibreStyle {
  return {
    glyphs: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'land',
        paint: {'fill-color': colour, 'fill-opacity': opacity},
        source: 'world',
        type: 'fill',
      },
      {
        id: 'names',
        layout: {'icon-image': icon, 'text-field': ['get', 'name']},
        paint: {
          'text-color': [
            'case',
            ['boolean', ['feature-state', 'highlight'], false],
            '#ff00ff',
            label,
          ],
        },
        source: 'world',
        type: 'symbol',
      },
    ],
    name: 'fixture',
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/world.json'}},
    sprite: 'https://fixtures.tileflow.test/sprite',
    version: 8,
  };
}

const night = ground('#000000', 0.2, '#ffffff', 'pin');
const dusk = ground('#402040', 0.5, '#f0e0ff', 'pin-dusk');
const day = ground('#ffffff', 0.8, '#202020', 'pin-day');
const pixels = (value: number) => ({data: new Uint8Array(4).fill(value), height: 1, width: 1});

function controllerFor(map: FakeMap, loaded: Record<string, MapLibreStyle> = {}) {
  const loads: string[] = [];
  const transitions: string[] = [];
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    async loadStyle(url) {
      loads.push(url);
      const style = loaded[url];
      if (!style) throw new Error(`missing ${url}`);
      return style;
    },
    map,
    onTransition: (transition) => transitions.push(`${transition.phase}:${transition.targetTheme}`),
  });
  return {controller, loads, transitions};
}

test('a blend loads every theme once and applies one style that holds all of them', async () => {
  const map = new FakeMap();
  for (const [name, value] of [
    ['pin', 0],
    ['pin-dusk', 128],
    ['pin-day', 255],
  ] as const)
    map.images.set(name, pixels(value));
  const {controller, loads, transitions} = controllerFor(map, {
    '/dusk.json': dusk,
    '/night.json': night,
  });

  const result = await controller.setBlend({
    position: 0.25,
    themes: [theme('night', '/night.json'), theme('dusk', '/dusk.json'), theme('day', day)],
  });

  assert.deepEqual(result, {status: 'applied', theme: 'night'});
  assert.deepEqual(loads.sort(), ['/dusk.json', '/night.json']);
  assert.equal(map.styles.length, 1);
  const applied = map.styles[0] as MapLibreStyle;
  // A quarter of the way from night to dusk, and the first theme's icon name.
  assert.equal(applied.layers[0]!.paint!['fill-opacity'], 0.275);
  assert.equal((applied.layers[1]!.layout as Record<string, unknown>)['icon-image'], 'pin');
  assert.deepEqual(controller.getBlend(), {
    held: false,
    position: 0.25,
    relayoutAt: [0.5, 1.5],
    themes: ['night', 'dusk', 'day'],
  });
  assert.equal(controller.getCurrent().theme, 'night');
  assert.deepEqual(transitions, ['preloading:night', 'applying:night', 'ready:night']);
});

test('moving the same blend changes values at once without restyling the map', async () => {
  const map = new FakeMap();
  for (const [name, value] of [
    ['pin', 0],
    ['pin-dusk', 128],
    ['pin-day', 255],
  ] as const)
    map.images.set(name, pixels(value));
  const {controller} = controllerFor(map);
  const themes = [theme('night', night), theme('dusk', dusk), theme('day', day)];
  await controller.setBlend({position: 0, themes});

  const moved = await controller.setBlend({position: 0.5, themes});
  assert.deepEqual(moved, {status: 'applied', theme: 'dusk'});
  assert.equal(map.styles.length, 1, 'no style replacement');
  assert.deepEqual(
    map.paints.find(([layer, name]) => layer === 'land' && name === 'fill-opacity'),
    ['land', 'fill-opacity', 0.35],
  );
  // The nearest theme changed from night to dusk: the value that reads feature state switched,
  // labels followed, and the icon artwork was mixed into the first theme's image name.
  assert.ok(
    map.paints.some(
      ([layer, name, value]) =>
        layer === 'names' && name === 'text-color' && JSON.stringify(value).includes('#f0e0ff'),
    ),
  );
  assert.equal(map.images.get('pin')!.data[0], 128);
  assert.equal(controller.getCurrent().theme, 'dusk');
  assert.deepEqual(controller.getBlend()?.position, 0.5);
});

test('a held blend keeps the nearest theme and its artwork until a request without hold', async () => {
  const map = new FakeMap();
  for (const [name, value] of [
    ['pin', 0],
    ['pin-dusk', 128],
    ['pin-day', 255],
  ] as const)
    map.images.set(name, pixels(value));
  const {controller} = controllerFor(map);
  const themes = [theme('night', night), theme('dusk', dusk), theme('day', day)];
  await controller.setBlend({position: 0, themes});
  map.paints.length = 0;
  map.updatedImages.length = 0;

  // Short of the next theme, with no pattern artwork to mix, nothing waits.
  await controller.setBlend({hold: true, position: 0.25, themes});
  assert.equal(controller.getBlend()?.held, false);
  map.paints.length = 0;

  const held = await controller.setBlend({hold: true, position: 0.75, themes});
  assert.deepEqual(held, {status: 'applied', theme: 'night'});
  // Ground values follow the position; the switch, the labels, and the artwork wait.
  assert.deepEqual(
    map.paints.find(([layer, name]) => layer === 'land' && name === 'fill-opacity'),
    ['land', 'fill-opacity', 0.425],
  );
  assert.ok(!map.paints.some(([layer]) => layer === 'names'));
  assert.deepEqual(map.updatedImages, []);
  assert.equal(controller.getCurrent().theme, 'night');
  assert.equal(controller.getBlend()?.held, true);

  await controller.setBlend({position: 0.75, themes});
  assert.ok(
    map.paints.some(
      ([layer, name, value]) =>
        layer === 'names' && name === 'text-color' && JSON.stringify(value).includes('#f0e0ff'),
    ),
  );
  assert.equal(map.images.get('pin')!.data[0], 128);
  assert.equal(controller.getCurrent().theme, 'dusk');
  assert.equal(controller.getBlend()?.held, false);
});

test('a blend uploads no artwork two themes share, by name or pixel for pixel', async () => {
  const twin = ground('#402040', 0.5, '#f0e0ff', 'pin-twin');
  const shared = ground('#402040', 0.5, '#f0e0ff', 'pin');
  for (const second of [shared, twin]) {
    const map = new FakeMap();
    for (const [name, value] of [
      ['pin', 0],
      ['pin-twin', 0],
      ['pin-day', 255],
    ] as const)
      map.images.set(name, pixels(value));
    const {controller} = controllerFor(map);
    const themes = [theme('night', night), theme('dusk', second), theme('day', day)];
    await controller.setBlend({position: 0, themes});
    for (const position of [0.3, 0.6, 1, 0.4]) await controller.setBlend({position, themes});
    assert.deepEqual(map.updatedImages, []);
    // Across the second pair the artwork differs and is mixed.
    await controller.setBlend({position: 1.5, themes});
    assert.ok(map.updatedImages.includes('pin'));
  }
});

test('concurrent first requests for the same blend share one load and keep the latest position', async () => {
  const map = new FakeMap();
  const {controller, loads} = controllerFor(map, {'/night.json': night});
  const themes = [theme('night', '/night.json'), theme('day', day)];

  const first = controller.setBlend({position: 0, themes});
  const second = controller.setBlend({position: 0.75, themes});
  assert.equal(first, second);
  assert.deepEqual(await second, {status: 'applied', theme: 'day'});
  assert.deepEqual(loads, ['/night.json']);
  assert.equal(controller.getBlend()?.position, 0.75);
});

test('choosing one theme leaves the blend and stops moving the map', async () => {
  const map = new FakeMap();
  const {controller} = controllerFor(map);
  const themes = [theme('night', night), theme('day', day)];
  await controller.setBlend({position: 0.5, themes});

  assert.deepEqual(await controller.setTheme(theme('night', night)), {
    status: 'applied',
    theme: 'night',
  });
  assert.equal(controller.getBlend(), undefined);
  assert.equal(map.styles.at(-1), night);
  const paints = map.paints.length;
  // A later blend request prepares the blend again.
  await controller.setBlend({position: 1, themes});
  assert.equal(map.styles.length, 3);
  assert.ok(map.paints.length >= paints);
});

test('rejects blends and transitions that cannot be shown', async () => {
  const map = new FakeMap();
  const {controller} = controllerFor(map);

  const single = await controller.setBlend({position: 0, themes: [theme('day', day)]});
  assert.equal(single.status, 'failed');
  const outside = await controller.setBlend({
    position: 2,
    themes: [theme('night', night), theme('day', day)],
  });
  assert.equal(outside.status, 'failed');
  assert.match(String(outside.error), /from 0 to 1/u);
  const unnamed = await controller.setBlend({
    position: 0,
    themes: [{style: night}, theme('day', day)],
  });
  assert.equal(unnamed.status, 'failed');
  const slow = await controller.setTheme(theme('night', night), {transition: {duration: 60_000}});
  assert.equal(slow.status, 'failed');
  assert.match(String(slow.error), /0 to 5000/u);
  assert.equal(map.styles.length, 0);
});

test('a blend of themes from different maps fails without changing the map', async () => {
  const map = new FakeMap();
  const {controller, transitions} = controllerFor(map);
  const other: MapLibreStyle = {...night, layers: [night.layers[0]!]};

  const result = await controller.setBlend({
    position: 0,
    themes: [theme('night', other), theme('day', day)],
  });
  assert.equal(result.status, 'failed');
  assert.match(String(result.error), /same layers/u);
  assert.equal(map.styles.length, 0);
  assert.equal(transitions.at(-1), 'error:night');
});

/** A minimal browser around the map canvas for the cross-fade. */
function browser(reducedMotion = false) {
  const inserted: FakeElement[] = [];
  class FakeElement {
    width = 0;
    height = 0;
    drawn = 0;
    removed = false;
    readonly style: Record<string, string> = {};
    readonly dataset: Record<string, string> = {};
    getContext() {
      return {drawImage: () => (this.drawn += 1)};
    }
    setAttribute() {}
    remove() {
      this.removed = true;
    }
  }
  const view = {
    cancelAnimationFrame: clearTimeout,
    clearTimeout,
    matchMedia: () => ({matches: reducedMotion}),
    performance,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 1),
    setTimeout,
  };
  const canvas = {
    after: (element: FakeElement) => inserted.push(element),
    clientHeight: 100,
    clientWidth: 200,
    height: 200,
    ownerDocument: {createElement: () => new FakeElement(), defaultView: view},
    width: 400,
  };
  return {canvas, inserted};
}

class CameraMap extends FakeMap {
  offset = {x: 0, y: 0};
  redraws = 0;
  constructor(private readonly canvas: unknown) {
    super();
  }
  getCanvas() {
    return this.canvas;
  }
  redraw() {
    this.redraws += 1;
  }
  isStyleLoaded() {
    return true;
  }
  areTilesLoaded() {
    return true;
  }
  unproject([x, y]: [number, number]) {
    return {x: x - this.offset.x, y: y - this.offset.y};
  }
  project(point: {x: number; y: number}) {
    return {x: point.x + this.offset.x, y: point.y + this.offset.y};
  }
}

test('a theme change draws intermediate values on the live map and removes temporary layers', async () => {
  const {canvas, inserted} = browser();
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });
  const changed = controller.setTheme(theme('night', night));
  map.offset = {x: 12, y: -4};
  map.fire('move');
  assert.deepEqual(await changed, {status: 'applied', theme: 'night'});
  assert.equal(inserted.length, 0);
  assert.ok(
    map.paints.some(
      ([layer, property, value]) =>
        layer === 'land' &&
        property === 'fill-opacity' &&
        typeof value === 'number' &&
        value > 0.2 &&
        value < 0.8,
    ),
  );
  assert.equal(map.styles.at(-1), night);
  assert.equal(controller.getBlend(), undefined);
  controller.dispose();
});

test('an incompatible style cover is removed when the camera moves', async () => {
  const {canvas, inserted} = browser();
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });
  const other = {
    ...night,
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/other.json'}},
  } as MapLibreStyle;
  const changed = controller.setTheme(theme('other', other));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(inserted.length, 1);
  map.fire('move');
  assert.equal(inserted[0]!.removed, true);
  assert.equal(inserted[0]!.style.transform, undefined);
  assert.equal((await changed).status, 'applied');
  controller.dispose();
});

test('an already loaded style diff can complete without a style.load event', async () => {
  const {canvas} = browser();
  const map = new CameraMap(canvas);
  map.setStyle = (style) => {
    map.styles.push(style);
  };
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });
  assert.deepEqual(await controller.setTheme(theme('night', night), {transition: {duration: 10}}), {
    status: 'applied',
    theme: 'night',
  });
  assert.equal(map.styles.at(-1), night);
  controller.dispose();
});

test('superseding a live transition cancels its frames and commits only the latest destination', async () => {
  const {canvas, inserted} = browser();
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });
  const first = controller.setTheme(theme('night', night), {transition: {duration: 5000}});
  await new Promise((resolve) => setTimeout(resolve, 5));
  const last = controller.setTheme(theme('dusk', dusk), {transition: {duration: 10}});
  assert.equal((await first).status, 'superseded');
  assert.deepEqual(await last, {status: 'applied', theme: 'dusk'});
  assert.equal(map.styles.at(-1), dusk);
  assert.equal(controller.getBlend(), undefined);
  assert.equal(inserted.length, 0);
  controller.dispose();
});

test('disposing a live transition settles the request and stops further style writes', async () => {
  const {canvas} = browser();
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });
  const changed = controller.setTheme(theme('night', night), {transition: {duration: 5000}});
  await new Promise((resolve) => setTimeout(resolve, 5));
  const count = map.styles.length;
  controller.dispose();
  assert.equal((await changed).status, 'superseded');
  assert.equal(map.styles.length, count);
});

test('theme transitions inherit defaults and allow custom durations or immediate changes', async () => {
  for (const {configured, requested, duration} of [
    {configured: {}, requested: {}, duration: 450},
    {configured: {duration: 30}, requested: undefined, duration: 30},
    {configured: {duration: 0}, requested: undefined, duration: 0},
    {configured: undefined, requested: {duration: 0}, duration: 0},
    {configured: {duration: 0}, requested: {duration: 30}, duration: 30},
  ]) {
    const {canvas, inserted} = browser();
    const map = new CameraMap(canvas);
    const controller = createTileflowThemeController({
      initial: theme('day', day),
      loadFonts: () => Promise.resolve(),
      map,
      transition: configured,
    });
    assert.deepEqual(await controller.setTheme(theme('night', night), {transition: requested}), {
      status: 'applied',
      theme: 'night',
    });
    assert.equal(inserted.length, 0);
    assert.equal(map.styles.length, duration === 0 ? 1 : 2);
    assert.equal(map.styles.at(-1), night);
    controller.dispose();
  }
});

test('entering and leaving a blend cross-fades by default', async () => {
  const {canvas, inserted} = browser();
  const {controller} = controllerFor(new CameraMap(canvas));
  assert.equal(
    (
      await controller.setBlend({
        position: 0.25,
        themes: [theme('night', night), theme('day', day)],
      })
    ).status,
    'applied',
  );
  assert.equal((await controller.setTheme(theme('day', day))).status, 'applied');
  assert.equal(inserted.length, 2);
  for (const snapshot of inserted) {
    assert.equal(snapshot.style.transition, 'opacity 450ms ease');
    assert.equal(snapshot.removed, true);
  }
  controller.dispose();
});

test('a theme transition changes at once when the viewer prefers reduced motion', async () => {
  const {canvas, inserted} = browser(true);
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });

  assert.deepEqual(await controller.setTheme(theme('night', night)), {
    status: 'applied',
    theme: 'night',
  });
  assert.equal(inserted.length, 0);
  controller.dispose();
});
