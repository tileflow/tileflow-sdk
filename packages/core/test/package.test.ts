import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

test('declares the browser entry without exposing it from the package root', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    files: string[];
  };

  assert.deepEqual(manifest.exports['./browser'], {
    types: './dist/browser.d.ts',
    import: './dist/browser.js',
    default: './dist/browser.js',
  });
  assert.equal(Object.hasOwn(manifest.exports['.'] as object, 'browser'), false);
  assert.deepEqual(manifest.files, ['dist']);
});

test('imports the packaged browser entry without reading browser globals', async () => {
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
    const entry = await import('@tileflow/core/browser');
    if (typeof entry.attachTileflowMapLifecycle !== 'function') process.exit(2);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('does not re-export the browser kernel from the packaged root', async () => {
  const script = `
    const entry = await import('@tileflow/core');
    if ('attachTileflowMapLifecycle' in entry) process.exit(2);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('packages only the direct Streets authoring surface and compiler', async () => {
  const script = `
    const entry = await import('@tileflow/core');
    for (const name of [
      'streets', 'land', 'water', 'roads', 'transit', 'aeroways',
      'buildings', 'boundaries', 'labels', 'poi', 'createStyle',
      'tileflowWorld', 'parseWorldGenerationDescriptor',
    ]) {
      if (typeof entry[name] !== 'function') process.exit(2);
    }
    for (const removed of ['osm', 'styleOverride', 'tileflowWorldRevision']) {
      if (removed in entry) process.exit(3);
    }
    const style = entry.createStyle({basemap: entry.streets()});
    if (style.metadata['tileflow:basemap'] !== 'streets') process.exit(4);
    if (!style.layers.every((layer) => layer.id.startsWith('streets-'))) process.exit(5);
  `;

  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');

  const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(bundle, /highway-primary|rendererPreference/i);
});
