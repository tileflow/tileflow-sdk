import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {configureTileflowMapLibre, loadTileflowMapLibre} from '../src/maplibre';

test('the map core installs the World notice bridge before MapLibre', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(output, /registerTileflowWorldRequestBridge/);
  assert.match(output, /attachTileflowFairUseNotice/);
  assert.match(output, /worldRequestBridge/);
  assert.match(output, /loadTileflowStyleFonts/);
  assert.match(output, /registerTileflowContourProtocol/);
  assert.match(output, /registerTileflowPmtilesProtocol/);
  assert.ok(output.indexOf('loadTileflowStyleFonts') < output.indexOf('new maplibregl.Map'));
  assert.ok(
    output.indexOf('registerTileflowContourProtocol') < output.indexOf('new maplibregl.Map'),
  );
  assert.ok(
    output.indexOf('registerTileflowPmtilesProtocol') < output.indexOf('new maplibregl.Map'),
  );
});

test('the map core uses the shared MapLibre DOM runtime and interaction coordinator', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(output, /createTileflowMapLibreDomRuntime/u);
  assert.match(output, /createTileflowMapLibreInteractionCoordinator/u);
  assert.match(output, /createTileflowMapLibreSemanticDomRuntime/u);
  assert.match(output, /getDiagnostics/u);
  assert.match(output, /setCustomRenderers/u);
  assert.match(output, /subscribeDiagnostics/u);
  assert.match(output, /subscribeRenderTargets/u);
  assert.match(output, /subscribeEvents/u);
  assert.match(output, /validateTileflowInteractionBindings/u);
  assert.match(output, /queryRenderedFeatures/u);
  assert.match(output, /requestAnimationFrame/u);
});

test('loads MapLibre lazily and only in the browser', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');

  assert.match(output, /import\(["']maplibre-gl["']\)/u);
  assert.match(output, /new maplibregl\.Map/u);
  assert.doesNotMatch(output, /^import .*?["']maplibre-gl["'];?$/mu);
});

test('includes the framework-neutral readiness contract', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  for (const attribute of ['data-tileflow-state', 'data-tileflow-map', 'data-tileflow-theme']) {
    assert.match(output, new RegExp(attribute, 'u'));
  }
});

test('the MapLibre loader resolves the renderer once and keeps the configured worker', async () => {
  const firstLoad = loadTileflowMapLibre();
  assert.equal(loadTileflowMapLibre(), firstLoad);
  configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});

  const maplibregl = await firstLoad;
  assert.equal(typeof maplibregl.Map, 'function');
  assert.equal(maplibregl.getWorkerUrl(), '/assets/maplibre-gl-worker.mjs');
  assert.throws(
    () => configureTileflowMapLibre({workerUrl: '/other-worker.mjs'}),
    /already configured/u,
  );
});
