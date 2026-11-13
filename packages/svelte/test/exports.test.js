import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import test from 'node:test';
import {configureTileflowMapLibre, loadTileflowMapLibre} from '../src/maplibre.js';

test('publishes resolvable Svelte and declaration entry points', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const entrySource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

  assert.deepEqual(packageJson.files, ['src', 'LICENSE']);
  assert.equal(packageJson.types, packageJson.exports['.'].types);
  assert.equal(packageJson.svelte, packageJson.exports['.'].svelte);
  assert.equal(packageJson.exports['.'].default, packageJson.exports['.'].import);
  assert.equal(packageJson.exports['./TileflowMap.svelte'].types, './src/index.d.ts');
  assert.match(entrySource, /export \{default, default as TileflowMap\}/u);

  for (const exported of Object.values(packageJson.exports)) {
    for (const target of new Set(Object.values(exported))) {
      await access(new URL(`..${target.slice(1)}`, import.meta.url));
    }
  }
});

test('mounts the map through the framework-free core and keeps MapLibre out of the component', async () => {
  const component = await readFile(new URL('../src/TileflowMap.svelte', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../src/maplibre.js', import.meta.url), 'utf8');

  assert.match(component, /from ["']@tileflow\/dom["']/u);
  assert.match(component, /createTileflowMap\(/u);
  assert.doesNotMatch(component, /^\s*import (?!type).*["']maplibre-gl["']/mu);
  assert.match(loader, /from ["']@tileflow\/dom["']/u);
});

test('imports delivery helpers from responsibility-specific subpaths', async () => {
  const component = await readFile(new URL('../src/TileflowMap.svelte', import.meta.url), 'utf8');
  const declaration = await readFile(new URL('../src/index.d.ts', import.meta.url), 'utf8');
  const styleSource = await readFile(new URL('../src/style-source.js', import.meta.url), 'utf8');

  assert.match(component, /from ["']@tileflow\/core\/runtime["']/u);
  assert.match(component, /from ["']@tileflow\/core\/capture["']/u);
  assert.doesNotMatch(component, /createStyle|TileflowConfig|TileflowThemeRegistry/u);
  assert.match(declaration, /from ["']@tileflow\/core\/runtime["']/u);
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

test('configures the MapLibre worker before an interactive map uses it', async () => {
  configureTileflowMapLibre({workerUrl: '/assets/maplibre-gl-worker.mjs'});

  const maplibregl = await loadTileflowMapLibre();
  assert.equal(maplibregl.getWorkerUrl(), '/assets/maplibre-gl-worker.mjs');
});

test('keeps component exports aligned with the public props declaration', async () => {
  const implementation = await readFile(
    new URL('../src/TileflowMap.svelte', import.meta.url),
    'utf8',
  );
  const declaration = await readFile(new URL('../src/index.d.ts', import.meta.url), 'utf8');
  const implementationProps = [...implementation.matchAll(/^\s*export let (\w+)/gmu)].map(
    ([, name]) => name,
  );
  const declaredProps = [
    ...extractPropertyNames(declaration, 'TileflowMapBaseProps'),
    ...extractPropertyNames(declaration, 'TileflowMapStyleSourceProps'),
    'annotationClusters',
    'annotations',
    'bounds',
    'colors',
    'dataOverlays',
    'dataSources',
    'defaultInteractionState',
    'emphasis',
    'fitAnnotations',
    'fitBoundsOptions',
    'interactions',
    'interactionState',
    'marker',
    'mode',
    'navigationControl',
    'onInteractionDiagnostic',
    'onInteractionEvent',
    'onInteractionStateChange',
    'popup',
    'tooltip',
  ];

  assert.deepEqual(implementationProps.toSorted(), declaredProps.toSorted());

  for (const name of implementationProps) {
    assert.match(
      implementation,
      new RegExp(`export let ${name}: (?:NonNullable<)?TileflowMapProps\\['${name}'\\](?:>)?`, 'u'),
    );
  }
});

function extractPropertyNames(source, alias) {
  const body = new RegExp(
    `(?:export )?type ${alias}(?:<[^;]*?>)? = \\{([\\s\\S]*?)\\n\\};`,
    'u',
  ).exec(source)?.[1];
  assert.ok(body, `Missing ${alias} declaration`);

  return [...body.matchAll(/^\s{2}(\w+)\??:/gmu)].map(([, name]) => name);
}
