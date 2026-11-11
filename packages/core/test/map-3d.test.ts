import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowNativeBuildingsLayerId} from '../src/building-layer-ids';
import {tileflowBuildings3DLayerId} from '../src/buildings-3d-browser';
import {attachTileflowMap3D} from '../src/map-3d-attach-browser';

// React, Vue and Svelte mount the scene through attachTileflowMap3D with this loader.
const load = () => import('../src/3d');
const mounted = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeMap(initial: Record<string, unknown>) {
  const listeners = new Map<string, Set<() => void>>();
  const layers = new Map<string, {id: string}>();
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
      layers.set(layer.id, layer);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: 40.42, lng: -3.7}),
    getLayer: (id: string) => layers.get(id),
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

function nativeVisibility(map: ReturnType<typeof fakeMap>) {
  map.layers.set(tileflowNativeBuildingsLayerId, {id: tileflowNativeBuildingsLayerId});
  const state = {visibility: 'none'};
  Object.assign(map, {
    getLayoutProperty: () => state.visibility,
    setLayoutProperty: (_id: string, _property: string, next: string) => {
      state.visibility = next;
    },
  });
  return state;
}

test('while the renderers load, the native extrusion draws buildings no model stands in for', async () => {
  const map = fakeMap({'tileflow:buildings': {version: 1}});
  const native = nativeVisibility(map);
  const attachment = attachTileflowMap3D({
    map,
    load: () => new Promise(() => {}),
  });
  assert.equal(native.visibility, 'visible');
  attachment.setViewMode('2d');
  assert.equal(native.visibility, 'none');
  attachment.dispose();
});

test('while the renderers load, a map with landmarks keeps the native extrusion until the scene knows which buildings they replace, or loading fails', async () => {
  const map = fakeMap(buildings);
  const native = nativeVisibility(map);
  let fail!: (error: Error) => void;
  const errors: unknown[] = [];
  const attachment = attachTileflowMap3D({
    map,
    load: () => new Promise((_resolve, reject) => (fail = reject)),
    onError: (error) => errors.push(error),
  });
  assert.equal(native.visibility, 'none');
  attachment.setViewMode('2d');
  attachment.setViewMode('3d');
  assert.equal(native.visibility, 'none');
  fail(new Error('loader failed'));
  await mounted();
  // Without the scene, the native extrusion draws every building.
  assert.equal(native.visibility, 'visible');
  assert.equal(errors.length, 1);
  attachment.setViewMode('2d');
  assert.equal(native.visibility, 'none');
  attachment.setViewMode('3d');
  assert.equal(native.visibility, 'visible');
  attachment.dispose();
  assert.equal(native.visibility, 'none');
});

