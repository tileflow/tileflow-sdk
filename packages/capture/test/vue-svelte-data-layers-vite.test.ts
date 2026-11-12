import {svelte} from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer, type PluginOption} from 'vite';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {writeDataLayerFixture} from './tileflow-source-fixture';

type AppWindow = typeof window & {
  __events: {kind: string; pointCount?: number}[];
  __map: MapLibreMap;
};

const script = `import {clusterOverlay, geojsonSource, heatmapOverlay} from '@tileflow/core/runtime';

const source = {map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
const dataSources = {
  stores: geojsonSource({
    cluster: true,
    clusterRadius: 60,
    data: {
      type: 'FeatureCollection',
      features: Array.from({length: 40}, (_, index) => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [(index % 10) * 0.2, Math.floor(index / 10) * 0.2]},
        properties: {},
      })),
    },
  }),
};
const dataOverlays = {
  heat: heatmapOverlay({id: 'stores-heat', placement: 'below-labels', source: 'stores'}),
  stores: clusterOverlay({id: 'stores', placement: 'below-labels', source: 'stores'}),
};
const annotations = [
  {kind: 'marker', id: 'a', ariaLabel: 'A', coordinate: [-20, 0]},
  {kind: 'marker', id: 'b', ariaLabel: 'B', coordinate: [-20.01, 0]},
];
const annotationClusters = {clusterRadius: 40};
window.__events = [];
const onEvent = ({target}) =>
  window.__events.push({kind: target.kind, pointCount: target.pointCount});
const onLoad = (map) => {
  window.__map = map;
};`;

const vueApp = `<script setup>
import {TileflowMap} from '@tileflow/vue';
import 'maplibre-gl/dist/maplibre-gl.css';
${script}
</script>
<template>
  <TileflowMap
    :annotation-clusters="annotationClusters"
    :annotations="annotations"
    :center="[0, 0]"
    :data-overlays="dataOverlays"
    :data-sources="dataSources"
    :height="480"
    :source="source"
    :zoom="3"
    capture-id="data-layers"
    @interaction-event="onEvent"
    @load="onLoad"
  />
</template>
`;

const svelteApp = `<script>
import {TileflowMap} from '@tileflow/svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
${script}
</script>
<TileflowMap
  {annotationClusters}
  {annotations}
  center={[0, 0]}
  {dataOverlays}
  {dataSources}
  height={480}
  captureId="data-layers"
  onInteractionEvent={onEvent}
  on:load={(event) => onLoad(event.detail)}
  {source}
  zoom={3}
/>
`;

const entry = (framework: string) =>
  framework === 'vue'
    ? `import {createApp} from 'vue';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/vue';
import App from './App.vue';
configureTileflowMapLibre({workerUrl});
createApp(App).mount('#root');
`
    : `import {mount} from 'svelte';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre} from '@tileflow/svelte';
import App from './App.svelte';
configureTileflowMapLibre({workerUrl});
mount(App, {target: document.getElementById('root')});
`;

for (const [framework, file, source, plugin] of [
  ['vue', 'App.vue', vueApp, vue()],
  ['svelte', 'App.svelte', svelteApp, svelte()],
] as [string, string, string, PluginOption][])
  test(
    `${framework} draws runtime data layers and expands clusters on a real map`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
    async () => {
      const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
      const cwd = await mkdtemp(join(root, `.tileflow-test-${framework}-data-layers-`));
      let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
      let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
      try {
        await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
        await Promise.all([
          writeFile(
            join(cwd, 'index.html'),
            '<!doctype html><html><body><div id="root" style="width:640px"></div><script type="module" src="/main.js"></script></body></html>',
          ),
          writeFile(join(cwd, 'main.js'), entry(framework)),
          writeFile(join(cwd, file), source),
          writeDataLayerFixture(cwd, 'http://127.0.0.1'),
        ]);
        vite = await createViteServer({
          cacheDir: join(cwd, '.vite-cache'),
          configFile: false,
          logLevel: 'silent',
          plugins: [plugin],
          root: cwd,
          server: {host: '127.0.0.1', port: 0, watch: null},
        });
        await vite.listen();
        const address = vite.httpServer?.address();
        assert.ok(address && typeof address === 'object');
        const origin = `http://127.0.0.1:${address.port}`;
        await writeDataLayerFixture(cwd, origin);

        browser = await launchTileflowCaptureBrowser({allowInstall: false});
        const page = await browser.newPage({viewport: {height: 480, width: 640}});
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => {
          const map = (window as AppWindow).__map;
          return Boolean(
            map?.getLayer('stores-clusters') &&
            map.queryRenderedFeatures({layers: ['stores-clusters']}).length > 0,
          );
        });
        assert.deepEqual(
          await page.evaluate(() =>
            (window as AppWindow).__map
              .getLayersOrder()
              .filter((id) => id === 'stores-heat' || id === 'labels'),
          ),
          ['stores-heat', 'labels'],
        );

        const point = await page.evaluate(() => {
          const map = (window as AppWindow).__map;
          const feature = map.queryRenderedFeatures({layers: ['stores-clusters']})[0]!;
          const {x, y} = map.project(
            (feature.geometry as unknown as {coordinates: [number, number]}).coordinates,
          );
          return {x, y};
        });
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction(() => (window as AppWindow).__map.getZoom() > 3.5);
        assert.equal(await page.evaluate(() => (window as AppWindow).__events[0]?.kind), 'cluster');

        const button = page.locator('.tileflow-interaction-cluster');
        assert.equal(await button.getAttribute('aria-label'), '2 places');
        assert.equal(await page.locator('.tileflow-interaction-marker:visible').count(), 0);
        assert.deepEqual(errors, []);
      } finally {
        await browser?.close();
        await vite?.close();
        await rm(cwd, {force: true, recursive: true});
      }
    },
  );
