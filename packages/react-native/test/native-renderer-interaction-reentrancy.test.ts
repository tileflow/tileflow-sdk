import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner} from '../src/native-renderer-owner';
import type {NativeSurfaceEvent} from '../src/native-surface-contract';

function target(name: string, generation: number) {
  const map = {
    name: 'main',
    defaultTheme: 'light',
    themes: {
      light: {colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
    },
  };
  return {
    source: {
      status: 'ready',
      generation,
      map,
      source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
      manifest: {version: 1, maps: {main: map}},
      manifestUrl: 'https://maps.example.test/manifest.json',
      theme: {name, colorScheme: 'light', styleUrl: `https://maps.example.test/${name}.json`},
    } as Extract<TileflowNativeSourceState, {status: 'ready'}>,
    style: {version: 8, name, sources: {}, layers: []},
  };
}

test('a retirement observer cannot make an older preparation failure roll back a newer theme', async () => {
  let receive: (event: NativeSurfaceEvent) => void = () => undefined;
  let sequence = 0;
  let replace = false;
  const events: unknown[] = [];
  const owner = createNativeRendererOwner(
    'map',
    target('light', 1),
    {},
    {
      emit: (event) => events.push(event),
      changed() {},
      interactionsChanged() {
        if (replace) {
          replace = false;
          owner.setTarget(target('newest', 3));
        }
      },
      surfaces: {
        async attach(_root, notify) {
          receive = notify;
          return {
            id: 'surface',
            async expectStyle() {},
            async commitLayout() {
              return 1;
            },
            async requestFrame() {},
            async applyCamera(command, view) {
              return {command, view};
            },
            async cancelCamera() {
              return {cancelled: true as const};
            },
            async retire() {},
          };
        },
        async retireRoot() {},
      },
    },
  );
  const emit = (kind: 'style' | 'render') =>
    receive({
      kind,
      surface: 'surface',
      style: owner.token,
      sequence: ++sequence,
      layout: 1,
    });
  await owner.attach(1);
  await owner.whenIdle();
  emit('style');
  await owner.whenIdle();
  owner.afterCommit({});
  await owner.whenIdle();
  emit('render');
  assert.equal(owner.currentTheme?.name, 'light');
  const proof = owner.getInteractionStyle()!;
  replace = true;
  owner.preparationFailed(2);
  await owner.whenIdle();
  assert.equal(proof.isCurrent(), false);
  assert.equal(owner.snapshot.style.name, 'newest');
  assert.equal(owner.getInteractionStyle(), undefined);
  emit('style');
  await owner.whenIdle();
  assert.equal(owner.getInteractionStyle()?.style.name, 'newest');
  await owner.dispose();
});
