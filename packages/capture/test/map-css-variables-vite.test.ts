import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, disable, land, type MapLibreStyle, token} from '@tileflow/core';
import {extendStreets} from '../../core/test/map-fixture';
import {type MapAppFramework, withMapApp} from './map-app-harness';
import {writeFrameworkMapFixture} from './tileflow-source-fixture';

type AppWindow = typeof window & {
  __colorCalls: number;
  __errors: {code: string; message: string}[];
  __loaded: boolean;
};

const writeFixture = (cwd: string) =>
  writeFrameworkMapFixture(
    cwd,
    createStyle(
      extendStreets({
        modules: {poi: disable(), land: land({background: {color: token.color('surface.land')}})},
      }),
      {runtimeColors: true, theme: 'light'},
    ) as MapLibreStyle,
    {family: true},
  );

// The page's own design tokens, as a design system writes them. `--land` reaches `--base` through
// a second variable, `--missing` has no value, and the system dark preference changes `--base` only
// while the page has no `dark` class.
const styles = `:root { --base: #e8f0d8; --land: var(--base); --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --base: #202040; } }
:root.dark { --base: #1b2b1b; --accent: #93c5fd; }`;

const caseScript = `const params = new URLSearchParams(location.search);
const source = {map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
const colors = {
  'surface.land': params.has('missing') ? 'var(--missing)' : 'var(--land)',
  'surface.water': 'color-mix(in srgb, var(--accent) 50%, var(--missing, #ffffff))',
  'surface.park': 'var(--missing, #00ff00)',
};
const sheet = document.createElement('style');
sheet.textContent = ${JSON.stringify(styles)};
document.head.append(sheet);
window.__errors = [];
window.__loaded = false;
window.__colorCalls = 0;
const onError = ({code, error}) => window.__errors.push({code, message: error.message});
const onLoad = (map) => {
  window.__map = map;
  window.__loaded = true;
};
const countColorCalls = (handle) => {
  const controller = handle.getThemeController();
  const setColors = controller.setColors.bind(controller);
  controller.setColors = (...args) => {
    window.__colorCalls += 1;
    return setColors(...args);
  };
};`;

const reactApp = `import React, {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {configureTileflowMapLibre, Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});
${caseScript}
function App() {
  const ref = useRef(null);
  return <Map captureId="css" colors={colors} height={320} onError={onError}
    onLoad={(map) => { onLoad(map); countColorCalls(ref.current); }}
    ref={ref} source={source} zoom={3} />;
}
createRoot(document.getElementById('root')).render(<App />);
`;

const vueApp = `<script setup>
import {ref} from 'vue';
import {TileflowMap} from '@tileflow/vue';
import 'maplibre-gl/dist/maplibre-gl.css';
${caseScript}
const map = ref(null);
const loaded = (loadedMap) => { onLoad(loadedMap); countColorCalls(map.value); };
</script>
<template>
  <TileflowMap ref="map" capture-id="css" :colors="colors" :height="320" :source="source" :zoom="3"
    @error="onError" @load="loaded" />
</template>
`;

const svelteApp = `<script>
import {TileflowMap} from '@tileflow/svelte';
import 'maplibre-gl/dist/maplibre-gl.css';
${caseScript}
let map;
</script>
<TileflowMap bind:this={map} captureId="css" {colors} height={320} {onError} {source} zoom={3}
  on:load={(event) => { onLoad(event.detail); countColorCalls(map); }} />
`;

const apps: [MapAppFramework, string][] = [
  ['react', reactApp],
  ['vue', vueApp],
  ['svelte', svelteApp],
];

const landColour = (page: import('playwright').Page) =>
  page.evaluate(() => {
    const value = (window as unknown as {__map: import('maplibre-gl').Map}).__map.getPaintProperty(
      'tileflow-background',
      'background-color',
    );
    return String(value).toLowerCase();
  });
const waitForLand = (page: import('playwright').Page, expected: string) =>
  page.waitForFunction(
    (colour) =>
      String(
        (window as unknown as {__map: import('maplibre-gl').Map}).__map.getPaintProperty(
          'tileflow-background',
          'background-color',
        ),
      ).toLowerCase() === colour,
    expected,
    {timeout: 15_000},
  );

for (const [framework, source] of apps)
  test(
    `${framework} follows CSS variables in colors when the page changes its theme`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
    () =>
      withMapApp(
        framework,
        source,
        async (open) => {
          const {consoleErrors, page, pageErrors} = await open();
          await page.waitForFunction(() => (window as AppWindow).__loaded);

          // The variables resolve where the map sits, through a second variable.
          await waitForLand(page, '#e8f0d8');
          const calls = () => page.evaluate(() => (window as AppWindow).__colorCalls);
          const afterLoad = await calls();

          // A class on <html> that gives the variables other values recolours the map.
          await page.evaluate(() => document.documentElement.classList.add('dark'));
          await waitForLand(page, '#1b2b1b');
          const dark = await calls();
          assert.equal(dark, afterLoad + 1);

          // A class change that leaves every variable as it was applies nothing again.
          await page.evaluate(() => document.documentElement.classList.add('unrelated'));
          await page.evaluate(() => document.body.setAttribute('data-theme', 'unrelated'));
          await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
          assert.equal(await calls(), dark);
          assert.equal(await landColour(page), '#1b2b1b');

          // Taking the class off brings the first colours back.
          await page.evaluate(() => document.documentElement.classList.remove('dark'));
          await waitForLand(page, '#e8f0d8');

          // The system's colour scheme, with no class involved, does the same.
          await page.emulateMedia({colorScheme: 'dark'});
          await waitForLand(page, '#202040');
          await page.emulateMedia({colorScheme: 'light'});
          await waitForLand(page, '#e8f0d8');

          assert.deepEqual(await page.evaluate(() => (window as AppWindow).__errors), []);
          assert.deepEqual(pageErrors, []);
          assert.deepEqual(
            consoleErrors.filter((text) => text.includes('Tileflow')),
            [],
          );

          // A variable with no value and no fallback is an error that names it.
          const missing = await open('?missing');
          await missing.page.waitForFunction(() => (window as AppWindow).__errors.length > 0);
          const [error] = await missing.page.evaluate(() => (window as AppWindow).__errors);
          assert.equal(error?.code, 'colors');
          assert.match(error!.message, /"surface\.land"/u);
          assert.match(error!.message, /--missing has no value and no fallback/u);
        },
        {writeFixture},
      ),
  );
