import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {Page} from 'playwright';
import {PNG} from 'pngjs';
import {createServer as createViteServer, type Plugin} from 'vite';
import {boundaryChoropleth, createStyle, type TileflowBoundaryAreas} from '@tileflow/core';
import {launchTileflowCaptureBrowser} from '../src/browser';
import {extendStreets} from '../../core/test/map-fixture';

/**
 * A React app draws a boundary choropleth that `defineMap` does not declare by passing
 * `boundaryChoropleth()` through `<Map dataOverlays>` and its rows through `useBoundaryFeatureState`.
 *
 * The map config declares only `boundaryAreas`. The style is the real `createStyle` output; only
 * the sources and layers that need the network (the Streets vector tiles) are stripped, and the
 * Boundaries source is served from a local MVT generated from two polygons.
 */

type AppWindow = typeof window & {
  __map: MapLibreMap;
  __proof: {diagnostics: string[]};
  __setRates: (rates: {key: number | string; value: number}[] | null) => void;
};

const preparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

// Two municipalities either side of lon 0, lat -0.1..0.1.
const areas = [
  {id: 1, ref: 'ES:INE:00001', ring: [-0.2, -0.1, 0, 0.1]},
  {id: 2, ref: 'ES:INE:00002', ring: [0, -0.1, 0.2, 0.1]},
] as const;

const requireFromMapLibre = createRequire(
  createRequire(import.meta.url).resolve('maplibre-gl/package.json'),
);

function boundariesTilesPlugin(): Plugin {
  const vtPbf = requireFromMapLibre('@maplibre/vt-pbf') as typeof import('@maplibre/vt-pbf');
  const features = areas.map(({id, ref, ring: [w, s, e, n]}) => ({
    geometry: {
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
      type: 'Polygon' as const,
    },
    id,
    properties: {class: 'municipality', class_tier: 'primary', iso_3166_1: 'ES', ref},
    type: 'Feature' as const,
  }));
  const loaded = import(
    pathToFileURL(requireFromMapLibre.resolve('@maplibre/geojson-vt').replace(/\.js$/u, '.mjs'))
      .href
  ).then(({GeoJSONVT}) => new GeoJSONVT({features, type: 'FeatureCollection'}, {maxZoom: 12}));
  return {
    name: 'boundaries-tiles',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const index = await loaded;
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/tiles/boundaries/tiles.json') {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              maxzoom: 12,
              minzoom: 0,
              tilejson: '3.0.0',
              tiles: [`http://${request.headers.host}/tiles/boundaries/{z}/{x}/{y}.pbf`],
              vector_layers: [{fields: {}, id: 'boundary_area'}],
            }),
          );
          return;
        }
        const match = /^\/tiles\/boundaries\/(\d+)\/(\d+)\/(\d+)\.pbf$/u.exec(url.pathname);
        if (!match) return next();
        const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
        const tile = index.getTile(z, x, y);
        response.setHeader('content-type', 'application/x-protobuf');
        response.end(
          Buffer.from(
            tile ? vtPbf.fromGeojsonVt({boundary_area: tile}, {version: 2}) : new Uint8Array(),
          ),
        );
      });
    },
  };
}

