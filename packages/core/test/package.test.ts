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
  };

  assert.deepEqual(manifest.exports['./browser'], {
    types: './dist/browser.d.ts',
    import: './dist/browser.js',
    default: './dist/browser.js',
  });
  assert.equal(Object.hasOwn(manifest.exports['.'] as object, 'browser'), false);
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
