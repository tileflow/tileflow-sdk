import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import type {Page} from 'playwright';
import {createServer as createViteServer} from 'vite';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {writeDataLayerFixture} from './tileflow-source-fixture';

type Proof = {diagnostics: string[]; events: {kind: string; pointCount?: number; type: string}[]};
type AppWindow = typeof window & {
  __draw: {getSnapshot: () => {geometry: {type: string}}[]; setMode: (mode: string) => void};
  __map: MapLibreMap;
  __proof: Proof;
  __setAnnotated: (value: boolean) => void;
  __setCount: (value: number) => void;
  __setTheme: (value: string) => void;
};

function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as AppWindow).__map;
    return {
      background: map.getPaintProperty('background', 'background-color'),
      clusters: map
        .queryRenderedFeatures({layers: ['stores-clusters']})
        .map((feature) => Number(feature.properties.point_count)),
      layers: map.getLayersOrder().filter((id) => !id.startsWith('td-')),
      zoom: map.getZoom(),
    };
  });
}

const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as AppWindow).__map;
        map.once('idle', () => resolve());
        map.triggerRepaint();
      }),
  );

test(
  'clusters, heatmaps, annotations and a drawing library share one real MapLibre map',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000},
  async () => {
    const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const cwd = await mkdtemp(join(root, '.tileflow-test-react-data-layers-'));
    const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));
    let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

    try {
      await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
      await Promise.all([
        writeFile(
          join(cwd, 'index.html'),
          '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
        ),
        writeFile(join(cwd, 'main.tsx'), applicationSource),
        // Vite lists public files when it starts; the real origin replaces this one below.
        writeDataLayerFixture(cwd, 'http://127.0.0.1'),
      ]);
      vite = await createViteServer({
        cacheDir: join(cwd, '.vite-cache'),
        configFile: false,
        logLevel: 'silent',
        resolve: {alias: {'@tileflow/react': reactSource}},
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
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(origin, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => Boolean((window as AppWindow).__draw));
      const frame = page.locator('[data-tileflow-capture-id="data-layers"]');
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-tileflow-capture-id="data-layers"]')
            ?.getAttribute('data-tileflow-state') === 'idle',
      );
      await settled(page);

      // Semantic placement, drawn data and the map label font, on a real renderer.
      const initial = await mapState(page);
      assert.deepEqual(initial.layers, [
        'background',
        'stores-heat',
        'stores-clusters',
        'stores-cluster-count',
        'stores-points',
        'labels',
      ]);
      assert.equal(Math.max(...initial.clusters), 120);

      // Clicking a bubble zooms to where it splits and reports the cluster.
      const point = await page.evaluate(() => {
        const map = (window as AppWindow).__map;
        const {x, y} = map.project([0, 0]);
        return {x, y};
      });
      const bounds = await frame.boundingBox();
      assert.ok(bounds);
      await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
      await page.waitForFunction(() => (window as AppWindow).__map.getZoom() > 3.5);
      await settled(page);
      const expanded = await mapState(page);
      assert.ok(expanded.zoom > 3.5, `zoom ${expanded.zoom}`);
      assert.ok(Math.max(0, ...expanded.clusters) < 120);
      assert.deepEqual(await proof(page), {
        diagnostics: [],
        events: [{kind: 'cluster', pointCount: 120, type: 'target:activate'}],
      });

      // New application data reaches the same source without losing its layers.
      await page.evaluate(() => {
        const map = (window as AppWindow).__map;
        (window as AppWindow).__setCount(40);
        map.jumpTo({center: [0, 0], zoom: 3});
      });
      await page.waitForFunction(() => {
        const map = (window as AppWindow).__map;
        const counts = map
          .queryRenderedFeatures({layers: ['stores-clusters']})
          .map((feature) => Number(feature.properties.point_count));
        return Math.max(0, ...counts) === 40;
      });

      // A theme swap uses a style diff, which drops whatever the new style does not declare.
      await page.evaluate(() => (window as AppWindow).__setTheme('dark'));
      await page.waitForFunction(
        () =>
          (window as AppWindow).__map.getPaintProperty('background', 'background-color') ===
          '#101820',
      );
      await settled(page);
      const dark = await mapState(page);
      assert.deepEqual(dark.layers, initial.layers);
      assert.equal(Math.max(...dark.clusters), 40);
      assert.deepEqual(
        await page.evaluate(() => (window as AppWindow).__draw.getSnapshot().length),
        0,
      );

      // A polygon drawn through the documented Terra Draw integration, on the swapped style.
      await page.evaluate(() => (window as AppWindow).__draw.setMode('polygon'));
      for (const [x, y] of [
        [80, 80],
        [240, 80],
        [240, 200],
        [80, 200],
        [80, 80],
      ] as const) {
        await page.mouse.move(bounds.x + x, bounds.y + y);
        await page.mouse.click(bounds.x + x, bounds.y + y);
      }
      await page.evaluate(() => (window as AppWindow).__draw.setMode('static'));
      const drawn = await page.evaluate(() =>
        (window as AppWindow).__draw.getSnapshot().filter((f) => f.geometry.type === 'Polygon'),
      );
      assert.equal(drawn.length, 1);

      // The drawing survives the next theme swap through `mapOptions.transformStyle`.
      await page.evaluate(() => (window as AppWindow).__setTheme('light'));
      await page.waitForFunction(
        () =>
          (window as AppWindow).__map.getPaintProperty('background', 'background-color') ===
          '#dfe7ef',
      );
      await settled(page);
      assert.ok(
        await page.evaluate(() =>
          (window as AppWindow).__map.getLayersOrder().some((id) => id.startsWith('td-')),
        ),
      );
      assert.ok(
        await page.evaluate(() => {
          const map = (window as AppWindow).__map;
          return map.queryRenderedFeatures({
            layers: map.getLayersOrder().filter((id) => id.startsWith('td-polygon')),
          }).length;
        }),
      );

      // Clustered annotations are real buttons that a keyboard can expand.
      await page.evaluate(() => (window as AppWindow).__setAnnotated(true));
      const cluster = page.locator('.tileflow-interaction-cluster');
      await cluster.waitFor({state: 'visible'});
      assert.equal(await cluster.getAttribute('aria-label'), '3 places');
      assert.equal(await page.locator('.tileflow-interaction-marker:visible').count(), 0);
      await cluster.focus();
      await page.keyboard.press('Enter');
      await page.locator('.tileflow-interaction-marker:visible').first().waitFor();
      assert.equal(
        await page.locator('.tileflow-interaction-cluster[aria-label="3 places"]').count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.className),
        'maplibregl-canvas',
      );
      assert.equal((await proof(page)).events.at(-1)?.kind, 'cluster');
      assert.deepEqual((await proof(page)).diagnostics, []);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await vite?.close();
      await rm(cwd, {force: true, recursive: true});
    }
  },
);

