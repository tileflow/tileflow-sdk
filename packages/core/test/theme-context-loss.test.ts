import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import type {TileflowRuntimeStyle} from '../src/runtime';
import type {MapLibreStyle} from '../src/types';

type Listener = (event?: unknown) => void;

/** A MapLibre-shaped map whose WebGL context can be lost and restored. */
class ContextMap {
  lost = false;
  readonly styles: unknown[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly context = {isContextLost: () => this.lost};
  private readonly canvas = {
    getContext: (kind: string) => (kind === 'webgl2' ? this.context : null),
  };

  getCanvas() {
    return this.canvas;
  }
  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  fire(event: string) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
  setStyle(style: unknown) {
    this.styles.push(style);
    queueMicrotask(() => this.fire('style.load'));
  }
}

const style = (name: string): MapLibreStyle => ({layers: [], name, sources: {}, version: 8});
const theme = (name: string): TileflowRuntimeStyle => ({
  fontFaces: [],
  style: style(name),
  theme: name,
});

function controllerFor(map: ContextMap) {
  return createTileflowThemeController({
    initial: theme('light'),
    loadFonts: () => Promise.resolve(),
    map: map as never,
  });
}

test('a theme change waits while the WebGL context is lost and applies once it is restored', async () => {
  const map = new ContextMap();
  const controller = controllerFor(map);
  map.lost = true;

  const result = controller.setTheme(theme('dark'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(map.styles, [], 'no style is set on a lost context');

  map.lost = false;
  map.fire('webglcontextrestored');
  assert.deepEqual(await result, {status: 'applied', theme: 'dark'});
  assert.equal(map.styles.length, 1);
});

test('a newer theme supersedes one waiting for the context, which never reaches the map', async () => {
  const map = new ContextMap();
  const controller = controllerFor(map);
  map.lost = true;

  const first = controller.setTheme(theme('dark'));
  const second = controller.setTheme(theme('dusk'));
  map.lost = false;
  map.fire('webglcontextrestored');

  assert.equal((await first).status, 'superseded');
  assert.deepEqual(await second, {status: 'applied', theme: 'dusk'});
  assert.deepEqual(
    map.styles.map((entry) => (entry as MapLibreStyle).name),
    ['dusk'],
  );
});

test('a drawing context changes theme at once', async () => {
  const map = new ContextMap();
  const controller = controllerFor(map);
  assert.deepEqual(await controller.setTheme(theme('dark')), {status: 'applied', theme: 'dark'});
  assert.equal(map.styles.length, 1);
});
