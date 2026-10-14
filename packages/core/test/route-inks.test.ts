import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineMap, defineTheme, disable} from '../src';
import {createTileflowThemeController} from '../src/browser';
import {
  mixTileflowRouteInks,
  readTileflowRouteInks,
  tileflowDefaultRouteInks,
  type TileflowRouteInks,
  tileflowRouteInksAt,
  tileflowRouteMetadataKey,
  tileflowStyleRouteInks,
} from '../src/route-inks';
import type {TileflowRuntimeStyle} from '../src/runtime';
import type {MapLibreStyle} from '../src/types';
import {testLightTheme} from './map-fixture';

const night = defineTheme(testLightTheme, {
  id: 'test-night',
  version: 1,
  colorScheme: 'dark',
  tokens: {
    color: {
      'route.line': '#ff4fae',
      'route.casing': '#0b0f12',
      'route.core': '#ffe0f0',
      'route.glow': '#ff4fae',
    },
    number: {'route.glow.opacity': 0.55, 'route.core.opacity': 0.9},
  },
});

// Every theme of a map carries the same tokens, so the light theme sets route inks as well.
const day = defineTheme(testLightTheme, {
  id: 'test-day',
  version: 1,
  colorScheme: 'light',
  tokens: {
    color: {
      'route.line': '#e3277c',
      'route.casing': '#0b0f12',
      'route.core': '#ffd6ea',
      'route.glow': '#e3277c',
    },
    number: {'route.glow.opacity': 0.22, 'route.core.opacity': 0.45},
  },
});

function mapWith(themes: Record<string, ReturnType<typeof defineTheme>>) {
  return defineMap({
    id: 'route-ink-map',
    version: 1,
    defaultTheme: 'light',
    glyphs: {
      kind: 'url',
      url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular'],
    },
    modules: {poi: disable()},
    themes,
  });
}

test('a theme without route tokens publishes its colour scheme defaults', () => {
  const style = createStyle(mapWith({light: testLightTheme}));
  assert.deepEqual(style.metadata?.[tileflowRouteMetadataKey], {
    version: 1,
    ...tileflowDefaultRouteInks.light,
  });
  assert.deepEqual(readTileflowRouteInks(style.metadata), tileflowDefaultRouteInks.light);
});

test('a theme publishes its own route tokens over its scheme defaults', () => {
  const style = createStyle(mapWith({light: day, night}), {theme: 'night'});
  assert.deepEqual(readTileflowRouteInks(style.metadata), {
    ...tileflowDefaultRouteInks.dark,
    line: '#ff4fae',
    casing: '#0b0f12',
    core: '#ffe0f0',
    glow: '#ff4fae',
    glowOpacity: 0.55,
    coreOpacity: 0.9,
  });
});

test('a route opacity outside 0 to 1 fails the compilation with the token named', () => {
  const broken = defineTheme(testLightTheme, {
    id: 'test-broken',
    version: 1,
    colorScheme: 'light',
    tokens: {number: {'route.glow.opacity': 1.4}},
  });
  assert.throws(
    () => createStyle(mapWith({light: broken})),
    /route\.glow\.opacity.*1\.4.*from 0 to 1/u,
  );
});

test('published inks are read back only when complete and in range', () => {
  const inks = {version: 1, ...tileflowDefaultRouteInks.dark};
  assert.deepEqual(
    readTileflowRouteInks({[tileflowRouteMetadataKey]: inks}),
    tileflowDefaultRouteInks.dark,
  );
  assert.equal(readTileflowRouteInks(undefined), undefined);
  assert.equal(
    readTileflowRouteInks({[tileflowRouteMetadataKey]: {...inks, version: 2}}),
    undefined,
  );
  assert.equal(readTileflowRouteInks({[tileflowRouteMetadataKey]: {...inks, line: ''}}), undefined);
  assert.equal(
    readTileflowRouteInks({[tileflowRouteMetadataKey]: {...inks, glowOpacity: 2}}),
    undefined,
  );
  // A style without inks takes the defaults of the scheme it declares, else the fallback.
  assert.deepEqual(
    tileflowStyleRouteInks({metadata: {'tileflow:colorScheme': 'dark'}}),
    tileflowDefaultRouteInks.dark,
  );
  assert.deepEqual(tileflowStyleRouteInks(undefined, 'dark'), tileflowDefaultRouteInks.dark);
});

