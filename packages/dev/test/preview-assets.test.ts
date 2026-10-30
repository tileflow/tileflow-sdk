import assert from 'node:assert/strict';
import test from 'node:test';
import {getTileflowPreviewRuntimeResponse} from '../src/preview-assets';
import {renderTileflowPreviewHtml} from '../src/preview-html';

test('serves the exact MapLibre v6 module closure to Preview', async () => {
  const main = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl.mjs');
  const worker = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl-worker.mjs');
  const stylesheet = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl.css');

  assert.ok(main);
  assert.ok(worker);
  assert.ok(stylesheet);
  assert.match(main.headers.get('content-type') ?? '', /javascript/u);
  // Since GL JS 6.13 the main module holds what the shared one did and names only its worker; the
  // shared module ships empty and is not served.
  assert.match(await main.text(), /maplibre-gl-worker\.mjs/u);
  assert.equal(getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl-shared.mjs'), undefined);
  assert.match(worker.headers.get('content-type') ?? '', /javascript/u);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/u);
  assert.equal(getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl.js'), undefined);
  assert.equal(
    getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl-untrusted.mjs'),
    undefined,
  );
});

test('imports Preview MapLibre as a module and pins its matching worker', () => {
  const html = renderTileflowPreviewHtml(undefined, '/tileflow', {}, false);

  assert.match(html, /import \* as maplibregl from "\/tileflow\/__runtime\/maplibre-gl\.mjs"/u);
  assert.match(
    html,
    /maplibregl\.setWorkerUrl\("\/tileflow\/__runtime\/maplibre-gl-worker\.mjs"\)/u,
  );
  assert.doesNotMatch(html, /maplibre-gl\.js/u);
});

test('offers a theme switch in standalone previews, not the Inspector iframe', () => {
  const camera = {type: 'center', center: [0, 0], zoom: 2, bearing: 0, pitch: 0} as const;
  const single = renderTileflowPreviewHtml(
    {camera, label: 'map / light', mapName: 'map', themeName: 'light', themeNames: ['light']},
    '/tileflow',
    {},
    true,
  );
  const several = renderTileflowPreviewHtml(
    {
      camera,
      label: 'map / night',
      mapName: 'map',
      themeName: 'night',
      themeNames: ['light', 'night'],
    },
    '/tileflow',
    {},
    true,
  );

  assert.match(single, /const previewThemes = \["light"\];/u);
  assert.match(several, /const previewTheme = "night";/u);
  assert.match(several, /const previewThemes = \["light","night"\];/u);
  assert.match(
    several,
    /if \(previewThemes\.length > 1 && window\.parent === window\) map\.addControl\(new ThemeControl\(\)/u,
  );
  assert.match(single, /if \(previewThemes\.length > 1 && window\.parent === window\)/u);
});

test('preview delegates atmosphere to the shared runtime without overriding its rendering', async () => {
  const html = renderTileflowPreviewHtml(undefined, '/tileflow', {}, false);
  assert.match(html, /import \{attachTileflowAtmosphere, tileflowMaxPitch\} from/u);
  assert.match(html, /attachTileflowAtmosphere\(map\);/u);
  assert.doesNotMatch(
    html,
    /attachTileflowSky\(|attachTileflowSkyHaze\(|drop-shadow|--tileflow-space|tileflow-globe/u,
  );
  const runtime = getTileflowPreviewRuntimeResponse('/__runtime/tileflow-browser.js');
  assert.ok(runtime);
  assert.match(await runtime.text(), /attachTileflowAtmosphere/u);
});