test('a mounted scene keeps the native extrusion off a landmark until it knows its footprint, waiting a moment at most', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const map = fakeMap(buildings);
  const native = nativeVisibility(map);
  const attachment = attachTileflowMap3D({map, load});
  for (let turns = 0; turns < 1000 && !attachment.scene; turns += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(map.layers.has(tileflowBuildings3DLayerId));
  // The landmarks round the view are not known yet: nothing may draw what they replace.
  assert.equal(attachment.scene?.buildings?.standIns.known, false);
  assert.equal(native.visibility, 'none');
  t.mock.timers.tick(5_000);
  // They did not arrive in time: the map's own buildings draw until the scene is ready.
  assert.equal(attachment.scene?.buildings?.standIns.known, true);
  assert.equal(native.visibility, 'visible');
  attachment.dispose();
  assert.equal(native.visibility, 'none');
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

function cameraMap(metadata: Record<string, unknown>) {
  const map = fakeMap(metadata);
  let fov = 36.87;
  let writes = 0;
  return Object.assign(map, {
    getPitch: () => 0,
    getCanvas: () => ({clientHeight: 900}),
    getVerticalFieldOfView: () => fov,
    setVerticalFieldOfView(value: number) {
      fov = value;
      writes++;
      map.fire('move');
    },
    get writes() {
      return writes;
    },
  });
}
const adaptive = {...buildings, 'tileflow:camera': {version: 1, adaptivePerspective: true}};

test('authored pitch caps hold through zoom 15 and release on closer views and style changes', async () => {
  const limited = {
    ...buildings,
    'tileflow:camera': {version: 1, pitchLimit: {maxZoom: 15, maxPitch: 38}},
  };
  const map = fakeMap(limited);
  let zoom = 14;
  let pitch = 60;
  let maximum = 85;
  Object.assign(map, {
    getZoom: () => zoom,
    getPitch: () => pitch,
    getMaxPitch: () => maximum,
    setMaxPitch(value: number) {
      maximum = value;
      pitch = Math.min(pitch, maximum);
      map.fire('zoom');
    },
  });
  const attachment = attachTileflowMap3D({map, load});
  await mounted();
  assert.equal(maximum, 38);
  assert.equal(pitch, 38, 'an initially steep view is clamped');
  zoom = 15;
  map.fire('zoom');
  assert.equal(maximum, 38, 'the cutoff is inclusive');
  zoom = 15.01;
  map.fire('zoom');
  assert.equal(maximum, 85);
  assert.equal(pitch, 38, 'releasing the cap does not tilt the view automatically');
  pitch = 70;
  zoom = 14.5;
  map.fire('zoom');
  assert.equal(maximum, 38);
  assert.equal(pitch, 38);
  map.loadStyle(buildings);
  assert.equal(maximum, 85);
  maximum = 30;
  map.loadStyle(limited);
  assert.equal(maximum, 30, 'a stricter application limit wins');
  attachment.dispose();
  assert.equal(maximum, 30);
});

test('flat footprints remain until the 3D renderer has a drawable frame', async () => {
  const native = {visibility: 'visible'};
  const map = fakeMap({
    'tileflow:buildings': {
      version: 1,
      source: 'tileflow',
      layers: {building: 'building'},
      color: '#dddddd',
      flatLayers: [{id: 'footprint', visible: true}],
    },
  });
  const originalLayer = map.getLayer;
  Object.assign(map, {
    getLayer: (id: string) => (id === 'footprint' ? native : originalLayer(id)),
    getLayersOrder: () => ['footprint'],
    getCanvas: () => ({clientHeight: 900, getContext: () => ({})}),
    getLayoutProperty: () => native.visibility,
    setLayoutProperty: (_id: string, _property: string, value: string) => {
      native.visibility = value;
    },
  });
  const attachment = attachTileflowMap3D({map, load});
  await mounted();
  assert.equal(native.visibility, 'visible');
  attachment.setViewMode('2d');
  assert.equal(native.visibility, 'visible');
  attachment.setViewMode('3d');
  assert.equal(native.visibility, 'visible');
  attachment.dispose();
  assert.equal(native.visibility, 'visible');
});

test('camera precedence is caller, authored map, then false; switching view restores the lens', async () => {
  const map = cameraMap(buildings);
  const attachment = attachTileflowMap3D({map, load});
  await mounted();
  assert.equal(map.getVerticalFieldOfView(), 36.87);
  map.loadStyle(adaptive);
  assert.ok(map.getVerticalFieldOfView() < 7);
  attachment.setAdaptivePerspective(false);
  assert.equal(map.getVerticalFieldOfView(), 36.87);
  map.loadStyle(adaptive);
  assert.equal(map.getVerticalFieldOfView(), 36.87);
  attachment.setAdaptivePerspective(undefined);
  assert.ok(map.getVerticalFieldOfView() < 7);
  attachment.setViewMode('2d');
  assert.equal(map.getVerticalFieldOfView(), 36.87);
  attachment.setViewMode('3d');
  assert.ok(map.getVerticalFieldOfView() < 7);
  map.loadStyle(buildings);
  assert.equal(map.getVerticalFieldOfView(), 36.87);
  attachment.setAdaptivePerspective(true);
  assert.ok(map.getVerticalFieldOfView() < 7);
  attachment.dispose();
  assert.equal(map.getVerticalFieldOfView(), 36.87);
});

test('caller camera changes before lazy loading win, and removal never writes the destroyed camera', async () => {
  const map = cameraMap(adaptive);
  const attachment = attachTileflowMap3D({map, load, camera: {adaptivePerspective: false}});
  attachment.setAdaptivePerspective(true);
  await mounted();
  assert.ok(map.getVerticalFieldOfView() < 7);
  const before = map.getVerticalFieldOfView();
  map.fire('remove');
  attachment.dispose();
  assert.equal(attachment.scene, undefined);
  assert.equal(map.getVerticalFieldOfView(), before);
});

test('the scene reports what it still waits for, and nothing while hidden', async () => {
  const map = {
    ...fakeMap(buildings),
    getSource: () => ({tiles: ['https://scene-test.invalid/{z}/{x}/{y}.pbf'], maxzoom: 15}),
  };
  const attachment = attachTileflowMap3D({map, load});
  await mounted();
  const scene = attachment.scene!;
  // Mounted but not yet drawn: the building tiles round the camera are still to be read.
  assert.ok(scene.pending().buildingTiles > 0);
  assert.equal(scene.loaded(), false);
  await scene.hide();
  assert.deepEqual(scene.pending(), {buildingTiles: 0, models: 0, treeTiles: 0, transitions: 0});
  assert.equal(scene.loaded(), true);
  attachment.dispose();
});
