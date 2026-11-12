import assert from 'node:assert/strict';
import test from 'node:test';

type MapLibreRuntime = typeof import('../src/maplibre');

const bundlerWorkerUrlKey = Symbol.for('tileflow.maplibre.workerUrl');

// Each case loads its own copy of the module: the worker is configured once per page.
let copies = 0;
const freshRuntime = async (): Promise<MapLibreRuntime> =>
  (await import(`../src/maplibre.ts?copy=${(copies += 1)}`)) as MapLibreRuntime;

const withBundlerWorker = async (url: string, body: () => Promise<void>) => {
  (globalThis as Record<symbol, unknown>)[bundlerWorkerUrlKey] = url;
  try {
    await body();
  } finally {
    delete (globalThis as Record<symbol, unknown>)[bundlerWorkerUrlKey];
  }
};

test('a map uses the bundler-provided worker when the application configures none', () =>
  withBundlerWorker('/bundled/maplibre-gl-worker.mjs', async () => {
    const runtime = await freshRuntime();
    const maplibregl = await runtime.loadTileflowMapLibre();
    assert.equal(maplibregl.getWorkerUrl(), '/bundled/maplibre-gl-worker.mjs');

    // Repeating the same worker is harmless; replacing the running one is refused.
    runtime.configureTileflowMapLibre({workerUrl: '/bundled/maplibre-gl-worker.mjs'});
    assert.throws(
      () => runtime.configureTileflowMapLibre({workerUrl: '/assets/other-worker.mjs'}),
      /already configured/u,
    );
    assert.equal(maplibregl.getWorkerUrl(), '/bundled/maplibre-gl-worker.mjs');
  }));

test('an explicit worker wins over the bundler-provided one', () =>
  withBundlerWorker('/bundled/maplibre-gl-worker.mjs', async () => {
    const runtime = await freshRuntime();
    runtime.configureTileflowMapLibre({workerUrl: '/assets/explicit-worker.mjs'});
    const maplibregl = await runtime.loadTileflowMapLibre();
    assert.equal(maplibregl.getWorkerUrl(), '/assets/explicit-worker.mjs');
    // The same explicit worker again after the first map changes nothing.
    runtime.configureTileflowMapLibre({workerUrl: '/assets/explicit-worker.mjs'});
    assert.equal(maplibregl.getWorkerUrl(), '/assets/explicit-worker.mjs');
  }));
