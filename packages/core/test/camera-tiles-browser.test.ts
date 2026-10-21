import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createCameraTiles} from '../src/camera-tiles-browser';

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
