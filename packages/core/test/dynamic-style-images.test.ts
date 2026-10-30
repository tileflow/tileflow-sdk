import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import type {MapLibreStyle} from '../src/types';

type Pixels = {width: number; height: number; data: Uint8Array};
type Image = {data: Pixels; pixelRatio: number; sdf?: boolean};
type Listener = (event?: unknown) => void;

class ImageMap {
  images = new Map<string, Image>();
  uploads: string[] = [];
  adds: string[] = [];
  removals: string[] = [];
  state: Record<string, unknown> = {};
  loaded = true;
  styleReads = 0;
  style: MapLibreStyle = {version: 8, sources: {}, layers: []};
  listeners = new Map<string, Set<Listener>>();
  frames = new Map<number, () => void>();
  nextFrame = 0;
  view = {
    requestAnimationFrame: (fn: () => void) => {
      const id = ++this.nextFrame;
      this.frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id: number) => this.frames.delete(id),
    matchMedia: () => ({matches: false}),
  };

  on(name: string, fn: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  off(name: string, fn: Listener) {
    this.listeners.get(name)?.delete(fn);
  }
  fire(name: string) {
    for (const fn of [...(this.listeners.get(name) ?? [])]) fn();
  }
  frame() {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const fn of callbacks) fn();
  }
  getCanvas() {
    return {ownerDocument: {defaultView: this.view}};
  }
  getStyle() {
    this.styleReads++;
    return this.loaded ? this.style : undefined;
  }
  getImage(id: string) {
    return this.images.get(id);
  }
  addImage(id: string, pixels: Pixels, options: {pixelRatio: number; sdf?: boolean}) {
    assert.ok(!this.images.has(id));
    this.adds.push(id);
    this.images.set(id, {data: structuredClone(pixels), ...options});
  }
  updateImage(id: string, pixels: Pixels) {
    assert.equal(pixels.width, this.images.get(id)!.data.width);
    assert.equal(pixels.height, this.images.get(id)!.data.height);
    this.uploads.push(id);
    this.images.set(id, {...this.images.get(id)!, data: structuredClone(pixels)});
  }
  removeImage(id: string) {
    this.removals.push(id);
    this.images.delete(id);
  }
  setStyle(style: MapLibreStyle) {
    this.images.clear();
    this.style = style;
    queueMicrotask(() => this.fire('style.load'));
  }
  setGlobalStateProperty(name: string, value: unknown) {
    if (!this.loaded) throw new Error('Style is not loaded');
    this.state[name] = value;
  }
  setPaintProperty() {}
  setLayoutProperty() {}
}

const pixels = (value: number) => new Uint8Array(4 * 4 * 4).fill(value);
const definition = {width: 4, height: 4, pixelRatio: 2, render: () => pixels(20)};
const controllerFor = (map: ImageMap) =>
  createTileflowThemeController({
    initial: {theme: 'day', style: map.style},
    loadFonts: async () => {},
    map,
    // This suite advances image frames manually. Theme animation is covered by theme-motion;
    // awaiting an animated theme here would wait forever for a frame the test has not advanced.
    transition: {duration: 0},
  });

test('registration preserves dimensions, DPR and map structure before the first frame', () => {
  const map = new ImageMap();
  const before = structuredClone(map.style);
  const controller = controllerFor(map);
  const image = controller.registerImage('alert', definition);

  assert.deepEqual(map.getImage('alert'), {
    data: {width: 4, height: 4, data: pixels(20)},
    pixelRatio: 2,
  });
  assert.deepEqual(map.style, before);
  assert.equal(map.frames.size, 0);
  image.dispose();
  image.dispose();
  assert.deepEqual(map.removals, ['alert']);
});

test('a signed distance field image is added as one, across style changes', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('pin', {...definition, sdf: true});
  assert.equal(map.getImage('pin')?.sdf, true);
  await controller.setTheme({theme: 'night', style: {version: 8, sources: {}, layers: []}});
  assert.equal(map.getImage('pin')?.sdf, true);
  controller.registerImage('plain', definition);
  assert.equal(map.getImage('plain')?.sdf, undefined);
});

test('state dependencies coalesce, read the latest value and skip identical state', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  let renders = 0;
  controller.registerImage('alert', {
    ...definition,
    states: ['severity'],
    render({states}) {
      renders++;
      return pixels(Number(states.severity ?? 0));
    },
  });

  await controller.setState('unrelated', 2);
  map.frame();
  assert.equal(renders, 1);
  await controller.setState('severity', 1);
  await controller.setState('severity', 2);
  assert.equal(map.frames.size, 1);
  map.frame();
  assert.equal(renders, 2);
  assert.deepEqual(map.uploads, ['alert']);
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(2));
  await controller.setState('severity', 2);
  map.frame();
  assert.equal(renders, 2);
});

test('a disposed handle cannot release a new resource that reuses its name', () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  const previous = controller.registerImage('alert', definition);
  previous.dispose();

  let value = 40;
  const current = controller.registerImage('alert', {
    ...definition,
    render: () => pixels(value),
  });
  previous.dispose();
  previous.refresh();

  value = 60;
  current.refresh();
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(60));
  assert.throws(() => controllerFor(map).registerImage('alert', definition), /owner|registered/i);

  current.dispose();
  assert.equal(map.getImage('alert'), undefined);
  assert.deepEqual(map.removals, ['alert', 'alert']);
});

test('theme and style reload restore pixels; theme context follows the committed change', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', {
    ...definition,
    render: ({theme}) => pixels(theme === 'night' ? 80 : 20),
  });

  assert.equal(
    (await controller.setTheme({theme: 'night', style: {...map.style}})).status,
    'applied',
  );
  assert.ok(map.getImage('alert'), 'restored synchronously at style.load');
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(80));
  map.images.clear();
  map.fire('style.load');
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(80));
});

