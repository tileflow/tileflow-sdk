import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import type {MapCameraProps} from '../src/contract';
import {createNativeRendererOwner} from '../src/native-renderer-owner';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';

const controlledView = Object.freeze({center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5});
const controlledProps: MapCameraProps = {view: controlledView, onViewChange() {}};

function target(theme: 'light' | 'dark' | 'broken', generation: number) {
  const themes = {
    light: {colorScheme: 'light' as const, styleUrl: 'https://maps.example.test/light.json'},
    dark: {colorScheme: 'dark' as const, styleUrl: 'https://maps.example.test/dark.json'},
    broken: {colorScheme: 'dark' as const, styleUrl: 'https://maps.example.test/broken.json'},
  };
  const map = {name: 'main', defaultTheme: 'light', themes};
  return {
    source: {
      status: 'ready',
      generation,
      source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
      map,
      manifest: {version: 1, maps: {main: map}},
      manifestUrl: 'https://maps.example.test/manifest.json',
      theme: {name: theme, ...themes[theme]},
    } as Extract<TileflowNativeSourceState, {status: 'ready'}>,
    style: {version: 8, sources: {}, layers: []},
  };
}

function fixture(id: string, props: MapCameraProps, generation: number) {
  const events: Array<{type: string; [key: string]: unknown}> = [];
  const order: Array<{kind: 'camera' | 'layout' | 'frame'; style: string}> = [];
  let notify: (event: NativeSurfaceEvent) => void = () => undefined;
  let sequence = 0;
  const emit = (kind: NativeSurfaceEvent['kind'], style = owner.token) =>
    notify({surface: id, style, sequence: ++sequence, layout: 2, kind} as NativeSurfaceEvent);
  const surface: NativeSurface = {
    id,
    async expectStyle() {},
    async commitLayout(style) {
      order.push({kind: 'layout', style});
      return 2;
    },
    async requestFrame(style) {
      order.push({kind: 'frame', style});
    },
    async applyCamera(command, view) {
      order.push({kind: 'camera', style: owner.token});
      emit('invalidate');
      return {command, view};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async retire() {},
  };
  const owner = createNativeRendererOwner(id, target('light', generation), props, {
    surfaces: {
      async attach(_root, listener) {
        notify = listener;
        return surface;
      },
      async retireRoot() {},
    },
    emit: (event) => events.push(event),
    changed() {},
  });
  return {owner, events, order, emit};
}

async function ready(
  fixture: ReturnType<typeof fixture>,
  props: MapCameraProps,
  root: number,
): Promise<string> {
  await fixture.owner.attach(root);
  await fixture.owner.whenIdle();
  const token = fixture.owner.token;
  fixture.emit('style', token);
  await fixture.owner.whenIdle();
  fixture.owner.afterCommit(props);
  await fixture.owner.whenIdle();
  fixture.emit('render', token);
  return token;
}

const readyCount = (events: Array<{type: string; [key: string]: unknown}>) =>
  events.filter((event) => event.type === 'readiness-change' && event.status === 'ready').length;

test('controlled replacement reacquires camera layout and frame barriers without borrowing another surface', async () => {
  const first = fixture('surface_first', controlledProps, 1);
  const secondProps: MapCameraProps = {initialView: {center: [8, 9], zoom: 4}};
  const second = fixture('surface_second', secondProps, 1);
  const lightToken = await ready(first, controlledProps, 1);
  await ready(second, secondProps, 2);
  assert.equal(readyCount(first.events), 1);
  assert.equal(readyCount(second.events), 1);
  const secondOrder = second.order.length;

  first.owner.preload(2);
  first.owner.setTarget(target('dark', 2));
  await first.owner.whenIdle();
  const darkToken = first.owner.token;
  assert.notEqual(darkToken, lightToken);
  first.emit('style', darkToken);
  await first.owner.whenIdle();
  first.owner.afterCommit(controlledProps);
  await first.owner.whenIdle();
  assert.deepEqual(
    first.order.filter((step) => step.style === darkToken).map((step) => step.kind),
    ['camera', 'layout', 'frame'],
  );
  assert.equal(readyCount(first.events), 1);
  assert.equal(second.order.length, secondOrder);
  assert.equal(readyCount(second.events), 1);

  first.emit('render', lightToken);
  assert.equal(readyCount(first.events), 1);
  first.emit('render', darkToken);
  assert.equal(readyCount(first.events), 2);
  assert.equal(first.owner.currentTheme?.name, 'dark');

  await first.owner.dispose();
  await second.owner.dispose();
});

test('failed replacement rollback requires its own post-camera frame and rejects failed or retired evidence', async () => {
  const f = fixture('surface_first', controlledProps, 1);
  await ready(f, controlledProps, 1);
  f.owner.preload(2);
  f.owner.setTarget(target('dark', 2));
  await f.owner.whenIdle();
  const darkToken = f.owner.token;
  f.emit('style', darkToken);
  await f.owner.whenIdle();
  f.owner.afterCommit(controlledProps);
  await f.owner.whenIdle();
  f.emit('render', darkToken);
  assert.equal(f.owner.currentTheme?.name, 'dark');

  f.owner.preload(3);
  f.owner.setTarget(target('broken', 3));
  await f.owner.whenIdle();
  const failedToken = f.owner.token;
  f.emit('error', failedToken);
  await f.owner.whenIdle();
  const rollbackToken = f.owner.token;
  assert.notEqual(rollbackToken, failedToken);
  f.emit('style', rollbackToken);
  await f.owner.whenIdle();
  f.owner.afterCommit(controlledProps);
  await f.owner.whenIdle();
  assert.deepEqual(
    f.order.filter((step) => step.style === rollbackToken).map((step) => step.kind),
    ['camera', 'layout', 'frame'],
  );
  const beforeRollbackRender = readyCount(f.events);
  f.emit('render', failedToken);
  assert.equal(readyCount(f.events), beforeRollbackRender);
  f.emit('render', rollbackToken);
  assert.equal(readyCount(f.events), beforeRollbackRender + 1);
  assert.equal(f.owner.currentTheme?.name, 'dark');
  assert.equal(
    f.events.some(
      (event) => event.type === 'theme-change' && event.phase === 'ready' && event.generation === 3,
    ),
    false,
  );

  const eventCount = f.events.length;
  await f.owner.dispose();
  f.emit('render', rollbackToken);
  f.emit('render', failedToken);
  assert.equal(f.events.length, eventCount);
});
