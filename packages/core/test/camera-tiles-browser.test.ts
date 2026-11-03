import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {cameraTileAt, cameraTileRing, createCameraTiles} from '../src/camera-tiles-browser';

test('a tight budget covers the bottom row before the centre or horizon, with a far-only fade', () => {
  const camera = {lng: -74.01325, lat: 40.7118, zoom: 15.422, pitch: 58.5, bearing: 0};
  const viewport = [
    [9646.2, 12321.9],
    [9645.8, 12317.1],
    [9649.2, 12317.1],
    [9648.8, 12321.9],
  ] as const;
  const tight = cameraTileRing(camera, 15, 3, viewport);
  assert.deepEqual(tight.tiles.map(({x, y}) => [x, y]).sort(), [
    [9646, 12321],
    [9647, 12321],
    [9648, 12321],
  ]);
  // At the first omitted row all heights have reached zero. Across the entire near edge they
  // retain full height; the fade's depth is independent of the horizontal distance to the centre.
  const fade = tight.fade!;
  assert.ok(fade.start < fade.end);
  assert.ok(fade.origin[1] - 12321.9 < fade.start);
  assert.ok(Math.abs(fade.end - (fade.origin[1] - 12321)) < 1e-8);
});

test('foreground reservation keeps the tile budget and a conservative distance-haze disc', () => {
  const camera = {lng: -74.01325, lat: 40.7118, zoom: 15.422, pitch: 58.5, bearing: 0};
  const foreground = [
    [9645.8, 12320.2],
    [9648.5, 12320.2],
    [9648.1, 12321.9],
    [9646.2, 12321.9],
  ] as const;
  const ring = cameraTileRing(camera, 15, 25, foreground);
  assert.equal(ring.tiles.length, 25);
  assert.equal(new Set(ring.tiles.map(({x, y}) => `${x}/${y}`)).size, 25);
  assert.ok(ring.tiles.some(({x, y}) => x === 9647 && y === 12321));
  assert.ok(ring.radius > 0);
  const [cx, cy] = ring.centre;
  for (let x = Math.floor(cx - ring.radius) - 1; x <= cx + ring.radius + 1; x++)
    for (let y = Math.floor(cy - ring.radius) - 1; y <= cy + ring.radius + 1; y++) {
      const distance = Math.hypot(Math.max(x - cx, 0, cx - x - 1), Math.max(y - cy, 0, cy - y - 1));
      if (distance < ring.radius)
        assert.ok(
          ring.tiles.some((tile) => tile.x === x && tile.y === y),
          `uncovered haze disc tile ${x}/${y}`,
        );
    }
  for (const limit of [1, 4, 9, 64])
    assert.ok(cameraTileRing(camera, 15, limit, foreground).tiles.length <= limit);
});

test('viewport resize updates foreground coverage and disposal removes the resize listener', () => {
  const listeners = new Map<string, () => void>();
  let width = 100;
  const latitude = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** 15))) * 180) / Math.PI;
  const map = {
    getBearing: () => 0,
    getCenter: () => ({lng: -74.01325, lat: 40.7118}),
    getPitch: () => 58.5,
    getZoom: () => 15.422,
    getSource: () => undefined,
    getCanvas: () => ({clientWidth: width, clientHeight: 100}),
    unproject: ([x, y]: [number, number]) => ({
      lng: ((9647 + x / 100) / 2 ** 15) * 360 - 180,
      lat: latitude(12320 + y / 50),
    }),
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    triggerRepaint() {},
  };
  const camera = createCameraTiles({
    map,
    source: 'absent',
    zoom: 15,
    minzoom: 14,
    maxTiles: 25,
    active: () => true,
    empty: {},
    build: () => ({}),
    release() {},
    changed() {},
  });
  camera.update();
  const before = camera.coverage();
  width = 300;
  listeners.get('resize')!();
  assert.notDeepEqual(camera.coverage(), before);
  const [x, y] = cameraTileAt(map.unproject([250, 95]).lng, map.unproject([250, 95]).lat, 15);
  assert.ok(camera.coverage().some((tile) => tile.x === Math.floor(x) && tile.y === Math.floor(y)));
  camera.dispose();
  assert.equal(listeners.size, 0);
});

test('a foreground crossing the antimeridian stays beside the camera world copy', () => {
  const map = {
    getBearing: () => 0,
    getCenter: () => ({lng: 179.999, lat: 40.7118}),
    getPitch: () => 58.5,
    getZoom: () => 15.422,
    getSource: () => undefined,
    getCanvas: () => ({clientWidth: 100, clientHeight: 100}),
    unproject: ([x, y]: [number, number]) => {
      const lng = ((32767.2 + (x / 100) * 1.6) / 2 ** 15) * 360 - 180;
      return {
        lng: ((lng + 540) % 360) - 180,
        lat:
          (Math.atan(Math.sinh(Math.PI * (1 - (2 * (12320 + y / 50)) / 2 ** 15))) * 180) / Math.PI,
      };
    },
    on() {},
    off() {},
    triggerRepaint() {},
  };
  const camera = createCameraTiles({
    map,
    source: 'absent',
    zoom: 15,
    minzoom: 14,
    maxTiles: 25,
    active: () => true,
    empty: {},
    build: () => ({}),
    release() {},
    changed() {},
  });
  try {
    camera.update();
    for (const x of [32767, 32768])
      assert.ok(camera.coverage().some((tile) => tile.x === x && tile.y === 12321));
    assert.equal(camera.coverage().length, 25);
  } finally {
    camera.dispose();
  }
});

