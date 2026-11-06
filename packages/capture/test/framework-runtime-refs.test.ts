import {svelte} from '@sveltejs/vite-plugin-svelte';
import vue from '@vitejs/plugin-vue';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {Route} from 'playwright';
import {PNG} from 'pngjs';
import {withFrameworkVitePage} from './framework-vite-harness';

const common = `
import 'maplibre-gl/dist/maplibre-gl.css';
const style = document.createElement('style'); style.textContent = 'html,body,#root {margin:0;width:100%;height:100%}'; document.head.append(style);
const initialSource = {map:'main',manifestUrl:'/tileflow-fixture/initial.json'};
const attribution = new URLSearchParams(location.search).get('attribution');
const mapOptions = attribution === 'disabled' ? {attributionControl:false}
  : attribution === 'compact' ? {attributionControl:{compact:true,customAttribution:'Additional fixture credit'}} : undefined;
const sourceFor = value => ({map:value === 'other' ? 'other' : 'main',manifestUrl:'/tileflow-fixture/' + (value === 'waiting' ? 'waiting.json' : 'manifest.json')});
function observeMap(map) {
  window.__runtime.maps.push(map);
  const remove = map.remove.bind(map);
  map.remove = () => {
    window.__runtime.cleanups.push({points:!!map.getSource('points'), waiting:!!map.getSource('waiting-data'), red:!!map.getLayer('red'), blue:!!map.getLayer('blue')});
    return remove();
  };
}
window.__runtime = {maps:[],cleanups:[],phase:'initial',themeReady:0};
function observeTheme(event) {if(event.phase==='ready')window.__runtime.themeReady++;}
`;
const worker = `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';`;
const react = `import React,{useRef,useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Map,configureTileflowMapLibre} from '@tileflow/react';
${worker}
${common}
configureTileflowMapLibre({workerUrl});
function App() {
 const ref=useRef(null), [source,setSource]=useState(initialSource),[theme,setTheme]=useState('light'),[shown,setShown]=useState(true);
 useEffect(()=>{Object.assign(window.__runtime,{getRef:()=>ref.current,setTheme,setSource:value=>{window.__runtime.phase=value;setSource(sourceFor(value));},unmount:()=>setShown(false)});},[]);
 return shown ? <Map ref={ref} source={source} theme={theme} themeTransition={{duration:0}} center={[0,0]} zoom={3} height={280} mapOptions={mapOptions} onLoad={observeMap} onThemeChange={observeTheme} /> : null;
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const vueEntry = `import {createApp} from 'vue'; import App from './App.vue'; ${worker} import {configureTileflowMapLibre} from '@tileflow/vue'; configureTileflowMapLibre({workerUrl}); createApp(App).mount('#root');`;
const vueApp = `<script setup>
import {ref,onMounted} from 'vue'; import {TileflowMap} from '@tileflow/vue';
${common}
const map=ref(null),source=ref(initialSource),theme=ref('light'),shown=ref(true);
onMounted(()=>Object.assign(window.__runtime,{getRef:()=>map.value,setTheme:value=>theme.value=value,setSource:value=>{window.__runtime.phase=value;source.value=sourceFor(value);},unmount:()=>shown.value=false}));
</script><template><TileflowMap v-if="shown" ref="map" :source="source" :theme="theme" :theme-transition="{duration:0}" :center="[0,0]" :zoom="3" :height="280" :map-options="mapOptions" @load="observeMap" @theme-change="observeTheme" /></template>`;
const svelteEntry = `import {mount} from 'svelte'; import App from './App.svelte'; ${worker} import {configureTileflowMapLibre} from '@tileflow/svelte'; configureTileflowMapLibre({workerUrl}); mount(App,{target:document.getElementById('root')});`;
const svelteApp = `<script>
import {onMount} from 'svelte'; import {TileflowMap} from '@tileflow/svelte';
${common}
let map,source=initialSource,theme='light',shown=true;
onMount(()=>{Object.assign(window.__runtime,{getRef:()=>map,setTheme:value=>theme=value,setSource:value=>{window.__runtime.phase=value;source=sourceFor(value);},unmount:()=>shown=false});});
</script>{#if shown}<TileflowMap bind:this={map} {source} {theme} themeTransition={{duration:0}} center={[0,0]} zoom={3} height={280} {mapOptions} on:load={event=>observeMap(event.detail)} onThemeChange={observeTheme} />{/if}`;

for (const framework of ['react', 'vue', 'svelte'] as const) {
  const fixture = () => ({
    framework,
    entry: framework === 'react' ? 'main.tsx' : 'main.js',
    plugins: framework === 'vue' ? [vue()] : framework === 'svelte' ? [svelte()] : [],
    files:
      framework === 'react'
        ? {'main.tsx': react}
        : framework === 'vue'
          ? {'main.js': vueEntry, 'App.vue': vueApp}
          : {'main.js': svelteEntry, 'App.svelte': svelteApp},
  });
  test(
    `${framework} runtime ref preserves rendered app layers and retires queued work`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
    async (t) => {
      await withFrameworkVitePage(
        {
          framework,
          entry: framework === 'react' ? 'main.tsx' : 'main.js',
          plugins: framework === 'vue' ? [vue()] : framework === 'svelte' ? [svelte()] : [],
          files:
            framework === 'react'
              ? {'main.tsx': react}
              : framework === 'vue'
                ? {'main.js': vueEntry, 'App.vue': vueApp}
                : {'main.js': svelteEntry, 'App.svelte': svelteApp},
        },
        async (page, origin) => {
          const held: Route[] = [];
          const errors: string[] = [];
          let initialRequested: (route: Route) => void;
          const initialRoute = new Promise<Route>((resolve) => {
            initialRequested = resolve;
          });
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          await page.route('**/tileflow-fixture/initial.json', (route) => {
            held.push(route);
            initialRequested(route);
          });
          await page.route('**/tileflow-fixture/waiting.json', (route) => {
            held.push(route);
          });
          await page.route('**/tileflow-fixture/pending.geojson', (route) => {
            held.push(route);
          });
          try {
            await page.goto(origin, {waitUntil: 'domcontentloaded'});
            await page.waitForFunction(() => Boolean((window as any).__runtime?.getRef?.()));
            await page.evaluate(() => {
              const runtime = (window as any).__runtime;
              runtime.initialDone = false;
              runtime.initial = runtime
                .getRef()
                .addSource('points', {
                  type: 'geojson',
                  data: {
                    type: 'FeatureCollection',
                    features: [
                      {
                        type: 'Feature',
                        id: 1,
                        geometry: {type: 'Point', coordinates: [0, 0]},
                        properties: {},
                      },
                    ],
                  },
                })
                .then(() => (runtime.initialDone = true));
            });
            assert.equal(await page.evaluate(() => (window as any).__runtime.initialDone), false);
            const initial = await initialRoute;
            await initial.fulfill({
              contentType: 'application/json',
              body: await (await fetch(`${origin}/tileflow-fixture/manifest.json`)).text(),
            });
            await page.waitForFunction(
              () =>
                (window as any).__runtime.maps.length === 1 &&
                (window as any).__runtime.initialDone,
            );
            await page.evaluate(async () => {
              const ref = (window as any).__runtime.getRef();
              for (const [id, color] of [
                ['red', '#ff0000'],
                ['blue', '#0000ff'],
              ])
                await ref.addLayer({
                  id,
                  type: 'circle',
                  source: 'points',
                  slot: 'above-roads',
                  paint: {'circle-radius': 36, 'circle-color': color},
                });
            });
            const frame = async (red: boolean) => {
              await page.waitForFunction(
                ({red}) => {
                  const map = (window as any).__runtime.maps.at(-1),
                    hits = map.queryRenderedFeatures(map.project([0, 0]), {
                      layers: ['red', 'blue'],
                    });
                  return map.isStyleLoaded() && hits[0]?.layer.id === (red ? 'red' : 'blue');
                },
                {red},
              );
              const png = PNG.sync.read(await page.locator('.maplibregl-canvas').screenshot());
              const offset =
                (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
              assert.ok(
                red
                  ? png.data[offset]! > 240 && png.data[offset + 2]! < 15
                  : png.data[offset + 2]! > 240 && png.data[offset]! < 15,
                `${framework} center pixel must be ${red ? 'red' : 'blue'}`,
              );
            };
            await frame(false);
            await page.evaluate(() =>
              (window as any).__runtime.getRef().moveLayer('red', {slotIndex: 1}),
            );
            await frame(true);
            await page.evaluate(() =>
              (window as any).__runtime.getRef().moveLayer('red', {belowLayerId: 'blue'}),
            );
            await frame(false);
            await page.evaluate(() =>
              (window as any).__runtime.getRef().moveLayer('red', {aboveLayerId: 'blue'}),
            );
            await frame(true);
            const rejection = await page.evaluate(async () => {
              const runtime = (window as any).__runtime,
                map = runtime.maps.at(-1),
                before = JSON.stringify(map.getStyle());
              try {
                await runtime
                  .getRef()
                  .moveLayer('red', {slot: 'above-labels', belowLayerId: 'blue'});
                return null;
              } catch (error) {
                const e = error as any;
                return {
                  code: e.code,
                  reason: e.context?.reason,
                  rule: e.context?.rule,
                  unchanged: before === JSON.stringify(map.getStyle()),
                };
              }
            });
            assert.deepEqual(rejection, {
              code: 'invalidRequest',
              reason: 'layerPositionConflict',
              rule: 'sameSlot',
              unchanged: true,
            });
            await page.evaluate(() => (window as any).__runtime.setTheme('dark'));
            await page.waitForFunction(() => {
              const r = (window as any).__runtime;
              return r.maps.at(-1).getStyle().name === 'dark' && r.maps.at(-1).isStyleLoaded();
            });
            await frame(true);
            assert.equal(
              await page.evaluate(
                () => !!(window as any).__runtime.maps.at(-1).getSource('points'),
              ),
              true,
            );
            await page.evaluate(() => (window as any).__runtime.setSource('waiting'));
            await page.waitForFunction(() => (window as any).__runtime.cleanups.length === 1);
            await page.evaluate(() => {
              const r = (window as any).__runtime;
              r.cancelled = r
                .getRef()
                .addSource('stale', {
                  type: 'geojson',
                  data: {type: 'FeatureCollection', features: []},
                })
                .then(
                  () => 'resolved',
                  (error: any) => error.code,
                );
              r.setSource('other');
            });
            assert.equal(
              await page.evaluate(() => (window as any).__runtime.cancelled),
              'disposed',
            );
            await page.waitForFunction(() => (window as any).__runtime.maps.length === 2);
            assert.equal(
              await page.evaluate(
                () => !!(window as any).__runtime.maps.at(-1).getSource('points'),
              ),
              false,
            );
            await page.evaluate(async () => {
              const r = (window as any).__runtime,
                ref = r.getRef();
              await ref.addSource('temporary', {
                type: 'geojson',
                data: {type: 'FeatureCollection', features: []},
              });
              await ref.addLayer({id: 'temporary', type: 'circle', source: 'temporary'});
              await ref.removeLayer('temporary');
              await ref.removeSource('temporary');
              if (r.maps.at(-1).getLayer('temporary') || r.maps.at(-1).getSource('temporary'))
                throw new Error('Explicit removal left application resources behind.');
            });
            await page.evaluate(async () => {
              const r = (window as any).__runtime;
              await r.getRef().addSource('waiting-data', {
                type: 'geojson',
                data: '/tileflow-fixture/pending.geojson',
              });
            });
            await page.waitForFunction(
              () => !(window as any).__runtime.maps.at(-1).isStyleLoaded(),
            );
            await page.evaluate(() => {
              const r = (window as any).__runtime;
              r.retained = r.getRef();
              r.unmounted = r.retained
                .addLayer({id: 'pending', type: 'circle', source: 'waiting-data'})
                .then(
                  () => 'resolved',
                  (error: any) => error.code,
                );
              r.unmount();
            });
            assert.equal(
              await page.evaluate(() => (window as any).__runtime.unmounted),
              'disposed',
            );
            await page.waitForFunction(() => (window as any).__runtime.cleanups.length === 2);
            assert.deepEqual(await page.evaluate(() => (window as any).__runtime.cleanups), [
              {points: false, waiting: false, red: false, blue: false},
              {points: false, waiting: false, red: false, blue: false},
            ]);
            assert.equal(
              await page.evaluate(async () => {
                try {
                  await (window as any).__runtime.retained.removeLayer('red');
                  return 'resolved';
                } catch (error) {
                  return (error as any).code;
                }
              }),
              'disposed',
            );
            assert.deepEqual(errors, []);
          } catch (error) {
            t.diagnostic(JSON.stringify({framework, errors}));
            throw error;
          } finally {
            for (const route of held) await route.abort().catch(() => {});
          }
        },
      );
    },
  );

  test(
    `${framework} keeps attribution visible while opening credits and dragging the map`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
    async () => {
      await withFrameworkVitePage(fixture(), async (page, origin) => {
        await page.setViewportSize({width: 260, height: 280});
        const manifest = await (await fetch(`${origin}/tileflow-fixture/manifest.json`)).json();
        await page.route('**/tileflow-fixture/initial.json', (route) =>
          route.fulfill({json: manifest}),
        );
        await page.route('**/tileflow-fixture/style.json', (route) =>
          route.fulfill({json: attributionStyle('light')}),
        );
        await page.route('**/tileflow-fixture/dark.json', (route) =>
          route.fulfill({json: attributionStyle('dark')}),
        );

        for (const mode of ['disabled', 'compact']) {
          await page.goto(`${origin}/?attribution=${mode}`);
          await page.waitForFunction(() => (window as any).__runtime?.maps.length === 1);
          const notice = page.locator('.tileflow-notice');
          await notice.waitFor({state: 'visible'});
          assert.equal(await notice.innerText(), 'Not for navigation');

          const credits = page.locator('.maplibregl-ctrl-attrib-inner');
          const source = credits.getByRole('link', {name: 'North Atlantic chart contributors'});
          await source.waitFor({state: 'visible'});
          if (mode === 'compact')
            assert.match(await credits.innerText(), /Additional fixture credit/u);

          const info = page.getByRole('button', {name: 'Map credits'});
          const details = page.locator('[data-tileflow-attribution-details]');
          const inlineBounds = await credits.boundingBox();
          const noticeBounds = await notice.boundingBox();
          const infoBounds = await info.boundingBox();
          await info.press('Enter');
          assert.equal(await info.getAttribute('aria-expanded'), 'true');
          await details.waitFor({state: 'visible'});
          assert.equal(
            await details.getByRole('link').getAttribute('href'),
            'https://tileflow.dev/copyright',
          );
          assert.deepEqual(await credits.boundingBox(), inlineBounds);
          assert.deepEqual(await notice.boundingBox(), noticeBounds);
          assert.deepEqual(await info.boundingBox(), infoBounds);
          const panelBounds = await details.boundingBox();
          assert.ok(panelBounds && panelBounds.y >= 0);
          assert.ok(noticeBounds && panelBounds.y + panelBounds.height <= noticeBounds.y);

          await page.evaluate(() => {
            const runtime = (window as any).__runtime;
            runtime.maps.at(-1).once('drag', () => (runtime.dragged = true));
          });
          await page.mouse.move(110, 80);
          await page.mouse.down();
          await page.mouse.move(160, 100, {steps: 5});
          await page.mouse.up();
          await page.waitForFunction(() => (window as any).__runtime.dragged);
          assert.equal(await source.isVisible(), true);
          assert.equal(await info.isVisible(), true);

          await info.click();
          assert.equal(await details.isVisible(), false);
          const bounds = await credits.boundingBox();
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 260);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 280);

          await info.click();
          await page.evaluate(() => (window as any).__runtime.setTheme('dark'));
          await details.getByRole('link', {name: 'North Sea chart contributors'}).waitFor();
          assert.equal(await details.getByText('North Atlantic chart contributors').count(), 0);
          await notice.waitFor({state: 'hidden'});
        }
      });
    },
  );
}

function attributionStyle(theme: 'light' | 'dark') {
  const light = theme === 'light';
  const source = light ? 'North Atlantic' : 'North Sea';
  return {
    version: 8,
    name: theme,
    ...(light
      ? {
          metadata: {
            'tileflow:notices': [
              {id: 'nautical-not-for-navigation', sources: ['points'], text: 'Not for navigation'},
            ],
          },
        }
      : {}),
    sources: {
      points: {
        type: 'geojson',
        data: {type: 'FeatureCollection', features: []},
        attribution: `<a href="https://tileflow.dev/copyright">${source} chart contributors</a> | Marine open data contributors`,
      },
    },
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#a9cae2'}},
      {id: 'points', type: 'circle', source: 'points'},
    ],
  };
}
