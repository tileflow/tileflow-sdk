import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowBuildings3DLayerId} from '../src/buildings-3d-browser';
import {attachTileflowMap3D} from '../src/map-3d-attach-browser';

// React, Vue and Svelte mount the scene through attachTileflowMap3D with this loader.
const load = () => import('../src/3d');
const mounted = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeMap(initial: Record<string, unknown>) {
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Set<string>();
  let metadata = initial;
  let reads = 0;
  return {
    layers,
    get reads() {
      return reads;
    },
    fire(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
    loadStyle(next: Record<string, unknown>) {
      metadata = next;
      this.fire('styledata');
      this.fire('style.load');
    },
    addLayer(layer: {id: string}) {
      layers.add(layer.id);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    getPaintProperty: () => undefined,
    getPitch: () => 60,
    getSource: () => undefined,
    getStyle() {
      reads++;
      return {layers: [{id: 'labels', type: 'symbol'}], metadata};
    },
    getZoom: () => 16,
    isStyleLoaded: () => true,
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    triggerRepaint() {},
  };
}

const buildings = {
  'tileflow:buildings': {version: 1, landmarks: {url: 'https://example.com/landmarks.json'}},
};

test('a style that declares buildings mounts the 3D buildings by default', async () => {
  const map = fakeMap(buildings);
  const scene = attachTileflowMap3D({map, load});
  await mounted();
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  scene.dispose();
  assert.equal(map.layers.has(tileflowBuildings3DLayerId), false);
});

test('the 2D view opts out: no 3D layer is mounted until the scene is shown', async () => {
  const map = fakeMap(buildings);
  const scene = attachTileflowMap3D({map, load, viewMode: '2d'});
  await mounted();
  assert.equal(map.layers.has(tileflowBuildings3DLayerId), false);
  scene.setViewMode('3d');
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  scene.dispose();
});

test('a style without a 3D scene loads nothing', () => {
  const map = fakeMap({});
  let loads = 0;
  const scene = attachTileflowMap3D({
    map,
    load: () => {
      loads += 1;
      return load();
    },
  });
  assert.equal(loads, 0);
  assert.equal(scene.scene, undefined);
  scene.dispose();
});

test('a 2D map settling reads its style once per style, and mounts a later 3D style', async () => {
  const map = fakeMap({});
  const scene = attachTileflowMap3D({map, load});
  const reads = map.reads;
  for (let index = 0; index < 20; index++) map.fire('idle');
  assert.equal(map.reads, reads, 'settling does not read the style again');
  map.loadStyle(buildings);
  await mounted();
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  scene.dispose();
});

test('a view mode change passes its transition to the scene, so buildings rise or descend', async () => {
  const map = fakeMap(buildings);
  const changes: unknown[] = [];
  const scene = attachTileflowMap3D({
    map,
    viewMode: '2d',
    load: () =>
      Promise.resolve({
        createTileflowMap3D: () =>
          ({
            show: (change?: unknown) => (changes.push(['show', change]), Promise.resolve()),
            hide: (change?: unknown) => (changes.push(['hide', change]), Promise.resolve()),
            setVegetation() {},
            dispose() {},
          }) as never,
      }),
  });
  await mounted();
  const rise = {transition: {duration: 800, mode: 'grow' as const}};
  scene.setViewMode('3d', rise);
  scene.setViewMode('3d', rise);
  scene.setViewMode('2d');
  assert.deepEqual(changes, [
    ['show', rise],
    ['hide', undefined],
  ]);
  scene.dispose();
});
