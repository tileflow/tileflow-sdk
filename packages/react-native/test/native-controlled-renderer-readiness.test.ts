import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import type {MapCameraProps} from '../src/contract';
import {createNativeRendererOwner} from '../src/native-renderer-owner';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';

function target(generation: number) {
  const map = {
    name: 'main',
    defaultTheme: 'light',
    themes: {light: {colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'}},
  };
  return {
    source: {
      status: 'ready',
      generation,
      source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
      map,
      manifest: {version: 1, maps: {main: map}},
      manifestUrl: 'https://maps.example.test/manifest.json',
      theme: {
        name: 'light',
        colorScheme: 'light',
        styleUrl: 'https://maps.example.test/light.json',
      },
    } as Extract<TileflowNativeSourceState, {status: 'ready'}>,
    style: {version: 8, sources: {}, layers: []},
  };
}

function fixture(id: string, props: MapCameraProps, generation: number) {
  const events: Array<{type: string; [key: string]: unknown}> = [];
  const order: string[] = [];
  let notify: (event: NativeSurfaceEvent) => void = () => undefined;
  let sequence = 0;
  let owner: ReturnType<typeof createNativeRendererOwner>;
  const emit = (kind: NativeSurfaceEvent['kind']) =>
    notify({
      surface: id,
      style: owner.token,
      sequence: ++sequence,
      layout: 1,
      kind,
    } as NativeSurfaceEvent);
  const surface: NativeSurface = {
    id,
    async expectStyle() {},
    async commitLayout() {
      order.push('layout');
      return 1;
    },
    async requestFrame() {
      order.push('frame');
    },
    async applyCamera(command, view) {
      order.push('camera');
      emit('invalidate');
      return {command, view};
    },
    async cancelCamera() {
      return {cancelled: true};
    },
    async retire() {},
  };
  owner = createNativeRendererOwner(id, target(generation), props, {
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

async function reachFrameBarrier(
  fixture: ReturnType<typeof fixture>,
  props: MapCameraProps,
  root: number,
) {
  await fixture.owner.attach(root);
  await fixture.owner.whenIdle();
  fixture.emit('style');
  await fixture.owner.whenIdle();
  fixture.owner.afterCommit(props);
  await fixture.owner.whenIdle();
}

test('complete controlled camera reaches readiness only after its invalidation, layout and requested frame', async () => {
  const controlledView = {center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5};
  const controlledProps: MapCameraProps = {view: controlledView, onViewChange() {}};
  const first = fixture('surface_first', controlledProps, 1);
  const secondProps: MapCameraProps = {initialView: {center: [8, 9], zoom: 4}};
  const second = fixture('surface_second', secondProps, 2);

  await Promise.all([
    reachFrameBarrier(first, controlledProps, 1),
    reachFrameBarrier(second, secondProps, 2),
  ]);

  assert.deepEqual(first.order.slice(0, 3), ['camera', 'layout', 'frame']);
  assert.deepEqual(second.order.slice(0, 3), ['camera', 'layout', 'frame']);
  assert.equal(
    first.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    false,
  );
  assert.equal(
    second.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    false,
  );

  second.emit('render');
  assert.equal(
    second.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    true,
  );
  assert.equal(
    first.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    false,
  );
  first.emit('render');
  assert.equal(
    first.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'),
    true,
  );

  await first.owner.dispose();
  await second.owner.dispose();
});
