import assert from 'node:assert/strict';
import test from 'node:test';
import {configureTileflowMapLibre, loadTileflowMapLibre} from '../src/maplibre-loader';

test('the managed map entry imports without browser globals and shares its renderer loader', async () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  const entry = await import('../src/maplibre');
  assert.equal(entry.configureTileflowMapLibre, configureTileflowMapLibre);
  assert.equal(entry.loadTileflowMapLibre, loadTileflowMapLibre);
  assert.equal(typeof entry.createTileflowMap, 'function');
});

test('worker configuration rejects absent, empty and non-string URLs before storing them', () => {
  for (const workerUrl of [undefined, null, '', '  \n\t ', 42, {}]) {
    assert.throws(() => configureTileflowMapLibre({workerUrl: workerUrl as string}), {
      name: 'TypeError',
      message: /workerUrl must be a non-empty string/,
    });
  }
});

test('a failed renderer setup can be retried, while successful loads and worker configuration are shared', async () => {
  const workerUrl = '/assets/tileflow-test-maplibre-worker.mjs';
  configureTileflowMapLibre({workerUrl});
  configureTileflowMapLibre({workerUrl});

  // Use MapLibre's actual worker setter. A failed configuration must not leave the shared
  // promise permanently rejected; no alternate loader is added to the production API.
  const renderer = await import('maplibre-gl');
  const config = renderer.config;
  const original = Object.getOwnPropertyDescriptor(config, 'WORKER_URL');
  assert.ok(original?.configurable, 'MapLibre exposes its configurable worker URL');
  const failure = new Error('Worker configuration temporarily failed');
  Object.defineProperty(config, 'WORKER_URL', {
    configurable: true,
    enumerable: original.enumerable,
    get: () => original.value,
    set: () => {
      throw failure;
    },
  });
  let failed: ReturnType<typeof loadTileflowMapLibre>;
  try {
    failed = loadTileflowMapLibre();
    assert.equal(loadTileflowMapLibre(), failed);
    await assert.rejects(failed, (error) => error === failure);
  } finally {
    Object.defineProperty(config, 'WORKER_URL', original);
  }

  const retry = loadTileflowMapLibre();
  assert.notEqual(retry, failed!);
  assert.equal(loadTileflowMapLibre(), retry);
  const loaded = await retry;
  assert.equal(loaded, renderer);
  assert.equal(loaded.getWorkerUrl(), workerUrl);
  configureTileflowMapLibre({workerUrl});
  assert.equal(loaded.getWorkerUrl(), workerUrl);
  assert.throws(
    () => configureTileflowMapLibre({workerUrl: '/assets/another-worker.mjs'}),
    /workerUrl is already configured/,
  );
  assert.equal(loaded.getWorkerUrl(), workerUrl);
});
