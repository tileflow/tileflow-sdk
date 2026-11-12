import type {Map as MapLibreMap} from 'maplibre-gl';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {Page} from 'playwright';
import {PNG} from 'pngjs';
import type {TileflowMap} from '@tileflow/core/maplibre';
import {withMapApp} from './map-app-harness';

type Creation = {status: 'pending' | 'mounted'} | {status: 'rejected'; name: string};
type AppWindow = typeof window & {
  __ready: boolean;
  __handles: Record<string, TileflowMap>;
  __maps: Record<string, MapLibreMap>;
  __loaded: Record<string, MapLibreMap>;
  __states: Record<string, string>;
  __creations: Record<string, Creation>;
  __removed: Record<string, number>;
  __errors: {code: string; message: string}[];
  __start: (
    id: string,
    options?: {manifestUrl?: string; preaborted?: boolean; theme?: 'system'},
  ) => void;
  __abort: (id: string) => void;
};

// This application imports only the public JavaScript entry and MapLibre's stylesheet/worker.
// Creating maps is explicit so each test can observe or delay requests before mounting.
const app = `import {configureTileflowMapLibre, createTileflowMap} from '@tileflow/core/maplibre';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

configureTileflowMapLibre({workerUrl});
document.body.style.margin = '0';
document.getElementById('root').style.display = 'flex';
window.__handles = {};
window.__maps = {};
window.__loaded = {};
window.__states = {};
window.__creations = {};
window.__removed = {};
window.__errors = [];
const controllers = {};
window.__abort = (id) => controllers[id].abort();
window.__start = (id, options = {}) => {
  const container = document.createElement('div');
  container.id = id;
  container.style.cssText = 'height:240px;width:320px;flex:none';
  document.getElementById('root').append(container);
  const controller = new AbortController();
  controllers[id] = controller;
  if (options.preaborted) controller.abort();
  window.__creations[id] = {status: 'pending'};
  void createTileflowMap({
    container,
    source: {map: 'main', manifestUrl: options.manifestUrl ?? '/tileflow-fixture/manifest.json'},
    center: [0, 0],
    zoom: 3,
    signal: controller.signal,
    theme: options.theme,
    navigationControl: true,
    onError: ({code, error}) => window.__errors.push({code, message: error.message}),
    onLoad: (map) => { window.__loaded[id] = map; },
    onState: (state) => { window.__states[id] = state; },
  }).then((handle) => {
    window.__handles[id] = handle;
    const map = handle.getMap();
    window.__maps[id] = map;
    window.__removed[id] = 0;
    map.on('remove', () => { window.__removed[id] += 1; });
    window.__creations[id] = {status: 'mounted'};
  }).catch((error) => {
    window.__creations[id] = {status: 'rejected', name: error.name};
  });
};
window.__ready = true;
`;

const browserTest = {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 90_000};

async function waitForMap(page: Page, id: string) {
  await page.waitForFunction((key) => {
    const app = window as AppWindow;
    return (
      app.__creations[key]?.status === 'mounted' &&
      app.__loaded[key] &&
      app.__states[key] === 'idle'
    );
  }, id);
}

async function assertCanvasCenter(page: Page, id: string, expected: readonly number[]) {
  const png = PNG.sync.read(await page.locator(`#${id} canvas.maplibregl-canvas`).screenshot());
  const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  const actual = [...png.data.subarray(offset, offset + 4)];
  assert.ok(
    expected.every((channel, index) => Math.abs(actual[index]! - channel) <= 1),
    `${id} canvas center: expected ${expected.join(',')}, got ${actual.join(',')}`,
  );
}