test('inks mix in OKLab between themes and step through blend positions', () => {
  const from = tileflowDefaultRouteInks.light;
  const to: TileflowRouteInks = {...tileflowDefaultRouteInks.dark, line: '#ffffff'};
  assert.equal(mixTileflowRouteInks(from, to, 0), from);
  assert.equal(mixTileflowRouteInks(from, to, 1), to);
  const half = mixTileflowRouteInks(from, to, 0.5);
  assert.notEqual(half.line, from.line);
  assert.notEqual(half.line, to.line);
  assert.equal(half.glowOpacity, (from.glowOpacity + to.glowOpacity) / 2);
  const three = [from, to, tileflowDefaultRouteInks.light];
  assert.equal(tileflowRouteInksAt(three, 1).line, '#ffffff');
  assert.deepEqual(tileflowRouteInksAt(three, 1.5), mixTileflowRouteInks(to, from, 0.5));
  assert.deepEqual(tileflowRouteInksAt(three, 9), from);
  assert.equal(tileflowRouteInksAt([], 0), undefined);
});

type Listener = (event?: unknown) => void;

class BlendMap {
  private readonly listeners = new Map<string, Set<Listener>>();
  style: unknown;
  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  setStyle(style: unknown) {
    this.style = style;
    queueMicrotask(() => {
      for (const listener of [...(this.listeners.get('style.load') ?? [])]) listener();
    });
  }
  getStyle() {
    return this.style;
  }
  setPaintProperty() {}
  setLayoutProperty() {}
  getImage() {
    return null;
  }
  updateImage() {}
  setSky() {}
  setLight() {}
}

function compiled(line: string, scheme: 'dark' | 'light'): MapLibreStyle {
  return {
    layers: [{id: 'land', paint: {'fill-color': line}, source: 'world', type: 'fill'}],
    metadata: {
      'tileflow:colorScheme': scheme,
      [tileflowRouteMetadataKey]: {version: 1, ...tileflowDefaultRouteInks[scheme], line},
    },
    name: 'fixture',
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/world.json'}},
    version: 8,
  };
}

test('the controller returns the inks of the theme on screen, mixed during a blend', async () => {
  const map = new BlendMap();
  const day: TileflowRuntimeStyle = {
    colorScheme: 'light',
    fontFaces: [],
    style: compiled('#2563eb', 'light'),
    theme: 'day',
  };
  const dusk: TileflowRuntimeStyle = {
    colorScheme: 'dark',
    fontFaces: [],
    style: '/dusk.json',
    theme: 'dusk',
  };
  const controller = createTileflowThemeController({
    initial: day,
    loadFonts: () => Promise.resolve(),
    loadStyle: async () => compiled('#ff4fae', 'dark'),
    map,
  });
  assert.equal(controller.getRouteInks().line, '#2563eb');
  // The metadata of the style on screen, for an application's own layers.
  const shown = controller.getThemeMetadata(tileflowRouteMetadataKey);
  assert.equal(shown.position, 0);
  assert.deepEqual(
    shown.values.map((value) => (value as {line: string}).line),
    ['#2563eb'],
  );

  assert.equal((await controller.setBlend({position: 0.5, themes: [day, dusk]})).status, 'applied');
  const metadata = controller.getThemeMetadata(tileflowRouteMetadataKey);
  assert.equal(metadata.position, 0.5);
  assert.deepEqual(
    metadata.values.map((value) => (value as {line: string}).line),
    ['#2563eb', '#ff4fae'],
  );
  assert.deepEqual(controller.getThemeMetadata('tileflow:missing').values, [undefined, undefined]);
  const half = controller.getRouteInks();
  assert.notEqual(half.line, '#2563eb');
  assert.notEqual(half.line, '#ff4fae');
  assert.equal(
    half.glowOpacity,
    (tileflowDefaultRouteInks.light.glowOpacity + tileflowDefaultRouteInks.dark.glowOpacity) / 2,
  );

  await controller.setBlend({position: 1, themes: [day, dusk]});
  assert.equal(controller.getRouteInks().line, '#ff4fae');

  // A theme given by URL reads the inks of the style the map shows once it has loaded it.
  assert.equal((await controller.setTheme({...dusk, style: '/plain-dusk.json'})).status, 'applied');
  map.style = compiled('#00aa55', 'dark');
  assert.equal(controller.getRouteInks().line, '#00aa55');
  controller.dispose();
});
