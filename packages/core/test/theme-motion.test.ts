import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import type {TileflowRuntimeStyle} from '../src/runtime';
import {homography} from '../src/theme-motion-browser';
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
  assert.deepEqual(controller.getBlend(), {position: 0.25, themes: ['night', 'dusk', 'day']});
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

test('a theme transition covers the change with a snapshot that follows the camera', async () => {
  const {canvas, inserted} = browser();
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
  });

  const changed = controller.setTheme(theme('night', night), {transition: {duration: 30}});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(inserted.length, 1);
  const [snapshot] = inserted;
  assert.equal(snapshot!.drawn, 1);
  assert.equal(map.redraws, 1);
  assert.equal(snapshot!.width, 400);
  assert.equal(snapshot!.style.width, '200px');
  // Panning moves the snapshot with the map.
  map.offset = {x: 12, y: -4};
  map.fire('move');
  assert.match(snapshot!.style.transform!, /^matrix3d\(1,0,0,0,0,1,0,0,0,0,1,0,12,-4,0,1\)$/u);

  assert.deepEqual(await changed, {status: 'applied', theme: 'night'});
  assert.equal(snapshot!.removed, true);
  assert.equal(snapshot!.style.opacity, '0');
});

test('a theme transition changes at once when the viewer prefers reduced motion', async () => {
  const {canvas, inserted} = browser(true);
  const map = new CameraMap(canvas);
  const controller = createTileflowThemeController({
    initial: theme('day', day),
    loadFonts: () => Promise.resolve(),
    map,
    transition: {duration: 400},
  });

  assert.deepEqual(await controller.setTheme(theme('night', night)), {
    status: 'applied',
    theme: 'night',
  });
  assert.equal(inserted.length, 0);
});

test('maps four points exactly with a projective transform', () => {
  const from = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ] as const;
  const to = [
    [10, 5],
    [130, 0],
    [120, 70],
    [0, 60],
  ] as const;
  const [a, b, c, d, e, f, g, h, i] = homography(from, to)!;
  for (const [index, [x, y]] of from.entries()) {
    const w = g! * x + h! * y + i!;
    assert.ok(Math.abs((a! * x + b! * y + c!) / w - to[index]![0]) < 1e-9);
    assert.ok(Math.abs((d! * x + e! * y + f!) / w - to[index]![1]) < 1e-9);
  }
  assert.equal(
    homography(from, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]),
    undefined,
  );
});
