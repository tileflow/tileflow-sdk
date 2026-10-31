import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'tsup';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'custom 3D tile coverage retains the visible Manhattan foreground under the 25-tile budget',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'tileflow-camera-coverage-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const source = fileURLToPath(
      new URL('../../core/src/camera-tiles-browser.ts', import.meta.url),
    );
    await writeFile(join(directory, 'fixture.ts'), `export * from ${JSON.stringify(source)};`);
    await build({
      entry: {fixture: join(directory, 'fixture.ts')},
      outDir: directory,
      format: ['iife'],
      globalName: 'CameraFixture',
      platform: 'browser',
      dts: false,
      silent: true,
    });
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage({viewport: {width: 1753, height: 1893}});
      await page.setContent('<div id="map"></div>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const require = createRequire(import.meta.url);
      await page.route('https://camera.test/*.mjs', async (route) => {
        const file = new URL(route.request().url()).pathname.slice(1);
        await route.fulfill({
          contentType: 'text/javascript',
          headers: {'Access-Control-Allow-Origin': '*'},
          body: await readFile(require.resolve(`maplibre-gl/dist/${file}`)),
        });
      });
      await page.addScriptTag({
        type: 'module',
        content: `import * as maplibregl from 'https://camera.test/maplibre-gl.mjs';
          maplibregl.setWorkerUrl('https://camera.test/maplibre-gl-worker.mjs');
          window.maplibregl = maplibregl;`,
      });
      await page.waitForFunction('Boolean(window.maplibregl)');
      await page.addScriptTag({
        content: await readFile(join(directory, 'fixture.global.js'), 'utf8'),
      });
      const cases = await page.evaluate(async () => {
        const globals = window as unknown as {
          maplibregl: {Map: typeof MapLibreMap};
          CameraFixture: typeof import('../../core/src/camera-tiles-browser');
        };
        const container = document.getElementById('map')!;
        const results = [];
        for (const [width, height, bearing, pitch] of [
          [1240, 1536, 0, 58.5],
          [1466, 1829, 0, 58.5],
          [1600, 900, 90, 58.5],
          [1240, 1536, 45, 58.5],
          [900, 1600, 180, 75],
          [1240, 1536, 270, 84],
        ] as const) {
          container.style.width = `${width}px`;
          container.style.height = `${height}px`;
          const map = new globals.maplibregl.Map({
            container,
            center: [-74.01325, 40.7118],
            zoom: 15.422,
            pitch,
            bearing,
            maxPitch: 85,
            style: {version: 8, sources: {}, layers: []},
          });
          await new Promise<void>((resolve) => map.once('load', () => resolve()));
          const camera = globals.CameraFixture.createCameraTiles({
            map,
            source: 'absent',
            zoom: 15,
            minzoom: 14,
            maxTiles: 25,
            active: () => true,
            empty: {},
            build: () => ({}),
            release() {},
            changed() {},
          });
          camera.update();
          const selected = new Set(camera.coverage().map(({x, y}) => `${x}/${y}`));
          const missing = new Set<string>();
          // Ground samples exercise the public MapLibre projection, independently of the tile
          // selector's quadrilateral test. No server or mutable World data is required.
          for (let y = height / 2 + 1; y < height; y += height / 32)
            for (let x = 1; x < width; x += width / 32) {
              const point = map.unproject([x, y]);
              const [tx, ty] = globals.CameraFixture.cameraTileAt(point.lng, point.lat, 15);
              const key = `${Math.floor(tx)}/${Math.floor(ty)}`;
              if (!selected.has(key)) missing.add(key);
            }
          const landmark = map.project([-74.01356, 40.70357]);
          results.push({
            width,
            height,
            bearing,
            pitch,
            count: selected.size,
            missing: [...missing],
            customHouse: {
              visible:
                landmark.x >= 0 && landmark.x <= width && landmark.y >= 0 && landmark.y <= height,
              selected: selected.has('9647/12321'),
            },
          });
          camera.dispose();
          map.remove();
        }
        return results;
      });
      for (const sample of cases) {
        assert.equal(sample.count, 25);
        assert.deepEqual(sample.missing, [], JSON.stringify(sample));
        if (sample.bearing === 0) {
          assert.equal(sample.customHouse.visible, true);
          assert.equal(sample.customHouse.selected, true);
        }
      }
    } finally {
      await browser.close();
    }
  },
);
