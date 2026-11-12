import assert from 'node:assert/strict';
import test from 'node:test';
import {type MapAppFramework, withMapApp} from './map-app-harness';

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

const apps: [MapAppFramework, string][] = [
  ['react', reactApp],
  ['vue', vueApp],
  ['svelte', svelteApp],
];

for (const [framework, source] of apps)
  test(
    `${framework} reports map failures to onError, and to the console without one`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
    () =>
      withMapApp(framework, source, async (open) => {
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
      }),
  );
