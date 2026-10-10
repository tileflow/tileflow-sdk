import assert from 'node:assert/strict';
import test from 'node:test';
import {getTileflowPreviewRuntimeResponse} from '../src/preview-assets';
import {renderTileflowPreviewHtml} from '../src/preview-html';

test('serves the exact MapLibre v6 module closure to Preview', async () => {
  const main = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl.mjs');
  const shared = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl-shared.mjs');
  const worker = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl-worker.mjs');
  const stylesheet = getTileflowPreviewRuntimeResponse('/__runtime/maplibre-gl.css');

  assert.ok(main);
  assert.ok(shared);
  assert.ok(worker);
  assert.ok(stylesheet);
  assert.match(main.headers.get('content-type') ?? '', /javascript/u);
  // Since GL JS 6.13 the main module holds what the shared one did and names only its worker; the
  // shared module still ships, empty.
  assert.match(await main.text(), /maplibre-gl-worker\.mjs/u);
  assert.match(shared.headers.get('content-type') ?? '', /javascript/u);
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

test('offers a theme switch only when a map preview has several themes', () => {
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
  assert.match(several, /if \(previewThemes\.length > 1\) map\.addControl\(new ThemeControl\(\)/u);
});

test('the preview globe backdrop follows the map atmosphere', () => {
  const html = renderTileflowPreviewHtml(undefined, '/tileflow', {}, false);

  assert.match(html, /background-color: var\(--tileflow-space, #2F5070\)/u);
  assert.match(html, /metadata\?\.\["tileflow:atmosphere"\]/u);
  assert.match(html, /"--tileflow-rim-glow": rgba\(atmosphere\?\.horizonColor, 0\.52\)/u);
});
