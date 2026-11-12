import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowMapLibreWorker} from '@tileflow/vite';
import {type MapAppFramework, withMapApp} from './map-app-harness';

type AppWindow = typeof window & {__workerUrl(): string};

// The applications import no worker and never call configureTileflowMapLibre: the Vite plugin
// gives the map its worker. Before it did, Vite's dev server answered "Worker failed to load".
const source = `{manifestUrl: '/tileflow-fixture/manifest.json', map: 'main'}`;
const workerProbe = `import * as maplibregl from 'maplibre-gl';
window.__workerUrl = () => maplibregl.getWorkerUrl();`;

const domApp = (prelude = '') => `${prelude}import {createTileflowMap} from '@tileflow/dom';
${workerProbe}
import 'maplibre-gl/dist/maplibre-gl.css';

const container = document.createElement('div');
container.style.cssText = 'height: 320px; position: relative';
document.getElementById('root').append(container);
createTileflowMap(container, {source: ${source}, zoom: 3}, {captureId: 'worker'});
`;

const apps: [MapAppFramework, string][] = [
  ['dom', domApp()],
  [
    'react',
    `import React from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from '@tileflow/react';
${workerProbe}
import 'maplibre-gl/dist/maplibre-gl.css';

createRoot(document.getElementById('root')).render(
  <Map captureId="worker" height={320} source={${source}} zoom={3} />,
);
`,
  ],
  [
    'vue',
    `<script setup>
import {TileflowMap} from '@tileflow/vue';
${workerProbe}
import 'maplibre-gl/dist/maplibre-gl.css';
const source = ${source};
</script>
<template>
  <TileflowMap capture-id="worker" :height="320" :source="source" :zoom="3" />
</template>
`,
  ],
  [
    'svelte',
    `<script>
import {TileflowMap} from '@tileflow/svelte';
${workerProbe}
import 'maplibre-gl/dist/maplibre-gl.css';
const source = ${source};
</script>
<TileflowMap captureId="worker" height={320} {source} zoom={3} />
`,
  ],
];

for (const [framework, app] of apps) {
  test(
    `a ${framework} map runs in Vite dev with the worker the plugin provides`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
    () =>
      withMapApp(
        framework,
        app,
        async (open) => {
          const {consoleErrors, page, pageErrors} = await open();
          const frame = page.locator('[data-tileflow-capture-id="worker"]');
          await frame.and(page.locator('[data-tileflow-state="idle"]')).waitFor({timeout: 30_000});
          assert.match(
            await page.evaluate(() => (window as AppWindow).__workerUrl()),
            /maplibre-gl-worker\.mjs\?worker_file&type=module$/u,
          );
          assert.deepEqual(pageErrors, []);
          assert.deepEqual(consoleErrors, []);
        },
        {configureWorker: false, plugins: [tileflowMapLibreWorker()]},
      ),
  );
}

test(
  'an explicit worker configuration still decides beside the plugin',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  () =>
    withMapApp(
      'dom',
      domApp(`import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/dom';
configureTileflowMapLibre({workerUrl: workerUrl + '&explicit'});
`),
      async (open) => {
        const {consoleErrors, page, pageErrors} = await open();
        const frame = page.locator('[data-tileflow-capture-id="worker"]');
        await frame.and(page.locator('[data-tileflow-state="idle"]')).waitFor({timeout: 30_000});
        assert.match(
          await page.evaluate(() => (window as AppWindow).__workerUrl()),
          /maplibre-gl-worker\.mjs\?worker_file&type=module&explicit$/u,
        );
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(consoleErrors, []);
      },
      {plugins: [tileflowMapLibreWorker()]},
    ),
);