const proof = (page: Page) => page.evaluate(() => (window as AppWindow).__proof);

const applicationSource = `import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {TerraDraw, TerraDrawPolygonMode} from 'terra-draw';
import {TerraDrawMapLibreGLAdapter} from 'terra-draw-maplibre-gl-adapter';
import {clusterOverlay, geojsonSource, heatmapOverlay} from '@tileflow/core/runtime';
import {configureTileflowMapLibre, Map} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});

const proof = window.__proof = {diagnostics: [], events: []};
const dataOverlays = {
  stores: clusterOverlay({id: 'stores', placement: 'below-labels', source: 'stores'}),
  heat: heatmapOverlay({id: 'stores-heat', placement: 'below-labels', source: 'stores'}),
};
const points = (count) => ({
  type: 'FeatureCollection',
  features: Array.from({length: count}, (_, index) => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [(index % 10) * 0.3 - 1.35, Math.floor(index / 10) * 0.3 - 1.8]},
    properties: {},
  })),
});
const annotated = [
  {kind: 'marker', id: 'a', ariaLabel: 'A', coordinate: [20, 20]},
  {kind: 'marker', id: 'b', ariaLabel: 'B', coordinate: [20.01, 20.01]},
  {kind: 'marker', id: 'c', ariaLabel: 'C', coordinate: [20.02, 20]},
];
const annotationClusters = {};
// Keeps what the application added when a theme swap replaces the style.
const mapOptions = {
  transformStyle(previous, next) {
    if (!previous) return next;
    const layers = previous.layers.filter(({id}) => id.startsWith('td-'));
    const sources = Object.fromEntries(
      Object.entries(previous.sources).filter(([id]) => id.startsWith('td-')),
    );
    return {...next, layers: [...next.layers, ...layers], sources: {...next.sources, ...sources}};
  },
};

function App() {
  const [count, setCount] = useState(120);
  const [theme, setTheme] = useState('light');
  const [annotations, setAnnotations] = useState(undefined);
  window.__setCount = setCount;
  window.__setTheme = setTheme;
  window.__setAnnotated = (value) => {
    if (!value) return setAnnotations(undefined);
    setAnnotations(annotated);
    window.__map.jumpTo({center: [20, 20], zoom: 4});
  };
  const dataSources = useMemo(
    () => ({stores: geojsonSource({cluster: true, clusterRadius: 60, data: points(count)})}),
    [count],
  );
  return <div style={{width: 640}}><Map
    annotationClusters={annotations && annotationClusters}
    annotations={annotations}
    captureId="data-layers"
    center={[0, 0]}
    dataOverlays={dataOverlays}
    dataSources={dataSources}
    height={480}
    mapOptions={mapOptions}
    onInteractionDiagnostic={(diagnostic) => proof.diagnostics.push(diagnostic.message)}
    onInteractionEvent={({target, type}) => proof.events.push({
      kind: target.kind,
      ...(target.kind === 'cluster' ? {pointCount: target.pointCount} : {}),
      type,
    })}
    onLoad={(map) => {
      window.__map = map;
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({map}),
        modes: [new TerraDrawPolygonMode()],
      });
      draw.start();
      window.__draw = draw;
    }}
    source={{map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'}}
    theme={theme}
    zoom={3}
  /></div>;
}

const sheet = document.createElement('style');
sheet.textContent = 'html,body,#root{margin:0;width:100%;min-height:100%}';
document.head.append(sheet);
createRoot(document.getElementById('root')).render(<App />);
`;
