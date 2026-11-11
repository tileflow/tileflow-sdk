import {svelte} from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer, type PluginOption} from 'vite';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {writeDataLayerFixture} from './tileflow-source-fixture';

type AppWindow = typeof window & {
  __errors: {code: string; message: string}[];
  __loaded: boolean;
};

// Each application reads its case from the URL: `?map=` names the map to show, `?colors` asks for
// a colour token the map does not have, and `?silent` leaves the error handler out.
const caseScript = `const params = new URLSearchParams(location.search);
const source = {map: params.get('map') ?? 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
const colors = params.has('colors') ? {'no.such.token': '#ff0000'} : undefined;
const silent = params.has('silent');
window.__errors = [];
window.__loaded = false;
const onError = silent ? undefined : ({code, error}) =>
  window.__errors.push({code, message: error.message});
const onLoad = () => {
  window.__loaded = true;
};`;

const reactApp = `import React from 'react';
import {createRoot} from 'react-dom/client';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre, Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});
${caseScript}
createRoot(document.getElementById('root')).render(
  <Map captureId="errors" colors={colors} height={320} onError={onError} onLoad={onLoad} source={source} zoom={3} />,
);
`;

const vueApp = `<script setup>
import {TileflowMap} from '@tileflow/vue';
import 'maplibre-gl/dist/maplibre-gl.css';
${caseScript}
</script>
<template>
  <TileflowMap v-if="silent" capture-id="errors" :colors="colors" :height="320" :source="source" :zoom="3" @load="onLoad" />
  <TileflowMap v-else capture-id="errors" :colors="colors" :height="320" :source="source" :zoom="3" @error="onError" @load="onLoad" />
</template>
`;

const svelteApp = `<script>
import {TileflowMap} from '@tileflow/svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
${caseScript}
</script>
<TileflowMap captureId="errors" {colors} height={320} {onError} on:load={onLoad} {source} zoom={3} />
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

const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));

for (const [framework, file, source, plugins] of [
  ['react', 'main.tsx', reactApp, []],
  ['vue', 'App.vue', vueApp, [vue()]],
  ['svelte', 'App.svelte', svelteApp, [svelte()]],
] as [string, string, string, PluginOption[]][])
  test(
    `${framework} reports map failures to onError, and to the console without one`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
    async () => {
      const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
      const cwd = await mkdtemp(join(root, `.tileflow-test-${framework}-map-errors-`));
      let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
      let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
      try {
        await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
        await Promise.all([
          writeFile(
            join(cwd, 'index.html'),
            `<!doctype html><html><body><div id="root" style="width:640px"></div><script type="module" src="/${framework === 'react' ? 'main.tsx' : 'main.js'}"></script></body></html>`,
          ),
          ...(framework === 'react' ? [] : [writeFile(join(cwd, 'main.js'), entry(framework))]),
          writeFile(join(cwd, file), source),
          writeDataLayerFixture(cwd, 'http://127.0.0.1'),
        ]);
        vite = await createViteServer({
          cacheDir: join(cwd, '.vite-cache'),
          configFile: false,
          logLevel: 'silent',
          plugins,
          resolve: framework === 'react' ? {alias: {'@tileflow/react': reactSource}} : {},
          root: cwd,
          server: {host: '127.0.0.1', port: 0, watch: null},
        });
        await vite.listen();
        const address = vite.httpServer?.address();
        assert.ok(address && typeof address === 'object');
        const origin = `http://127.0.0.1:${address.port}`;
        await writeDataLayerFixture(cwd, origin);

        browser = await launchTileflowCaptureBrowser({allowInstall: false});
        const open = async (query: string) => {
          const page = await browser!.newPage({viewport: {height: 480, width: 640}});
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
          });
          page.on('pageerror', (error) => pageErrors.push(error.message));
          await page.goto(`${origin}/${query}`, {waitUntil: 'domcontentloaded'});
          return {consoleErrors, page, pageErrors};
        };

        // A colour token the map does not have: reported once as `colors`, nothing on the console.
        const colours = await open('?colors');
        await colours.page.waitForFunction(() => (window as AppWindow).__errors.length > 0);
        await colours.page.waitForFunction(() => (window as AppWindow).__loaded);
        const colourErrors = await colours.page.evaluate(() => (window as AppWindow).__errors);
        assert.deepEqual(
          colourErrors.map(({code}) => code),
          ['colors'],
        );
        assert.ok(colourErrors[0]!.message.length > 0);
        assert.deepEqual(
          colours.consoleErrors.filter((text) => text.includes('Tileflow')),
          [],
        );
        assert.deepEqual(colours.pageErrors, []);

        // A map the manifest does not have: `manifest`.
        const missing = await open('?map=no-such-map');
        await missing.page.waitForFunction(() => (window as AppWindow).__errors.length > 0);
        const manifestErrors = await missing.page.evaluate(() => (window as AppWindow).__errors);
        assert.equal(manifestErrors[0]?.code, 'manifest');
        assert.match(manifestErrors[0]!.message, /no-such-map/u);
        assert.deepEqual(
          missing.consoleErrors.filter((text) => text.includes('Tileflow')),
          [],
        );

        // Without a handler the same failure stays on the console, as before.
        const silent = await open('?colors&silent');
        await silent.page.waitForFunction(() => (window as AppWindow).__loaded);
        await silent.page.waitForTimeout(500);
        assert.ok(
          silent.consoleErrors.some((text) =>
            text.includes('Failed to apply the Tileflow map colors'),
          ),
          silent.consoleErrors.join('\n'),
        );
        assert.deepEqual(await silent.page.evaluate(() => (window as AppWindow).__errors), []);
      } finally {
        await browser?.close();
        await vite?.close();
        await rm(cwd, {force: true, recursive: true});
      }
    },
  );
