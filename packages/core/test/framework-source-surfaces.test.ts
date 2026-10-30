import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const rendererDiscriminator = /\bkind\s*:\s*['"](?:tileflow|maplibre)['"]/u;

// Rejection tests intentionally retain obsolete inputs; positive consumers must not.
const positiveConsumers = [
  'packages/core/test/manifest.test.ts',
  'packages/core/test/native-manifest-package.test.ts',
  'packages/capture/test/framework-server-integration.test.ts',
  'packages/capture/test/framework-vite-harness.ts',
  'packages/capture/test/react-semantic-interactions-vite.test.ts',
  'packages/capture/test/react-vite-integration.test.ts',
  'packages/capture/test/tileflow-source-fixture.ts',
  'packages/capture/test/vue-svelte-vite-integration.test.ts',
  'scripts/peer-compat-smoke.mjs',
];
const publicSourceImplementations = [
  'packages/core/src/runtime.ts',
  'packages/core/src/native-source-types.ts',
  'packages/core/src/native-source-controller.ts',
  'packages/react/src/map.tsx',
  'packages/react/src/map-style-inputs.ts',
  'packages/vue/src/index.ts',
  'packages/vue/src/style-source.ts',
  'packages/svelte/src/TileflowMap.svelte',
  'packages/svelte/src/style-source.js',
  'packages/svelte/src/index.d.ts',
  'packages/react-native/src/contract.ts',
  'packages/react-native/src/source-state.ts',
  'packages/react-native/src/appearance.ts',
];

test('positive framework consumers use manifest-backed Tileflow sources', async () => {
  for (const path of positiveConsumers) {
    assert.doesNotMatch(await readFile(new URL(path, root), 'utf8'), rendererDiscriminator, path);
  }
});

test('public source implementations contain no unmanaged renderer branch', async () => {
  for (const path of publicSourceImplementations) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(source, rendererDiscriminator, path);
    assert.doesNotMatch(source, /\bsource(?:\?\.|\.)kind\b|\bsourceKind\b/u, path);
  }
});
