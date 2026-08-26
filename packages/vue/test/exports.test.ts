import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadTileflowMapLibre} from '../src/maplibre.js';

test('publishes one ESM entry with matching default and named components', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: {'.': {default: string; import: string; types: string}};
    files: string[];
    main: string;
    sideEffects: boolean;
    types: string;
  };
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.deepEqual(packageJson.files, [
    'dist',
    'LICENSE',
    'NOTICE',
    'GENERATED_OUTPUT_LICENSE.md',
    'TRADEMARKS.md',
  ]);
  assert.equal(packageJson.main, packageJson.exports['.'].import);
  assert.equal(packageJson.types, packageJson.exports['.'].types);
  assert.equal(packageJson.exports['.'].default, packageJson.exports['.'].import);
  assert.equal(packageJson.sideEffects, false);
  assert.match(source, /export const TileflowMap/u);
  assert.match(source, /export default TileflowMap/u);
});

test('keeps MapLibre behind the interactive runtime boundary', async () => {
  const output = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');

  assert.match(output, /import\(["']maplibre-gl["']\)/u);
  assert.match(output, /loadTileflowStyleFonts/u);
  assert.match(output, /registerTileflowContourProtocol/u);
  assert.ok(output.indexOf('loadTileflowStyleFonts') < output.indexOf('new maplibregl.Map'));
  assert.ok(
    output.indexOf('registerTileflowContourProtocol') < output.indexOf('new maplibregl.Map'),
  );
  assert.match(output, /new maplibregl\.Map/u);
  assert.doesNotMatch(output, /^import .*?["']maplibre-gl["'];?$/mu);
});

test('imports delivery helpers from responsibility-specific subpaths', async () => {
  const component = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const styleSource = await readFile(new URL('../src/style-source.ts', import.meta.url), 'utf8');

  assert.match(component, /from ["']@tileflow\/core\/runtime["']/u);
  assert.match(component, /from ["']@tileflow\/core\/capture["']/u);
  assert.doesNotMatch(component, /createStyle|TileflowConfig|TileflowThemeRegistry/u);
  assert.match(styleSource, /from ["']@tileflow\/core\/runtime["']/u);
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
