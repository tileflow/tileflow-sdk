import assert from 'node:assert/strict';
import test from 'node:test';
import {withMapApp} from './map-app-harness';

type AppWindow = typeof window & {
  __proof: {attempts: number; diagnostics: string[]; loaded: boolean; removed: number};
  __setBindings: (id: string) => void;
  __sameMap: () => boolean;
  __unmount: () => void;
};

const app = `<script setup>
import {ref} from 'vue';
import {TileflowMap} from '@tileflow/vue';
import {Map as MapLibreMap} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const handle = ref(null);
const shown = ref(true);
const interactions = ref([]);
const source = {map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'};
const proof = window.__proof = {attempts: 0, diagnostics: [], loaded: false, removed: 0};
window.__setBindings = (id) => {
  interactions.value = [{
    id,
    popup: {content: {kind: 'text', text: 'A place'}},
    target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
  }];
};
window.__unmount = () => { shown.value = false; };
// Fail the first optional POI attachment, which the shared DOM runtime starts with the map.
const on = MapLibreMap.prototype.on;
MapLibreMap.prototype.on = function(event, ...args) {
  if (event === 'mousemove' && ++proof.attempts === 1) {
    throw new Error('The first POI listener could not be installed');
  }
  return on.call(this, event, ...args);
};
const onLoad = (map) => {
  map.on('remove', () => { proof.removed += 1; });
  window.__sameMap = () => handle.value?.getMap() === map;
  proof.loaded = true;
};
const onDiagnostic = (diagnostic) => { proof.diagnostics.push(diagnostic.code); };
</script>
<template>
  <TileflowMap v-if="shown" ref="handle" :height="320" :source="source" :zoom="3"
    :interactions="interactions" @load="onLoad" @interaction-diagnostic="onDiagnostic" />
</template>
`;

test(
  'Vue keeps its map when optional POI initialization fails and can retry the interaction',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  () =>
    withMapApp('vue', app, async (open) => {
      const {page, pageErrors, consoleErrors} = await open();
      await page
        .waitForFunction(() => (window as AppWindow).__proof?.loaded)
        .catch((cause) => {
          throw new Error([...pageErrors, ...consoleErrors].join('\n') || 'Vue map did not load', {
            cause,
          });
        });
      await page.waitForFunction(() =>
        (window as AppWindow).__proof.diagnostics.includes('OVERLAY_FAILURE'),
      );
      assert.equal(await page.evaluate(() => (window as AppWindow).__sameMap()), true);
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 1);
      assert.equal(await page.evaluate(() => (window as AppWindow).__proof.removed), 0);

      await page.evaluate(() => (window as AppWindow).__setBindings('retry'));
      await page.waitForFunction(() => (window as AppWindow).__proof.attempts === 2);
      assert.equal(await page.evaluate(() => (window as AppWindow).__sameMap()), true);
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 1);

      await page.evaluate(() => (window as AppWindow).__unmount());
      await page.waitForFunction(() => (window as AppWindow).__proof.removed === 1);
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 0);
      assert.deepEqual(pageErrors, []);
    }),
);
