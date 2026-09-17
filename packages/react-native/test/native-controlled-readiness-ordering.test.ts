import assert from 'node:assert/strict';
import test from 'node:test';
import type {NativeSurfaceModule} from '../src/native-surface-contract';
import {createNativeSurfaceTransport} from '../src/native-surface-wire';

function fixture() {
  const listeners = new Set<(event: unknown) => void>();
  const acknowledged: Array<[string, number]> = [];
  let surfaces = 0;
  const module: NativeSurfaceModule = {
    async attachSurface() {
      return {surface: `surface_${++surfaces}`};
    },
    async expectStyle() {
      return {accepted: true};
    },
    async commitLayout() {
      return {layout: 1};
    },
    async requestFrame() {
      return {requested: true};
    },
    async applyCamera(_surface, command, view) {
      return {command, view, invalidation: 1};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async acknowledgeSurface(surface, sequence) {
      acknowledged.push([surface, sequence]);
      return {acknowledged: true};
    },
    async retireSurface() {
      return {detached: true};
    },
    async retireRoot() {
      return {detached: true};
    },
  };
  const transport = createNativeSurfaceTransport(
    () => module,
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    transport,
    acknowledged,
    emit(event: unknown) {
      for (const listener of listeners) listener(event);
    },
  };
}

const view = Object.freeze({center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5});

test('camera application is incomplete until its own native invalidation is delivered and acknowledged', async () => {
  const f = fixture();
  const surface = await f.transport.attach(
    1,
    () => undefined,
    () => assert.fail(),
  );
  let settled = false;
  const applied = surface.applyCamera(1, view).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  f.emit({surface: surface.id, style: 'style_1', sequence: 1, layout: 1, kind: 'invalidate'});
  await applied;
  assert.equal(settled, true);
  assert.deepEqual(f.acknowledged, [[surface.id, 1]]);
  await surface.retire();
});

test('simultaneous surfaces cannot satisfy another camera command invalidation', async () => {
  const f = fixture();
  const first = await f.transport.attach(
    1,
    () => undefined,
    () => assert.fail(),
  );
  const second = await f.transport.attach(
    2,
    () => undefined,
    () => assert.fail(),
  );
  let firstDone = false;
  let secondDone = false;
  const one = first.applyCamera(1, view).then(() => {
    firstDone = true;
  });
  const two = second.applyCamera(1, view).then(() => {
    secondDone = true;
  });
  await Promise.resolve();
  f.emit({surface: first.id, style: 'style_1', sequence: 1, layout: 1, kind: 'invalidate'});
  await one;
  assert.equal(firstDone, true);
  assert.equal(secondDone, false);
  f.emit({surface: second.id, style: 'style_1', sequence: 1, layout: 1, kind: 'invalidate'});
  await two;
  assert.equal(secondDone, true);
  await first.retire();
  await second.retire();
});
