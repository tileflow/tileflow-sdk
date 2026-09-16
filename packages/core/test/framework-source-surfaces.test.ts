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
const publicDocuments = [
  'docs/contracts/framework-browser-runtime.md',
  'packages/core/README.md',
  'packages/core/docs/native-resource-urls.md',
  'packages/core/docs/public-api-and-browser-subpath.md',
  'packages/next/README.md',
  'packages/react/README.md',
  'packages/react-native/README.md',
  'packages/svelte/README.md',
  'packages/vite/README.md',
  'packages/vue/README.md',
  'packages/webpack/README.md',
];

test('positive framework consumers use manifest-backed Tileflow sources', async () => {
  for (const path of positiveConsumers) {
    assert.doesNotMatch(await readFile(new URL(path, root), 'utf8'), rendererDiscriminator, path);
  }
});

test('public Map documentation does not teach a renderer-discriminated source', async () => {
  for (const path of publicDocuments) {
    assert.doesNotMatch(await readFile(new URL(path, root), 'utf8'), rendererDiscriminator, path);
  }
});
