import {svelte} from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import test from 'node:test';
import {verifyFrameworkViteCapture} from './framework-vite-harness';

test(
  'captures the public Vue adapter in interactive and image modes and proves cleanup',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () =>
    verifyFrameworkViteCapture({
      entry: 'main.ts',
      files: {
        'App.vue': vueApplicationSource,
        'main.ts': vueEntrySource,
      },
      framework: 'vue',
      plugins: [vue()],
      popupProbeRgb: [0, 255, 136],
    }),
);

test(
  'captures the public Svelte adapter in interactive and image modes and proves cleanup',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async () =>
    verifyFrameworkViteCapture({
      entry: 'main.js',
      files: {
        'App.svelte': svelteApplicationSource,
        'main.js': svelteEntrySource,
      },
      framework: 'svelte',
      plugins: [svelte()],
      popupProbeRgb: [255, 102, 0],
    }),
);

const imageUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4WSz2H4QZYAwAWswKBc9NlmIAAAAASUVORK5CYII=';

const vueEntrySource = `import {createApp} from 'vue';
import App from './App.vue';
createApp(App).mount('#root');
`;

const vueApplicationSource = `<script setup lang="ts">
import {nextTick, ref} from 'vue';
import {TileflowMap} from '@tileflow/vue';
import type {Map as MapLibreMap} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const cleanupState = ref('loading');
const showProbe = ref(true);
const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};
const annotations = [{
  ariaLabel: 'Vue browser popup proof',
  coordinate: [0, 0],
  id: 'vue-browser-popup',
  kind: 'marker',
  popup: {content: {kind: 'view', name: 'browser-popup-proof'}}
}];
const defaultInteractionState = {popup: {id: 'vue-browser-popup', kind: 'annotation'}};

function onProbeLoad(map: MapLibreMap) {
  const remove = map.remove.bind(map);
  map.remove = () => {
    const result = remove();
    cleanupState.value = 'idle';
    return result;
  };
  void nextTick(() => {
    showProbe.value = false;
  });
}
</script>

<template>
  <main>
    <div style="width: 260px">
      <TileflowMap
        :annotations="annotations"
        capture-id="interactive"
        :default-interaction-state="defaultInteractionState"
        :height="180"
        :source="{kind: 'maplibre', style}"
      >
        <template #popup="{target}">
          <div class="popup-probe" data-tileflow-popup-probe="vue">
            Tileflow Vue popup ready: {{ target.kind }}
          </div>
        </template>
      </TileflowMap>
    </div>
    <div style="width: 150px"><TileflowMap capture-id="image" :height="80" image-url="${imageUrl}" mode="image" :source="{kind: 'tileflow', map: 'main'}" /></div>
    <div style="width: 150px"><TileflowMap capture-id="missing-map" :height="80" :source="{kind: 'tileflow', map: 'missing'}" /></div>
    <div style="width: 150px"><TileflowMap capture-id="unresolved-image" :height="80" mode="image" :source="{kind: 'maplibre', style}" /></div>
    <div id="cleanup-proof" :data-tileflow-state="cleanupState" style="display: block; height: 16px; width: 16px"></div>
    <div v-if="showProbe" class="probe"><TileflowMap :height="64" :source="{kind: 'maplibre', style}" @load="onProbeLoad" /></div>
  </main>
</template>

<style>
html, body, #root { margin: 0; width: 100%; min-height: 100%; }
.popup-probe { background: #00ff88; box-sizing: border-box; color: #111; font: 11px/16px sans-serif; height: 40px; padding: 12px 8px; white-space: nowrap; width: 168px; }
.probe { height: 64px; left: -10000px; position: fixed; top: 0; width: 64px; }
</style>
`;

const svelteEntrySource = `import {mount} from 'svelte';
import App from './App.svelte';
mount(App, {target: document.getElementById('root')});
`;

const svelteApplicationSource = `<script>
  import {TileflowMap} from '@tileflow/svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';

  let cleanupState = 'loading';
  let showProbe = true;
  const style = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#2468ac'}}]};
  const annotations = [{
    ariaLabel: 'Svelte browser popup proof',
    coordinate: [0, 0],
    id: 'svelte-browser-popup',
    kind: 'marker',
    popup: {content: {kind: 'view', name: 'browser-popup-proof'}}
  }];
  const defaultInteractionState = {popup: {id: 'svelte-browser-popup', kind: 'annotation'}};

  function onProbeLoad(event) {
    const map = event.detail;
    const remove = map.remove.bind(map);
    map.remove = () => {
      const result = remove();
      cleanupState = 'idle';
      return result;
    };
    requestAnimationFrame(() => {
      showProbe = false;
    });
  }
</script>

{#snippet popup(context)}
  <div class="popup-probe" data-tileflow-popup-probe="svelte">
    Tileflow Svelte popup ready: {context.target.kind}
  </div>
{/snippet}

<main>
  <div style="width: 260px"><TileflowMap {annotations} captureId="interactive" {defaultInteractionState} height={180} {popup} source={{kind: 'maplibre', style}} /></div>
  <div style="width: 150px"><TileflowMap captureId="image" height={80} imageUrl="${imageUrl}" mode="image" source={{kind: 'tileflow', map: 'main'}} /></div>
  <div style="width: 150px"><TileflowMap captureId="missing-map" height={80} source={{kind: 'tileflow', map: 'missing'}} /></div>
  <div style="width: 150px"><TileflowMap captureId="unresolved-image" height={80} mode="image" source={{kind: 'maplibre', style}} /></div>
  <div id="cleanup-proof" data-tileflow-state={cleanupState} style="display: block; height: 16px; width: 16px"></div>
  {#if showProbe}
    <div class="probe"><TileflowMap height={64} source={{kind: 'maplibre', style}} on:load={onProbeLoad} /></div>
  {/if}
</main>

<style>
  :global(html), :global(body), :global(#root) { margin: 0; width: 100%; min-height: 100%; }
  .popup-probe { background: #ff6600; box-sizing: border-box; color: #111; font: 11px/16px sans-serif; height: 40px; padding: 12px 8px; white-space: nowrap; width: 168px; }
  .probe { height: 64px; left: -10000px; position: fixed; top: 0; width: 64px; }
</style>
`;