test('JavaScript maps render, expose MapLibre and keep independent lifetimes', browserTest, () =>
  withMapApp('javascript', app, async (open) => {
    const {page, pageErrors, consoleErrors} = await open();
    await page.waitForFunction(() => (window as AppWindow).__ready);
    await page.evaluate(() => {
      const app = window as AppWindow;
      app.__start('first');
      app.__start('second');
    });
    await waitForMap(page, 'first');
    await waitForMap(page, 'second');
    await assertCanvasCenter(page, 'first', [223, 231, 239, 255]);
    await assertCanvasCenter(page, 'second', [223, 231, 239, 255]);

    assert.equal(
      await page.evaluate(() => {
        const app = window as AppWindow;
        return app.__handles.first!.getMap() === app.__loaded.first;
      }),
      true,
    );

    // Removing one map must not retire the other's controller or renderer.
    assert.deepEqual(
      await page.evaluate(() => {
        const app = window as AppWindow;
        app.__handles.first!.dispose();
        app.__handles.first!.dispose();
        return {
          map: app.__handles.first!.getMap(),
          controller: app.__handles.first!.getThemeController(),
          removed: app.__removed.first,
          secondAlive: app.__handles.second!.getMap() === app.__maps.second,
        };
      }),
      {map: null, controller: null, removed: 1, secondAlive: true},
    );
    assert.equal(await page.locator('#first canvas').count(), 0);

    assert.deepEqual(
      await page.evaluate(async () => {
        const app = window as AppWindow;
        const handle = app.__handles.second!;
        const result = await handle.setTheme('dark', {transition: {duration: 0}});
        // Applying a style does not imply MapLibre has drawn its next frame yet.
        await new Promise<void>((resolve) => {
          handle.getMap()!.once('idle', () => resolve());
          handle.getMap()!.triggerRepaint();
        });
        return {
          status: result.status,
          sameMap: handle.getMap() === app.__maps.second,
          theme: handle.getThemeController()?.getCurrent().theme,
        };
      }),
      {status: 'applied', sameMap: true, theme: 'dark'},
    );
    await waitForMap(page, 'second');
    await assertCanvasCenter(page, 'second', [16, 24, 32, 255]);

    // Application-owned sources and layers use the very MapLibre instance Tileflow renders.
    await page.evaluate(() => {
      const map = (window as AppWindow).__handles.second!.getMap()!;
      map.addSource('application-point', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {owner: 'application'},
          geometry: {type: 'Point', coordinates: [0, 0]},
        },
      });
      map.addLayer({
        id: 'application-circle',
        source: 'application-point',
        type: 'circle',
        paint: {'circle-color': '#ff0000', 'circle-radius': 30},
      });
    });
    await page.waitForFunction(() => {
      const map = (window as AppWindow).__handles.second!.getMap();
      return (
        map?.queryRenderedFeatures({layers: ['application-circle']})[0]?.properties.owner ===
        'application'
      );
    });
    await assertCanvasCenter(page, 'second', [255, 0, 0, 255]);

    assert.deepEqual(
      await page.evaluate(() => {
        const app = window as AppWindow;
        app.__abort('second');
        app.__handles.second!.dispose();
        return {map: app.__handles.second!.getMap(), removed: app.__removed.second};
      }),
      {map: null, removed: 1},
    );
    assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 0);
    assert.deepEqual(await page.evaluate(() => (window as AppWindow).__errors), []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(
      consoleErrors.filter((message) => message.includes('Tileflow')),
      [],
    );
  }),
);

async function systemThemes(page: Page) {
  await page.route('**/tileflow-fixture/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.maps.main.systemThemes = {light: 'light', dark: 'dark'};
    manifest.maps.main.themes.broken = {
      colorScheme: 'light',
      fontFaces: [],
      styleUrl: './broken.json',
    };
    await route.fulfill({json: manifest});
  });
}

async function holdStyle(page: Page, theme: string) {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  let release!: () => Promise<void>;
  await page.route(
    `**/tileflow-fixture/${theme}.json`,
    async (route) => {
      const response = await route.fetch();
      release = () => route.fulfill({response});
      markHeld();
    },
    {times: 1},
  );
  return {held, release: () => release()};
}

test('an invalid theme does not lose a pending valid system selection', browserTest, () =>
  withMapApp('javascript', app, async (open) => {
    const {page, pageErrors} = await open();
    await page.waitForFunction(() => (window as AppWindow).__ready);
    await page.emulateMedia({colorScheme: 'light'});
    await systemThemes(page);
    await page.evaluate(() => (window as AppWindow).__start('system'));
    await waitForMap(page, 'system');
    await page.emulateMedia({colorScheme: 'dark'});
    const delayed = await holdStyle(page, 'dark');
    const pending = page.evaluate(() =>
      (window as AppWindow).__handles.system!.setTheme('system', {transition: {duration: 0}}),
    );
    await delayed.held;
    assert.equal(
      await page.evaluate(
        async () => (await (window as AppWindow).__handles.system!.setTheme('missing')).status,
      ),
      'failed',
    );
    await delayed.release();
    assert.equal((await pending).status, 'applied');
    await page.emulateMedia({colorScheme: 'light'});
    await page.waitForFunction(
      () =>
        (window as AppWindow).__handles.system!.getThemeController()!.getCurrent().theme ===
        'light',
    );
    await page.evaluate(() => (window as AppWindow).__handles.system!.dispose());
    assert.deepEqual(
      await page.evaluate(() => (window as AppWindow).__errors.map(({code}) => code)),
      ['theme'],
    );
    assert.deepEqual(pageErrors, []);
  }),
);

test('JavaScript system theme catches changes while the initial style loads', browserTest, () =>
  withMapApp('javascript', app, async (open) => {
    const {page, pageErrors} = await open();
    await page.waitForFunction(() => (window as AppWindow).__ready);
    await page.emulateMedia({colorScheme: 'light'});
    await systemThemes(page);
    const delayed = await holdStyle(page, 'light');
    await page.evaluate(() => (window as AppWindow).__start('system', {theme: 'system'}));
    await delayed.held;
    await page.emulateMedia({colorScheme: 'dark'});
    await delayed.release();
    await waitForMap(page, 'system');
    await page.waitForFunction(
      () =>
        (window as AppWindow).__handles.system?.getThemeController()?.getCurrent().theme === 'dark',
    );
    await page.evaluate(() => (window as AppWindow).__handles.system!.dispose());
    assert.deepEqual(await page.evaluate(() => (window as AppWindow).__errors), []);
    assert.deepEqual(pageErrors, []);
  }),
);

