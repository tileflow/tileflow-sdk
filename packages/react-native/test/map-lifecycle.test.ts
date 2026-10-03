import assert from 'node:assert/strict';
import test from 'node:test';
import {createMapLifecycle} from '../src/map-lifecycle';
import type {createMountedMapOwner} from '../src/mounted-map-owner';

test('render-time construction is inert and effect replay owns distinct controllers', () => {
  const instances: Array<{updates: number; disposed: number}> = [];
  const lifecycle = createMapLifecycle(
    () => {
      const counts = {updates: 0, disposed: 0};
      instances.push(counts);
      return {
        getSnapshot: () => ({revision: 0, mapOptions: {}}),
        getSourceState: () => undefined,
        subscribe: () => () => undefined,
        update() {
          counts.updates++;
        },
        async dispose() {
          counts.disposed++;
        },
        background() {},
        resume() {},
        rootMounted() {},
        nativeStyleLoaded() {},
        layoutChanged() {},
      } as unknown as ReturnType<typeof createMountedMapOwner>;
    },
    (owner) => {
      void owner.dispose();
    },
  );
  assert.equal(instances.length, 0);
  const initial = lifecycle.getSnapshot();
  assert.equal(lifecycle.getSnapshot(), initial);
  const first = lifecycle.mount();
  lifecycle.update({source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'}});
  first();
  const second = lifecycle.mount();
  first();
  lifecycle.update({source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'}});
  assert.deepEqual(instances, [
    {updates: 1, disposed: 1},
    {updates: 1, disposed: 0},
  ]);
  second();
  second();
  assert.equal(instances[1].disposed, 1);
  assert.equal(lifecycle.getSnapshot().renderer, undefined);
});

test('callbacks from a retired owner cannot publish into a newer effect', () => {
  const callbacks: Array<() => void> = [];
  const lifecycle = createMapLifecycle(
    () =>
      ({
        getSnapshot: () => ({revision: 0, mapOptions: {}}),
        getSourceState: () => undefined,
        subscribe(callback: () => void) {
          callbacks.push(callback);
          return () => undefined;
        },
        async dispose() {},
      }) as unknown as ReturnType<typeof createMountedMapOwner>,
    () => undefined,
  );
  let changes = 0;
  const release = lifecycle.subscribe(() => {
    changes++;
  });
  const first = lifecycle.mount();
  first();
  const second = lifecycle.mount();
  const baseline = changes;
  callbacks[0]();
  assert.equal(changes, baseline);
  callbacks[1]();
  assert.equal(changes, baseline + 1);
  release();
  second();
});
