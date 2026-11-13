import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {configureTileflowMapLibre, loadTileflowMapLibre} from '../src/maplibre';

for (const entry of ['index.js', 'static.js']) {
  test(`preserves the client boundary in dist/${entry}`, async () => {
    const output = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
    assert.match(output, /^['"]use client['"];?/);
  });

  test(`includes the framework-neutral readiness contract in dist/${entry}`, async () => {
    const output = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
    assert.match(output, /data-tileflow-state/);
    assert.match(output, /data-tileflow-map/);
    assert.match(output, /data-tileflow-capture-id/);
    assert.match(output, /idle/);
    assert.match(output, /loading/);
    assert.match(output, /error/);
  });
}

test('interactive React build mounts the map through the framework-free core', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(output, /from ["']@tileflow\/dom["']/u);
  assert.match(output, /createTileflowMap/u);
  assert.match(output, /createPortal/u);
  // MapLibre, the World notice bridge and the interaction runtimes come with the core.
  assert.doesNotMatch(output, /new maplibregl\.Map|registerTileflowWorldRequestBridge/u);
  assert.doesNotMatch(output, /createTileflowMapLibreDomRuntime/u);
});

test('keeps MapLibre behind the interactive runtime boundary', async () => {
  const interactiveOutput = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  const imageOutput = await readFile(new URL('../dist/static.js', import.meta.url), 'utf8');

  assert.doesNotMatch(interactiveOutput, /^import .*?["']maplibre-gl["'];?$/mu);
  assert.doesNotMatch(imageOutput, /maplibre-gl|@tileflow\/dom/u);
});

test('imports delivery helpers from responsibility-specific subpaths', async () => {
  const mapSource = await readFile(new URL('../src/map.tsx', import.meta.url), 'utf8');
  const staticMapSource = await readFile(new URL('../src/static-map.tsx', import.meta.url), 'utf8');
  const staticRequestSource = await readFile(
    new URL('../src/static-map-request.ts', import.meta.url),
    'utf8',
  );

  assert.match(mapSource, /from ["']@tileflow\/core\/runtime["']/u);
  assert.match(mapSource, /from ["']@tileflow\/core\/capture["']/u);
  assert.match(mapSource, /from ["']@tileflow\/dom["']/u);
  assert.doesNotMatch(mapSource, /createStyle|TileflowConfig|TileflowThemeRegistry/u);
  assert.match(staticMapSource, /from ["']@tileflow\/static\/client["']/u);
  assert.match(staticMapSource, /from ["']@tileflow\/static\/scene["']/u);
  assert.match(staticRequestSource, /from ["']@tileflow\/static\/client["']/u);
});

test('interactive runtime resolves and reuses the MapLibre renderer', async () => {
  const firstLoad = loadTileflowMapLibre();
  const secondLoad = loadTileflowMapLibre();
  assert.equal(firstLoad, secondLoad);

  const maplibregl = await firstLoad;
  assert.equal(typeof maplibregl.Map, 'function');
  assert.equal(typeof maplibregl.Marker, 'function');
  assert.equal(typeof maplibregl.addProtocol, 'function');
});

test('configures the MapLibre worker before an interactive map uses it', async () => {
  configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});

  const maplibregl = await loadTileflowMapLibre();
  assert.equal(maplibregl.getWorkerUrl(), '/assets/maplibre-gl-worker.mjs');
});