test(
  'failed overlapping theme changes preserve the last confirmed system selection',
  browserTest,
  () =>
    withMapApp('javascript', app, async (open) => {
      const {page, pageErrors} = await open();
      await page.waitForFunction(() => (window as AppWindow).__ready);
      await page.emulateMedia({colorScheme: 'light'});
      await systemThemes(page);
      await page.route('**/tileflow-fixture/broken.json', (route) =>
        route.fulfill({status: 503, body: 'Unavailable'}),
      );
      await page.evaluate(() => (window as AppWindow).__start('system', {theme: 'system'}));
      await waitForMap(page, 'system');
      const delayed = await holdStyle(page, 'dark');
      // Keep the first request pending while the second request supersedes it and fails.
      const pending = page.evaluate(() =>
        (window as AppWindow).__handles.system!.setTheme('dark', {transition: {duration: 0}}),
      );
      await delayed.held;
      assert.equal(
        await page.evaluate(
          async () => (await (window as AppWindow).__handles.system!.setTheme('broken')).status,
        ),
        'failed',
      );
      await delayed.release();
      assert.equal((await pending).status, 'superseded');
      assert.equal(
        await page.evaluate(
          () => (window as AppWindow).__handles.system!.getThemeController()!.getCurrent().theme,
        ),
        'light',
      );
      await page.emulateMedia({colorScheme: 'dark'});
      await page.waitForFunction(
        () =>
          (window as AppWindow).__handles.system!.getThemeController()!.getCurrent().theme ===
          'dark',
      );
      await page.evaluate(() => (window as AppWindow).__handles.system!.dispose());
      assert.deepEqual(
        await page.evaluate(() => (window as AppWindow).__errors.map(({code}) => code)),
        ['theme'],
      );
      assert.deepEqual(pageErrors, []);
    }),
);

test(
  'JavaScript creation honors pre-abort and abort while its manifest is pending',
  browserTest,
  () =>
    withMapApp('javascript', app, async (open) => {
      const {page, pageErrors, consoleErrors} = await open();
      await page.waitForFunction(() => (window as AppWindow).__ready);
      const manifestRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/manifest.json'))
          manifestRequests.push(request.url());
      });
      await page.evaluate(() => (window as AppWindow).__start('preaborted', {preaborted: true}));
      await page.waitForFunction(
        () => (window as AppWindow).__creations.preaborted?.status === 'rejected',
      );
      assert.deepEqual(await page.evaluate(() => (window as AppWindow).__creations.preaborted), {
        status: 'rejected',
        name: 'AbortError',
      });
      assert.deepEqual(manifestRequests, []);
      assert.equal(await page.locator('#preaborted canvas').count(), 0);

      let markHeld!: () => void;
      const held = new Promise<void>((resolve) => {
        markHeld = resolve;
      });
      let release!: () => Promise<void>;
      await page.route('**/tileflow-fixture/manifest.json?pending=1', async (route) => {
        const response = await route.fetch();
        release = () => route.fulfill({response});
        markHeld();
      });
      await page.evaluate(() =>
        (window as AppWindow).__start('pending', {
          manifestUrl: '/tileflow-fixture/manifest.json?pending=1',
        }),
      );
      await held;
      await page.evaluate(() => (window as AppWindow).__abort('pending'));
      await page.waitForFunction(
        () => (window as AppWindow).__creations.pending?.status === 'rejected',
      );
      // Even when the delayed response arrives, the canceled creation cannot install a map.
      await release();
      assert.deepEqual(await page.evaluate(() => (window as AppWindow).__creations.pending), {
        status: 'rejected',
        name: 'AbortError',
      });
      assert.equal(await page.locator('#pending canvas').count(), 0);
      assert.equal(
        await page.evaluate(() => Boolean((window as AppWindow).__loaded.pending)),
        false,
      );

      // Cancellation leaves the shared loader usable for the next map on the same page.
      await page.evaluate(() => (window as AppWindow).__start('after-cancel'));
      await waitForMap(page, 'after-cancel');
      assert.deepEqual(
        await page.evaluate(() => {
          const handle = (window as AppWindow).__handles['after-cancel']!;
          handle.getMap()!.remove();
          handle.dispose();
          return {map: handle.getMap(), controller: handle.getThemeController()};
        }),
        {map: null, controller: null},
      );
      assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 0);
      assert.deepEqual(await page.evaluate(() => (window as AppWindow).__errors), []);
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(
        consoleErrors.filter((message) => message.includes('Tileflow')),
        [],
      );
    }),
);
