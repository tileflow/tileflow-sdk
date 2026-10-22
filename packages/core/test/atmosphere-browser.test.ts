import assert from 'node:assert/strict';
import test from 'node:test';
import {attachTileflowAtmosphere, type TileflowAtmosphereMap} from '../src/atmosphere-browser';
import {resolveTileflowAtmosphere} from '../src/atmosphere-compile';
import {tileflowSkyHazeLayerId} from '../src/sky-haze-browser';

function fixture(enabled = true) {
  const frames = new Map<number, FrameRequestCallback>();
  const events = new Map<string, Set<() => void>>();
  const mediaListeners = new Set<() => void>();
  let frameId = 0;
  const arcs: number[][] = [];
  const fills: string[] = [];
  const context = {
    fillStyle: '',
    setTransform() {},
    clearRect() {
      arcs.length = 0;
      fills.length = 0;
    },
    beginPath() {},
    arc(...args: number[]) {
      arcs.push(args);
    },
    fill() {
      fills.push(context.fillStyle);
    },
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
        ? {'tileflow:atmosphere': {version: 2, ...resolveTileflowAtmosphere(true)}}
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
    fills,
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
  assert.equal(
    f.mapCanvas.style.filter,
    'contrast(1.1)',
    'atmosphere preserves the host canvas filter',
  );
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
    'tileflow:atmosphere': {version: 2, ...resolveTileflowAtmosphere(true)},
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

test('star parallax can reverse and scale camera displacement without a continuous frame loop', () => {
  for (const scale of [undefined, -5, 0]) {
    const f = fixture();
    const dispose = attachTileflowAtmosphere(f.map, {starParallaxScale: scale});
    f.flush();
    const before = f.arcs.find(
      ([x, y, radius]) => x! > 100 && x! < 700 && y! > 50 && y! < 550 && radius! < 0.95,
    )!;
    assert.ok(before);
    f.state.center.lng -= 10;
    f.emit('move');
    f.flush();
    const after = f.arcs.find((arc) => arc[2] === before[2])!;
    assert.ok(Math.abs(after[0]! - before[0]! - 8 * (scale ?? 1)) < 1e-9);
    assert.equal(after[1], before[1]);
    assert.equal(f.frames.size, 0, 'stationary maps do not schedule animation frames');
    dispose();
    assert.ok([...f.events.values()].every((listeners) => listeners.size === 0));
  }
});

test('invalid star parallax multipliers fail before attaching resources', () => {
  const f = fixture();
  for (const starParallaxScale of [NaN, Infinity, -Infinity]) {
    assert.throws(() => attachTileflowAtmosphere(f.map, {starParallaxScale}), RangeError);
  }
  assert.equal(f.canvases.length, 0);
  assert.equal(f.events.size, 0);
});

test('reduced motion freezes stars while preserving the atmosphere', () => {
  const f = fixture();
  f.media.matches = true;
  const dispose = attachTileflowAtmosphere(f.map, {starParallaxScale: -5});
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
    'tileflow:atmosphere': {version: 2, ...resolveTileflowAtmosphere({starIntensity: 0})},
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

test('atmosphere attaches before the first style, follows replacements, and releases layer listeners', () => {
  const f = fixture(false);
  let style: {getSky(): unknown} | undefined;
  const layers = new Map<string, object>();
  let attachments = 0;
  Object.assign(f.map, {
    getStyle: () => (style ? {layers: []} : undefined),
    // MapLibre delegates directly to its style, which is absent before setStyle().
    getSky: () => style!.getSky(),
    getLayer: (id: string) => layers.get(id),
    getLayersOrder: () => [...layers.keys()],
    isStyleLoaded: () => Boolean(style),
    addLayer(layer: {id: string}) {
      attachments++;
      layers.set(layer.id, layer);
    },
    removeLayer: (id: string) => layers.delete(id),
  });

  const dispose = attachTileflowAtmosphere(f.map);
  f.emit('styledata');
  assert.equal(attachments, 0);
  style = {getSky: () => ({'horizon-color': '#dcebf7'})};
  f.emit('style.load');
  f.emit('styledata');
  f.emit('idle');
  assert.equal(attachments, 1);
  assert.ok(layers.has(tileflowSkyHazeLayerId));

  style = undefined;
  layers.clear();
  f.emit('styledata');
  style = {getSky: () => undefined};
  f.emit('style.load');
  assert.equal(attachments, 1);
  style = {getSky: () => ({'horizon-color': '#e7a3a4'})};
  f.emit('style.load');
  assert.equal(attachments, 2);

  f.emit('remove');
  dispose();
  assert.equal(layers.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.ok([...f.events.values()].every((listeners) => listeners.size === 0));
  f.emit('style.load');
  assert.equal(attachments, 2);
});

test('map appearance controls density, radius and color across style replacements', () => {
  const f = fixture();
  // One complete repeating field, with no parallax, makes every generated star observable.
  f.container.clientWidth = 1600;
  f.container.clientHeight = 1000;
  const configure = (starCount: number, starSize: number, starColor: `#${string}`) => {
    f.state.style.metadata = {
      'tileflow:atmosphere': {
        version: 2,
        ...resolveTileflowAtmosphere({starCount, starSize, starColor, starParallax: 0}),
      },
    };
    f.emit('style.load');
    f.flush();
  };
  configure(30, 1, '#ff8800');
  const dispose = attachTileflowAtmosphere(f.map);
  f.flush();
  const interiorStars = () =>
    f.arcs.filter(([x, y]) => x! > 10 && x! < 1590 && y! > 10 && y! < 990);
  const before = structuredClone(interiorStars());
  assert.ok(before.length >= 25);
  assert.ok(f.fills.some((color) => color.startsWith('rgba(255, 136, 0,')));
  configure(30, 2, '#00ff00');
  assert.deepEqual(
    interiorStars(),
    before.map(([x, y, radius, ...rest]) => [x, y, radius! * 2, ...rest]),
  );
  assert.ok(f.fills.some((color) => color.startsWith('rgba(0, 255, 0,')));
  assert.ok(!f.fills.some((color) => color.startsWith('rgba(255, 136, 0,')));
  configure(60, 1, '#ff8800');
  assert.deepEqual(
    interiorStars().slice(0, before.length),
    before,
    'density retains existing stars',
  );
  assert.ok(interiorStars().length > before.length);
  configure(0, 1, '#ffffff');
  assert.equal(f.arcs.length, 0);
  configure(30, 0, '#ffffff');
  assert.equal(f.arcs.length, 0);
  assert.equal(f.canvases.length, 1, 'style changes reuse the atmosphere canvas');
  assert.equal(f.canvases[0]!.style.opacity, '1', 'hiding stars preserves the background');
  assert.equal(f.frames.size, 0);
  dispose();
});
