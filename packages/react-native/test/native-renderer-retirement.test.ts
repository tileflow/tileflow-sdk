import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner, type NativeRendererEvent} from '../src/native-renderer-owner';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';
import {deferred} from './session-fixture';

const target = {
  source: {
    status: 'ready',
    generation: 1,
    source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
    map: {name: 'main'},
    theme: {name: 'light', colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
  } as Extract<TileflowNativeSourceState, {status: 'ready'}>,
  style: {version: 8, sources: {}, layers: []},
};

test('an unmounted blank view still waits for native root detachment before releasing ownership', async () => {
  const barrier = deferred<void>();
  const roots: number[] = [];
  const owner = createNativeRendererOwner(
    'renderer',
    target,
    {},
    {
      surfaces: {
        async attach() {
          throw new Error('Unexpected attachment.');
        },
        async retireRoot(root) {
          roots.push(root);
          await barrier.promise;
        },
      },
      emit() {},
      changed() {},
    },
  );
  owner.bindRoot(42);
  let finished = false;
  const cleanup = owner.dispose().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  barrier.resolve();
  await cleanup;
  assert.deepEqual(roots, [42]);
});

test('a terminal renderer failure ignores late style frame and commit evidence', async () => {
  const events: NativeRendererEvent[] = [];
  let native!: (event: NativeSurfaceEvent) => void;
  let commands = 0;
  const surface: NativeSurface = {
    id: 'surface',
    async expectStyle() {},
    async commitLayout() {
      return 1;
    },
    async requestFrame() {},
    async applyCamera(command, view) {
      commands++;
      return {command, view};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async retire() {},
  };
  const owner = createNativeRendererOwner(
    'renderer',
    target,
    {},
    {
      surfaces: {
        async attach(_root, listener) {
          native = listener;
          return surface;
        },
        async retireRoot() {},
      },
      emit: (event) => events.push(event),
      changed() {},
    },
  );
  await owner.attach(42);
  await owner.whenIdle();
  native({surface: 'surface', style: owner.token, sequence: 1, layout: 1, kind: 'error'});
  const count = events.length;
  native({surface: 'surface', style: owner.token, sequence: 2, layout: 1, kind: 'style'});
  owner.afterCommit({});
  owner.layoutChanged();
  native({surface: 'surface', style: owner.token, sequence: 3, layout: 1, kind: 'render'});
  await owner.whenIdle();
  assert.equal(events.length, count);
  assert.equal(commands, 0);
  await owner.dispose();
});

test('preloading cannot mislabel the previous concrete theme as the requested theme', async () => {
  const events: NativeRendererEvent[] = [];
  const owner = createNativeRendererOwner(
    'renderer',
    target,
    {},
    {
      surfaces: {
        async attach() {
          throw new Error('Not attached.');
        },
        async retireRoot() {},
      },
      emit: (event) => events.push(event),
      changed() {},
    },
  );
  owner.preload(2);
  assert.equal(
    events.some((event) => event.type === 'theme-change'),
    false,
  );
  owner.preload(2, {name: 'dark', colorScheme: 'dark'});
  assert.deepEqual(
    events.filter((event) => event.type === 'theme-change'),
    [
      {
        type: 'theme-change',
        generation: 2,
        phase: 'preloading',
        map: 'main',
        targetTheme: {name: 'dark', colorScheme: 'dark'},
      },
    ],
  );
  await owner.dispose();
});
