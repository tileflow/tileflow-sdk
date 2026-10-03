import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner, type NativeRendererEvent} from '../src/native-renderer-owner';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';

const source = {
  status: 'ready',
  generation: 1,
  map: {name: 'main'},
  source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
  theme: {name: 'light', colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
} as Extract<TileflowNativeSourceState, {status: 'ready'}>;

function fixture() {
  const events: NativeRendererEvent[] = [];
  let listener!: (event: NativeSurfaceEvent) => void;
  let commands = 0;
  let sequence = 0;
  const surface: NativeSurface = {
    id: 'surface',
    async expectStyle() {},
    async commitLayout() {
      return 2;
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
    {source, style: {version: 8, sources: {}, layers: []}},
    {},
    {
      surfaces: {
        async attach(_root, notify) {
          listener = notify;
          return surface;
        },
        async retireRoot() {},
      },
      emit: (event) => events.push(event),
      changed() {},
    },
  );
  const emit = (kind: NativeSurfaceEvent['kind'], fields: Record<string, unknown> = {}) =>
    listener({
      surface: 'surface',
      style: owner.token,
      sequence: ++sequence,
      layout: 2,
      kind,
      ...fields,
    } as NativeSurfaceEvent);
  return {owner, events, emit, commands: () => commands};
}

test('a current style accepted while backgrounded becomes usable only after resume and a new native barrier', async () => {
  const f = fixture();
  await f.owner.attach(1);
  await f.owner.whenIdle();
  f.owner.background();
  f.emit('style');
  f.emit('render');
  await f.owner.whenIdle();
  assert.equal(f.commands(), 0);
  assert.equal(
    f.events.some((event) => event.type === 'load'),
    false,
  );
  f.owner.resume();
  await f.owner.whenIdle();
  assert.equal(f.commands(), 1);
  assert.equal(f.events.filter((event) => event.type === 'load').length, 1);
  f.owner.afterCommit({});
  await f.owner.whenIdle();
  f.emit('render');
  assert.equal(
    f.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    true,
  );
  await f.owner.dispose();
});

test('background and layout loss retire the active gesture before controlled reconciliation resumes', async () => {
  const initial = {center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5};
  const observed: unknown[] = [];
  const owner = createNativeRendererOwner(
    'renderer',
    {source, style: {version: 8, sources: {}, layers: []}},
    {view: initial, onViewChange: (event) => observed.push(event)},
    {
      surfaces: {
        async attach(_root, notify) {
          const surface: NativeSurface = {
            id: 'surface',
            async expectStyle() {},
            async commitLayout() {
              return 2;
            },
            async requestFrame() {},
            async applyCamera(command, view) {
              return {command, view};
            },
            async cancelCamera() {
              return {cancelled: true};
            },
            async retire() {},
          };
          listener = notify;
          return surface;
        },
        async retireRoot() {},
      },
      emit() {},
      changed() {},
    },
  );
  let listener!: (event: NativeSurfaceEvent) => void;
  let sequence = 0;
  await owner.attach(1);
  await owner.whenIdle();
  listener({
    surface: 'surface',
    style: owner.token,
    sequence: ++sequence,
    layout: 2,
    kind: 'style',
  });
  await owner.whenIdle();
  const moved = {...initial, zoom: 7};
  listener({
    surface: 'surface',
    style: owner.token,
    sequence: ++sequence,
    layout: 2,
    kind: 'gesture-start',
    gesture: 1,
    view: initial,
  });
  listener({
    surface: 'surface',
    style: owner.token,
    sequence: ++sequence,
    layout: 2,
    kind: 'gesture-change',
    gesture: 1,
    view: moved,
  });
  owner.layoutChanged();
  owner.background();
  owner.afterCommit({view: initial, onViewChange: (event) => observed.push(event)});
  owner.resume();
  await owner.whenIdle();
  assert.equal(observed.length, 1);
  await owner.dispose();
});