function compileStyle(boundaryAreas: TileflowBoundaryAreas) {
  // No `overlays`: the map config does not declare the choropleth.
  return createStyle(extendStreets({boundaryAreas}), {preparedAssets});
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

async function pixelAt(page: Page, lngLat: [number, number]) {
  const point = await page.evaluate((target) => {
    const {x, y} = (window as AppWindow).__map.project(target);
    return {x, y};
  }, lngLat);
  const frame = page.locator('[data-tileflow-capture-id="choropleth"]');
  const box = await frame.boundingBox();
  assert.ok(box);
  const png = PNG.sync.read(await page.screenshot());
  const x = Math.round(box.x + point.x);
  const y = Math.round(box.y + point.y);
  const index = (png.width * y + x) * 4;
  return [png.data[index]!, png.data[index + 1]!, png.data[index + 2]!] as const;
}

// Fill opacity is 0.8 over the white (#ffffff) background.
const over = (hex: string) => {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return channels.map((channel) => Math.round(channel * 0.8 + 255 * 0.2));
};
const near = (actual: readonly number[], expected: readonly number[], message: string) => {
  for (const [index, value] of expected.entries()) {
    assert.ok(
      Math.abs(actual[index]! - value) <= 3,
      `${message}: got ${actual} expected ${expected}`,
    );
  }
};

for (const promoteId of [undefined, 'ref'] as const) {
  test(
    `React draws an undeclared boundary choropleth through dataOverlays (promoteId: ${promoteId ?? 'none'})`,
    {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 120_000},
    async () => {
      // Q1: a compiled map that declares only `boundaryAreas` carries the Boundaries source.
      const compiled = compileStyle({
        family: 'boundaries',
        ...(promoteId ? {promoteId} : {}),
        url: '/tiles/boundaries/tiles.json',
      });
      const boundariesSource = compiled.sources['tileflow-boundaries'];
      assert.ok(boundariesSource, 'compiled style has the Boundaries source without an overlay');
      assert.equal(
        (compiled.layers as {source?: string}[]).filter(
          ({source}) => source === 'tileflow-boundaries',
        ).length,
        0,
        'no layer draws from it yet',
      );

      const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
      const cwd = await mkdtemp(join(root, '.tileflow-test-react-boundary-choropleth-'));
      const reactSource = fileURLToPath(new URL('../../react/src/index.ts', import.meta.url));
      let browser: Awaited<ReturnType<typeof launchTileflowCaptureBrowser>> | undefined;
      let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
      try {
        await symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
        // Keep the real compiler output; drop only what needs the network.
        const layers = (compiled.layers as {id: string; source?: string}[]).filter(
          ({id, source}) => id === 'tileflow-background' || source === undefined,
        );
        const {sprite: _sprite, ...withoutSprite} = compiled as typeof compiled & {sprite?: string};
        const style = {
          ...withoutSprite,
          layers: [
            {id: 'background', paint: {'background-color': '#ffffff'}, type: 'background'},
            ...layers.filter(({id}) => id !== 'background' && id !== 'tileflow-background'),
          ],
          sources: {'tileflow-boundaries': boundariesSource},
        };
        const directory = join(cwd, 'public/tileflow-fixture');
        await mkdir(directory, {recursive: true});
        await Promise.all([
          writeFile(
            join(cwd, 'index.html'),
            '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
          ),
          writeFile(join(cwd, 'main.tsx'), applicationSource(promoteId)),
          writeFile(join(directory, 'light.json'), JSON.stringify(style)),
          writeFile(
            join(directory, 'manifest.json'),
            JSON.stringify({
              maps: {
                main: {
                  defaultTheme: 'light',
                  themes: {light: {colorScheme: 'light', fontFaces: [], styleUrl: './light.json'}},
                },
              },
              version: 1,
            }),
          ),
        ]);
        vite = await createViteServer({
          cacheDir: join(cwd, '.vite-cache'),
          configFile: false,
          logLevel: 'silent',
          plugins: [boundariesTilesPlugin()],
          resolve: {alias: {'@tileflow/react': reactSource}},
          root: cwd,
          server: {host: '127.0.0.1', port: 0, watch: null},
        });
        await vite.listen();
        const address = vite.httpServer?.address();
        assert.ok(address && typeof address === 'object');
        const origin = `http://127.0.0.1:${address.port}`;

        browser = await launchTileflowCaptureBrowser({allowInstall: false});
        const page = await browser.newPage({viewport: {height: 480, width: 640}});
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
            errors.push(message.text());
        });
        page.on('response', (response) => {
          if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
        });
        page.on('pageerror', (error) => errors.push(error.message));

        await page.goto(origin, {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(() => Boolean((window as AppWindow).__map));
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-tileflow-capture-id="choropleth"]')
              ?.getAttribute('data-tileflow-state') === 'idle',
        );
        await settled(page);

        // The layer came from dataOverlays, not from the style.
        const state = await page.evaluate(() => {
          const map = (window as AppWindow).__map;
          return {
            diagnostics: (window as AppWindow).__proof.diagnostics,
            fill: map.getLayer('rates-fill') ? true : false,
            layerOverlayMetadata: (
              map.getLayer('rates-fill')?.metadata as Record<string, unknown>
            )?.['tileflow:overlay'],
            promote: (map.getStyle().sources['tileflow-boundaries'] as {promoteId?: unknown})
              .promoteId,
            source: Boolean(map.getSource('tileflow-boundaries')),
          };
        });
        // The style's sources arrive after the first reconcile; that is not reported.
        assert.deepEqual(state.diagnostics, []);
        assert.equal(state.source, true);
        assert.equal(state.fill, true, 'rates-fill exists');
        assert.equal(state.layerOverlayMetadata, 'rates');
        assert.deepEqual(
          state.promote,
          promoteId ? {boundary_area: 'ref', boundary_label: 'ref'} : undefined,
        );

        const rendered = await page.evaluate(
          () => (window as AppWindow).__map.queryRenderedFeatures({layers: ['rates-fill']}).length,
        );
        assert.ok(rendered > 0, `rendered features ${rendered}`);

        const featureState = await page.evaluate(
          ([id]) =>
            (window as AppWindow).__map.getFeatureState({
              id,
              source: 'tileflow-boundaries',
              sourceLayer: 'boundary_area',
            }),
          [promoteId ? areas[0].ref : areas[0].id] as const,
        );
        assert.deepEqual(featureState, {value: 9});

        // Colours follow the rows: 9 -> #fdcc8a, 13 -> #d7301f.
        near(await pixelAt(page, [-0.1, 0]), over('#fdcc8a'), 'area 1 at value 9');
        near(await pixelAt(page, [0.1, 0]), over('#d7301f'), 'area 2 at value 13');

        // New rows recolour the same layer; null clears the colours.
        await page.evaluate(() => (window as AppWindow).__setRates([]));
        await page.evaluate(
          ([a, b]) =>
            (window as AppWindow).__setRates([
              {key: a, value: 13},
              {key: b, value: 5},
            ]),
          [promoteId ? areas[0].ref : areas[0].id, promoteId ? areas[1].ref : areas[1].id] as const,
        );
        await settled(page);
        near(await pixelAt(page, [-0.1, 0]), over('#d7301f'), 'area 1 at value 13');
        near(await pixelAt(page, [0.1, 0]), over('#fef0d9'), 'area 2 at value 5');
        await page.evaluate(() => (window as AppWindow).__setRates(null));
        await settled(page);
        near(
          await pixelAt(page, [-0.1, 0]),
          [255, 255, 255],
          'cleared (missing colour is transparent)',
        );

        assert.deepEqual(errors, []);
      } finally {
        await browser?.close();
        await vite?.close();
        await rm(cwd, {force: true, recursive: true});
      }
    },
  );
}

