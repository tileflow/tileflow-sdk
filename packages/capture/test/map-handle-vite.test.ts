import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import {type MapAppFramework, withMapApp} from './map-app-harness';

type AppWindow = typeof window & {
  __before: {map: unknown; controller: unknown} | null;
  __loaded: MapLibreMap | null;
  __probe: () => {
    controllerTheme: string | undefined;
    sameMap: boolean;
    setThemeIsFunction: boolean;
    stableHandle: boolean;
  };
  __unmount: () => void;
};

// Each application keeps the handle its framework gives (a React ref, a Vue template ref, a Svelte
// `bind:this`), reads it before the map loads, and exposes a probe for the test.
const probe = `window.__probe = () => ({
  controllerTheme: handle()?.getThemeController()?.getCurrent().theme,
  sameMap: handle()?.getMap() === window.__loaded,
  setThemeIsFunction: typeof handle()?.getThemeController()?.setTheme === 'function',
  stableHandle: handle() === firstHandle,
});`;

const reactApp = `import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre, Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});
window.__loaded = null;
let firstHandle;
function App() {
  const ref = useRef(null);
  const [shown, setShown] = useState(true);
  window.__unmount = () => setShown(false);
  const handle = () => ref.current ?? firstHandle;
  useEffect(() => {
    firstHandle = ref.current;
    window.__before = {map: ref.current.getMap(), controller: ref.current.getThemeController()};
    ${probe}
  }, []);
  return shown ? <Map captureId="handle" height={320} onLoad={(map) => { window.__loaded = map; }}
    ref={ref} source={{map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'}} zoom={3} /> : null;
}
createRoot(document.getElementById('root')).render(<App />);
`;

const vueApp = `<script setup>
import {onMounted, ref} from 'vue';
import {TileflowMap} from '@tileflow/vue';
import 'maplibre-gl/dist/maplibre-gl.css';

window.__loaded = null;
const map = ref(null);
const shown = ref(true);
let firstHandle;
const handle = () => map.value ?? firstHandle;
window.__unmount = () => { shown.value = false; };
onMounted(() => {
  firstHandle = map.value;
  window.__before = {map: map.value.getMap(), controller: map.value.getThemeController()};
  ${probe}
});
const source = {map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
const onLoad = (loaded) => { window.__loaded = loaded; };
</script>
<template>
  <TileflowMap v-if="shown" ref="map" capture-id="handle" :height="320" :source="source" :zoom="3" @load="onLoad" />
</template>
`;

const svelteApp = `<script>
import {onMount} from 'svelte';
import {TileflowMap} from '@tileflow/svelte';
import 'maplibre-gl/dist/maplibre-gl.css';

window.__loaded = null;
let map;
let shown = true;
let firstHandle;
const handle = () => map ?? firstHandle;
window.__unmount = () => { shown = false; };
onMount(() => {
  firstHandle = map;
  window.__before = {map: map.getMap(), controller: map.getThemeController()};
  ${probe}
});
const source = {map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
</script>
{#if shown}
  <TileflowMap bind:this={map} captureId="handle" height={320} {source} zoom={3}
    on:load={(event) => { window.__loaded = event.detail; }} />
{/if}
`;

const apps: [MapAppFramework, string][] = [
  ['react', reactApp],
  ['vue', vueApp],
  ['svelte', svelteApp],
];

for (const [framework, source] of apps)
  test(
    `${framework} hands the application the MapLibre map and the theme controller`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
    () =>
      withMapApp(framework, source, async (open) => {
        const {consoleErrors, page, pageErrors} = await open();
        await page.waitForFunction(() => Boolean((window as AppWindow).__before));

        // Before the map has loaded there is nothing to hand out.
        assert.deepEqual(await page.evaluate(() => (window as AppWindow).__before), {
          controller: null,
          map: null,
        });

        // Once it has loaded, the handle gives the very map that `load` gave, and a controller
        // that is showing the map's theme.
        await page.waitForFunction(() => Boolean((window as AppWindow).__loaded));
        assert.deepEqual(await page.evaluate(() => (window as AppWindow).__probe()), {
          controllerTheme: 'light',
          sameMap: true,
          setThemeIsFunction: true,
          stableHandle: true,
        });

        // The controller drives the map: a theme the map has swaps the style.
        const background = await page.evaluate(async () => {
          const handle = (window as AppWindow).__loaded!;
          return handle.getPaintProperty('background', 'background-color');
        });
        assert.equal(background, '#dfe7ef');

        // Taking the map down empties the handle instead of leaving a stale map behind.
        await page.evaluate(() => (window as AppWindow).__unmount());
        await page.waitForFunction(() => !document.querySelector('.maplibregl-map'));
        assert.deepEqual(
          await page.evaluate(() => {
            const result = (window as AppWindow).__probe();
            return {sameMap: result.sameMap, theme: result.controllerTheme};
          }),
          {sameMap: false, theme: undefined},
        );
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(
          consoleErrors.filter((text) => text.includes('Tileflow')),
          [],
        );
      }),
  );
