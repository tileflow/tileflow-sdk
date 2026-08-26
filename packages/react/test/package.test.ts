import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadTileflowMapLibre} from '../src/maplibre';

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

test('interactive React build installs the World notice bridge', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(output, /registerTileflowWorldRequestBridge/);
  assert.match(output, /attachTileflowFairUseNotice/);
  assert.match(output, /worldRequestBridge/);
  assert.match(output, /loadTileflowStyleFonts/);
  assert.match(output, /registerTileflowContourProtocol/);
  assert.ok(output.indexOf('loadTileflowStyleFonts') < output.indexOf('new maplibregl.Map'));
  assert.ok(
    output.indexOf('registerTileflowContourProtocol') < output.indexOf('new maplibregl.Map'),
  );
});

test('interactive React build uses the shared MapLibre DOM runtime and React portals', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(output, /createTileflowMapLibreDomRuntime/u);
  assert.match(output, /createTileflowMapLibreInteractionCoordinator/u);
  assert.match(output, /createTileflowMapLibreSemanticDomRuntime/u);
  assert.match(output, /createPortal/u);
  assert.match(output, /getDiagnostics/u);
  assert.match(output, /setCustomRenderers/u);
  assert.match(output, /subscribeDiagnostics/u);
  assert.match(output, /subscribeRenderTargets/u);
  assert.match(output, /subscribeEvents/u);
  assert.match(output, /validateTileflowInteractionBindings/u);
  assert.match(output, /queryRenderedFeatures/u);
  assert.match(output, /requestAnimationFrame/u);
});

test('keeps MapLibre behind the interactive runtime boundary', async () => {
  const interactiveOutput = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  const imageOutput = await readFile(new URL('../dist/static.js', import.meta.url), 'utf8');

  assert.match(interactiveOutput, /import\(["']maplibre-gl["']\)/u);
  assert.match(interactiveOutput, /new maplibregl\.Map/u);
  assert.doesNotMatch(interactiveOutput, /^import .*?["']maplibre-gl["'];?$/mu);
  assert.doesNotMatch(imageOutput, /maplibre-gl/u);
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
  assert.match(mapSource, /from ["']@tileflow\/interactions\/maplibre["']/u);
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