const applicationSource = (
  promoteId: 'ref' | undefined,
) => `import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {boundaryChoropleth, choroplethScale} from '@tileflow/core';
import {configureTileflowMapLibre, Map, useBoundaryFeatureState} from '@tileflow/react';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});

window.__proof = {diagnostics: []};
const joinBy = ${JSON.stringify(promoteId ?? 'id')};
// Declared in the application, NOT in the map config.
const dataOverlays = {
  rates: boundaryChoropleth({
    classes: ['municipality'],
    id: 'rates',
    missingColor: 'rgba(0, 0, 0, 0)',
    minzoom: 6,
    scale: choroplethScale.step('#fef0d9', [[8, '#fdcc8a'], [10, '#fc8d59'], [12, '#d7301f']]),
  }),
};
const initial = ${promoteId ? `[{key: 'ES:INE:00001', value: 9}, {key: 'ES:INE:00002', value: 13}]` : `[{key: 1, value: 9}, {key: 2, value: 13}]`};

function App() {
  const [map, setMap] = useState(null);
  const [rows, setRows] = useState(initial);
  window.__setRates = setRows;
  const values = useMemo(() => (rows ? {joinBy, rows} : null), [rows]);
  useBoundaryFeatureState(map, values);
  return <div style={{width: 640}}><Map
    captureId="choropleth"
    center={[0, 0]}
    dataOverlays={dataOverlays}
    height={480}
    onInteractionDiagnostic={(diagnostic) => window.__proof.diagnostics.push(diagnostic.message)}
    onLoad={(loaded) => { window.__map = loaded; setMap(loaded); }}
    source={{map: 'main', manifestUrl: '/tileflow-fixture/manifest.json'}}
    zoom={8}
  /></div>;
}

const sheet = document.createElement('style');
sheet.textContent = 'html,body,#root{margin:0;width:100%;min-height:100%}';
document.head.append(sheet);
createRoot(document.getElementById('root')).render(<App />);
`;