test('an unset state and an explicit null produce distinct image inputs', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', {
    ...definition,
    states: ['severity'],
    render: ({states}) => pixels(states.severity === null ? 99 : 0),
  });
  await controller.setState('severity', null);
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(99));
});

test('registration before the initial style loads does not need a missing-image resolver', () => {
  const map = new ImageMap();
  map.loaded = false;
  controllerFor(map).registerImage('alert', definition);
  assert.equal(map.adds.length, 0);
  map.loaded = true;
  map.fire('style.load');
  assert.deepEqual(map.adds, ['alert']);
});

test('stable dynamic IDs follow blend context without competing with the image mixer', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', {
    ...definition,
    render: ({blend}) => pixels(Math.round((blend?.position ?? 0) * 100)),
  });
  const themes = ['day', 'night'].map((theme) => ({theme, style: {...map.style}}));

  assert.equal((await controller.setBlend({themes, position: 0.25})).status, 'applied');
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(25));
  await controller.setBlend({themes, position: 0.75});
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(75));
});

test('different image names across themes fail before a blender can overwrite a resource', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', definition);
  const themes = ['day', 'night'].map((theme) => ({
    theme,
    style: {
      version: 8 as const,
      sources: {
        points: {type: 'geojson' as const, data: {type: 'FeatureCollection', features: []}},
      },
      layers: [
        {
          id: 'points',
          type: 'symbol',
          source: 'points',
          layout: {'icon-image': theme === 'day' ? 'alert' : 'other'},
        },
      ],
    },
  }));
  const before = map.style;
  const result = await controller.setBlend({themes: themes as never, position: 0.5});
  assert.equal(result.status, 'failed');
  assert.match(result.error!.message, /identical across blended themes/);
  assert.equal(map.style, before);
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(20));
});

test('refresh coalesces and undefined pixels leave the current image unchanged', () => {
  const map = new ImageMap();
  let calls = 0;
  const image = controllerFor(map).registerImage('alert', {
    ...definition,
    render: () => (++calls === 1 ? pixels(20) : undefined),
  });
  image.refresh();
  image.refresh();
  map.frame();
  assert.equal(calls, 2);
  assert.equal(map.uploads.length, 0);
});

test('updating registered pixels does not serialize the map style on every frame', () => {
  const map = new ImageMap();
  const handle = controllerFor(map).registerImage('alert', definition);
  const reads = map.styleReads;
  handle.refresh();
  map.frame();
  assert.equal(map.uploads.length, 1);
  assert.equal(map.styleReads, reads);
});

test('invalid updates retain good pixels and report errors without stopping other resources', () => {
  const map = new ImageMap();
  const errors: Error[] = [];
  let bad = false;
  const controller = controllerFor(map);
  const image = controller.registerImage('alert', {
    ...definition,
    render: () => (bad ? new Uint8Array(3) : pixels(20)),
    onError: (error) => errors.push(error),
  });
  bad = true;
  image.refresh();
  map.frame();
  assert.equal(errors.length, 1);
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(20));
  bad = false;
  image.refresh();
  map.frame();
  assert.equal(map.uploads.length, 1);
});

test('duplicate ownership and malformed definitions fail before changing the map', () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', definition);
  assert.throws(() => controller.registerImage('alert', definition), /owner|registered/i);
  assert.throws(() => controllerFor(map).registerImage('alert', definition), /owner|registered/i);
  map.addImage('atlas', {width: 4, height: 4, data: pixels(10)}, {pixelRatio: 1});
  assert.throws(() => controller.registerImage('atlas', definition), /exist|owner/i);
  for (const invalid of [
    {width: 0},
    {height: Infinity},
    {pixelRatio: 0},
    {render: () => pixels(2).slice(1)},
  ]) {
    assert.throws(() => controller.registerImage('invalid', {...definition, ...invalid}));
  }
  assert.equal(map.getImage('atlas')!.pixelRatio, 1);
});

test('context loss suspends updates; restoration and disposal obey resource ownership', async () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  controller.registerImage('alert', {
    ...definition,
    states: ['severity'],
    render: ({states}) => pixels(Number(states.severity ?? 0)),
  });
  map.fire('webglcontextlost');
  map.loaded = false;
  // MapLibre restores cloned image records after destroying the old style.
  map.images = new Map([...map.images].map(([name, image]) => [name, structuredClone(image)]));
  await controller.setState('severity', 4);
  map.frame();
  assert.equal(map.uploads.length, 0);
  map.loaded = true;
  map.fire('webglcontextrestored');
  map.frame();
  assert.deepEqual(map.getImage('alert')!.data.data, pixels(4));
  assert.equal(
    map.state.severity,
    4,
    'Style expressions and dynamic pixels share the restored state',
  );
  await controller.setState('severity', 5);
  controller.dispose();
  map.frame();
  assert.equal(map.getImage('alert'), undefined);
  assert.equal(map.frames.size, 0);
  assert.throws(() => controller.registerImage('later', definition), /disposed/i);
});

test('map removal cancels queued work and never removes another owner image', () => {
  const map = new ImageMap();
  const controller = controllerFor(map);
  const image = controller.registerImage('alert', definition);
  map.addImage('other', {width: 4, height: 4, data: pixels(30)}, {pixelRatio: 1});
  image.refresh();
  map.fire('remove');
  map.frame();
  assert.equal(map.uploads.length, 0);
  assert.ok(map.getImage('other'));
  assert.equal([...map.listeners.values()].flatMap((set) => [...set]).length, 0);
});