test('async tile builds keep the old value, ignore stale refreshes and release late results', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(0)));
  const pending: {resolve: (value: object) => void; signal: AbortSignal}[] = [];
  const released: object[] = [];
  const map = {
    getBearing: () => 0,
    getCenter: () => ({lat: 0.01, lng: 0.01}),
    getPitch: () => 0,
    getZoom: () => 18,
    getSource: () => ({tiles: ['https://camera-test.invalid/{z}/{x}/{y}.pbf'], maxzoom: 15}),
    on() {},
    off() {},
    triggerRepaint() {},
  };
  const camera = createCameraTiles({
    map,
    source: 'world',
    zoom: 15,
    minzoom: 14,
    maxTiles: 1,
    active: () => true,
    empty: {},
    build: (_tile, _metres, signal) =>
      new Promise<object>((resolve) => pending.push({resolve, signal})),
    release: (value) => released.push(value),
    changed() {},
  });
  const until = async (ready: () => boolean) => {
    for (let n = 0; n < 100 && !ready(); n++) await delay(5);
    assert.ok(ready());
  };
  try {
    camera.update();
    await until(() => pending.length === 1);
    const first = {};
    pending[0]!.resolve(first);
    await until(() => camera.ready().length === 1);
    camera.refresh(() => true);
    await until(() => pending.length === 2);
    assert.equal(camera.ready()[0]!.value, first);
    camera.refresh(() => true);
    assert.equal(pending[1]!.signal.aborted, true);
    const stale = {};
    pending[1]!.resolve(stale);
    await until(() => pending.length === 3);
    assert.ok(released.includes(stale));
    assert.equal(camera.ready()[0]!.value, first);
    const fresh = {};
    pending[2]!.resolve(fresh);
    await until(() => camera.ready()[0]?.value === fresh);
    assert.ok(released.includes(first));
    camera.refresh(() => true);
    await until(() => pending.length === 4);
    camera.dispose();
    const late = {};
    pending[3]!.resolve(late);
    await until(() => released.includes(late));
    assert.equal(camera.ready().length, 0);
  } finally {
    camera.dispose();
  }
});

test('the camera covers its tiles without a source to read and over tiles that hold nothing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 404}));
  const base = {
    getBearing: () => 0,
    getCenter: () => ({lat: 0.0005, lng: 0.0005}),
    getPitch: () => 0,
    getZoom: () => 18,
    on() {},
    off() {},
    triggerRepaint() {},
  };
  const options = {
    source: 'world',
    zoom: 16,
    minzoom: 14,
    maxTiles: 4,
    active: () => true,
    empty: {},
    build: () => ({}),
    release() {},
    changed() {},
  };

  // A style without the source still knows the tiles round its camera.
  const sourceless = createCameraTiles({...options, map: {...base, getSource: () => undefined}});
  sourceless.update();
  const covered = sourceless.coverage();
  assert.equal(covered.length, 4);
  assert.deepEqual(covered[0], {x: 32768, y: 32767});
  assert.equal(sourceless.ready().length, 0);
  sourceless.dispose();

  // An absent tile holds nothing for the layer, yet stays covered.
  const empty = createCameraTiles({
    ...options,
    map: {
      ...base,
      getSource: () => ({tiles: ['https://camera-test.invalid/{z}/{x}/{y}.pbf'], maxzoom: 16}),
    },
  });
  empty.update();
  for (let n = 0; n < 100 && [...empty.all()].some((tile) => tile.loading); n++) await delay(5);
  assert.equal(empty.ready().length, 0);
  assert.deepEqual(empty.coverage(), covered);
  empty.dispose();
});

test('GPU upload budget never leaves a previously drawn tile empty during detail replacement', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(0)));
  type Mesh = {gpu: boolean};
  const released: Mesh[] = [];
  const map = {
    getBearing: () => 0,
    getCenter: () => ({lat: 40.41, lng: -3.69}),
    getPitch: () => 0,
    getZoom: () => 16,
    getSource: () => ({tiles: ['https://gpu-camera-test.invalid/{z}/{x}/{y}.pbf'], maxzoom: 15}),
    on() {},
    off() {},
    triggerRepaint() {},
  };
  const camera = createCameraTiles<Mesh>({
    map,
    source: 'world',
    zoom: 15,
    minzoom: 14,
    maxTiles: 4,
    active: () => true,
    empty: {gpu: true},
    build: () => ({gpu: false}),
    isReady: (mesh) => mesh.gpu,
    release: (mesh) => released.push(mesh),
    changed() {},
  });
  const until = async (ready: () => boolean) => {
    for (let n = 0; n < 100 && !ready(); n++) await delay(5);
    assert.ok(ready());
  };
  try {
    camera.update();
    await until(() => camera.built().length === 4);
    for (const tile of camera.built()) tile.value.gpu = true;
    const original = camera.ready().map((tile) => tile.value);
    assert.equal(original.length, 4);
    camera.refresh(() => true);
    await until(() => camera.built().every((tile) => !tile.value.gpu));
    assert.deepEqual(
      camera.ready().map((tile) => tile.value),
      original,
    );
    assert.equal(released.length, 0);
    // The renderer uploads only two tiles each frame. All four must still draw every frame.
    for (const tile of camera.built().slice(0, 2)) tile.value.gpu = true;
    assert.equal(camera.ready().length, 4);
    assert.equal(released.length, 2);
    for (const tile of camera.built()) tile.value.gpu = true;
    assert.equal(camera.ready().length, 4);
    assert.equal(released.length, 4);
    camera.refresh(() => true);
    await until(() => camera.built().every((tile) => !tile.value.gpu));
    const pending = camera.built().map((tile) => tile.value);
    camera.dispose();
    for (const mesh of pending) assert.ok(released.includes(mesh));
  } finally {
    camera.dispose();
  }
});
