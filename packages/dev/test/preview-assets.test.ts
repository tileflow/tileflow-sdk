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
  assert.match(await main.text(), /maplibre-gl-shared\.mjs/u);
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
