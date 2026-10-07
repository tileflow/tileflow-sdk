import assert from 'node:assert/strict';
import test from 'node:test';
import {attachTileflowAtmosphere, type TileflowAtmosphereMap} from '../src/atmosphere-browser';
import {resolveTileflowAtmosphere} from '../src/atmosphere-compile';

function fixture(enabled = true) {
  const frames = new Map<number, FrameRequestCallback>();
  const events = new Map<string, Set<() => void>>();
  const mediaListeners = new Set<() => void>();
  let frameId = 0;
  const arcs: number[][] = [];
  const context = {
    fillStyle: '',
    setTransform() {},
    clearRect() {
      arcs.length = 0;
    },
    beginPath() {},
    arc(...args: number[]) {
      arcs.push(args);
    },
    fill() {},
  };
  const canvases: Array<{
    style: Record<string, string>;
    removed: boolean;
    width: number;
    height: number;
  }> = [];
  const media = {
    matches: false,
    addEventListener(_event: string, listener: () => void) {
      mediaListeners.add(listener);
    },
    removeEventListener(_event: string, listener: () => void) {
      mediaListeners.delete(listener);
    },
  };
  const browser = {
    devicePixelRatio: 3,
    matchMedia() {
      return media;
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
  };
  const container = {
    clientWidth: 800,
    clientHeight: 600,
    firstChild: {},
    insertBefore() {},
    ownerDocument: {
      defaultView: browser,
      createElement() {
        const canvas = {
          style: {},
          removed: false,
          width: 0,
          height: 0,
          getContext() {
            return context;
          },
          setAttribute() {},
          remove() {
            canvas.removed = true;
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  const state = {
    zoom: 2,
    bearing: 0,
    center: {lng: 2, lat: 48},
    style: {
      projection: {type: 'globe'},
      metadata: enabled
        ? {'tileflow:atmosphere': {version: 1, ...resolveTileflowAtmosphere(true)}}
        : {},
    },
  };
  const mapCanvas = {style: {filter: 'contrast(1.1)'}};
  const map = {
    getContainer: () => container,
    getCanvas: () => mapCanvas,
    getZoom: () => state.zoom,
    getCenter: () => state.center,
    getBearing: () => state.bearing,
    getPitch: () => 0,
    getStyle: () => state.style,
    on(event: string, listener: () => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(listener);
    },
    off(event: string, listener: () => void) {
      events.get(event)?.delete(listener);
    },
  } as unknown as TileflowAtmosphereMap;
  return {
    map,
    state,
    canvases,
    events,
    frames,
    arcs,
    media,
    mediaListeners,
    mapCanvas,
    container,
    emit(event: string) {
      for (const listener of events.get(event) ?? []) listener();
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(0);
    },
  };
}

test('compiled atmosphere follows styles, coalesces moves, fades at street zoom, and cleans up', () => {
  const f = fixture();
  const dispose = attachTileflowAtmosphere(f.map);
  assert.equal(f.canvases.length, 1);
  f.emit('move');
  f.emit('resize');
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.canvases[0]!.style.opacity, '1');
  assert.equal(f.canvases[0]!.width, 1600, 'DPR is capped at two');
  assert.match(f.mapCanvas.style.filter, /^contrast\(1.1\) drop-shadow/);
  const before = structuredClone(f.arcs);
  f.state.center = {lng: 12, lat: 48};
  f.emit('move');
  f.flush();
  assert.notDeepEqual(f.arcs, before);
  f.state.zoom = 14;
  f.emit('move');
  f.flush();
  assert.equal(f.canvases[0]!.style.opacity, '0');
  assert.equal(f.mapCanvas.style.filter, 'contrast(1.1)');
  f.emit('move');
  f.state.style.metadata = {};
  f.emit('style.load');
  assert.equal(f.frames.size, 0);
  assert.equal(f.canvases[0]!.removed, true);
  f.state.style.metadata = {
    'tileflow:atmosphere': {version: 1, ...resolveTileflowAtmosphere(true)},
  };
  f.state.zoom = 2;
  f.emit('style.load');
  f.flush();
  assert.equal(f.canvases.length, 2);
  dispose();
  dispose();
  assert.equal(f.canvases[1]!.removed, true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.ok([...f.events.values()].every((listeners) => listeners.size === 0));
  assert.equal(f.mapCanvas.style.filter, 'contrast(1.1)');
});

test('omitted atmosphere creates no canvas or animation work; remove disposes automatically', () => {
  const f = fixture(false);
  attachTileflowAtmosphere(f.map);
  f.emit('move');
  f.emit('resize');
  assert.equal(f.frames.size, 0);
  assert.equal(f.canvases.length, 0);
  f.emit('remove');
  assert.equal(f.mediaListeners.size, 0);
});

test('reduced motion freezes stars while preserving the atmosphere', () => {
  const f = fixture();
  f.media.matches = true;
  const dispose = attachTileflowAtmosphere(f.map);
  f.flush();
  const before = structuredClone(f.arcs);
  f.state.center = {lng: -100, lat: -30};
  f.state.bearing = 80;
  f.emit('move');
  f.flush();
  assert.deepEqual(f.arcs, before);
  assert.equal(f.canvases[0]!.style.opacity, '1');
  dispose();
});

test('zero star intensity clears stars; wrong projection or invalid metadata disables the effect', () => {
  const f = fixture();
  f.state.style.metadata = {
    'tileflow:atmosphere': {version: 1, ...resolveTileflowAtmosphere({starIntensity: 0})},
  };
  const dispose = attachTileflowAtmosphere(f.map);
  f.flush();
  assert.equal(f.arcs.length, 0);
  assert.equal(f.canvases[0]!.style.opacity, '1');
  f.state.style.projection.type = 'mercator';
  f.emit('style.load');
  assert.equal(f.canvases[0]!.removed, true);
  dispose();
});
