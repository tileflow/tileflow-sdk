import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import * as source from '../src/index';

const execFileAsync = promisify(execFile);

const runtimeExports = [
  'initialTileflowInteractionState',
  'reduceTileflowInteractionState',
  'tileflowAnnotationSchema',
  'tileflowAnnotationsSchema',
  'tileflowInteractionActionSchema',
  'tileflowInteractionBindingSchema',
  'tileflowInteractionBindingsSchema',
  'tileflowInteractionContentSchema',
  'tileflowInteractionJsonValueSchema',
  'tileflowInteractionLimits',
  'tileflowInteractionReference',
  'tileflowInteractionSchemaVersion',
  'tileflowInteractionStateSchema',
  'tileflowInteractionTargetRefSchema',
  'tileflowInteractionTargetRefsEqual',
  'tileflowInteractionTargetSchema',
  'tileflowPoiCategories',
  'validateTileflowAnnotations',
  'validateTileflowInteractionBindings',
];

test('publishes one focused root entry and its package metadata', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {exports: Record<string, unknown>; files: string[]; sideEffects: boolean};

  assert.deepEqual(manifest.exports['.'], {
    types: './dist/index.d.ts',
    import: './dist/index.js',
    default: './dist/index.js',
  });
  assert.deepEqual(manifest.exports['./maplibre'], {
    types: './dist/maplibre-entry.d.ts',
    import: './dist/maplibre-entry.js',
    default: './dist/maplibre-entry.js',
  });
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.deepEqual(manifest.files, [
    'dist',
    'LICENSE',
    'NOTICE',
    'GENERATED_OUTPUT_LICENSE.md',
    'TRADEMARKS.md',
  ]);
  assert.equal(manifest.sideEffects, false);
});

test('imports the MapLibre subpath without reading browser globals before attach', async () => {
  const script = `
    for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    const entry = await import('@tileflow/interactions/maplibre');
    if (typeof entry.createTileflowAnnotationRegistry !== 'function') process.exit(2);
    if (typeof entry.createTileflowMapLibreDomRuntime !== 'function') process.exit(3);
    if (typeof entry.createTileflowMapLibrePoiController !== 'function') process.exit(4);
    if (typeof entry.createTileflowMapLibreSemanticDomRuntime !== 'function') process.exit(5);
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('preserves the exact runtime export surface', async () => {
  const built = await import('../dist/index.js');
  assert.deepEqual(Object.keys(source).sort(), runtimeExports);
  assert.deepEqual(Object.keys(built).sort(), runtimeExports);
});

test('imports the packaged root without reading browser or MapLibre globals', async () => {
  const script = `
    for (const name of [
      'window',
      'document',
      'navigator',
      'requestAnimationFrame',
      'ResizeObserver',
    ]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    const entry = await import('@tileflow/interactions');
    if (typeof entry.validateTileflowAnnotations !== 'function') process.exit(2);
    if (typeof entry.reduceTileflowInteractionState !== 'function') process.exit(3);
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
