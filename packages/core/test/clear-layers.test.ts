import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser-bundle';
import {isTileflowClearValue, syncTileflowClearLayers} from '../src/clear-layers-browser';

const underlay = 'tileflow-global-landcover-underlay';

class ClearLayerMap {
  readonly #listeners = new Map<string, Set<(event?: unknown) => void>>();
  readonly layout = new Map<string, unknown>();
  opacity: unknown = 0;

  getLayer(id: string) {
    return id === underlay ? {id} : undefined;
  }
  getPaintProperty(id: string, property: string) {
    return id === underlay && property === 'raster-opacity' ? this.opacity : undefined;
  }
  getLayoutProperty(id: string, property: string) {
    return this.layout.get(`${id}/${property}`);
  }
  setLayoutProperty(id: string, property: string, value: unknown) {
    this.layout.set(`${id}/${property}`, value);
  }
  on(event: string, listener: (event?: unknown) => void) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }
  off(event: string, listener: (event?: unknown) => void) {
    this.#listeners.get(event)?.delete(listener);
  }
  emit(event: string) {
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
  setStyle() {}
}

test('a paint value is clear only when it is zero at every zoom', () => {
  assert.equal(isTileflowClearValue(0), true);
  assert.equal(isTileflowClearValue(0.2), false);
  assert.equal(isTileflowClearValue(['interpolate', ['linear'], ['zoom'], 0, 0, 11, 0]), true);
  assert.equal(isTileflowClearValue(['interpolate', ['linear'], ['zoom'], 0, 0.9, 11, 0]), false);
  assert.equal(isTileflowClearValue(['step', ['zoom'], 0, 8, 0]), true);
  assert.equal(isTileflowClearValue(['step', ['zoom'], 0, 8, ['get', 'x']]), false);
  assert.equal(isTileflowClearValue(undefined), false);
});

test('a shared underlay is hidden while clear and shown once it has opacity', () => {
  const map = new ClearLayerMap();
  syncTileflowClearLayers(map);
  assert.equal(map.layout.get(`${underlay}/visibility`), 'none');
  map.opacity = ['interpolate', ['linear'], ['zoom'], 0, 0.9, 11, 0];
  syncTileflowClearLayers(map);
  assert.equal(map.layout.get(`${underlay}/visibility`), 'visible');
});

test('the theme controller keeps clear shared layers hidden through style changes', () => {
  const map = new ClearLayerMap();
  const controller = createTileflowThemeController({
    initial: {style: {version: 8, sources: {}, layers: []}, theme: 'dark'},
    map: map as never,
  });
  // Hidden before the first frame, so the renderer never requests the underlay's image.
  assert.equal(map.layout.get(`${underlay}/visibility`), 'none');
  map.opacity = 0.9;
  map.emit('styledata');
  assert.equal(map.layout.get(`${underlay}/visibility`), 'visible');
  map.opacity = 0;
  map.emit('style.load');
  assert.equal(map.layout.get(`${underlay}/visibility`), 'none');
  controller.dispose();
  map.opacity = 0.9;
  map.emit('styledata');
  assert.equal(map.layout.get(`${underlay}/visibility`), 'none');
});
