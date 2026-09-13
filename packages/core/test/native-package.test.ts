import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = new URL('../', import.meta.url);

test('publishes native URL helpers through an explicit entrypoint', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.deepEqual(manifest.exports['./native'], {
    types: './dist/native.d.ts',
    import: './dist/native.js',
    default: './dist/native.js',
  });
  const declarations = await readFile(new URL('dist/native.d.ts', packageRoot), 'utf8');
  assert.match(declarations, /resolveTileflowNativeManifestUrl/u);
  assert.match(declarations, /resolveTileflowNativeResourceUrl/u);
  assert.match(declarations, /TileflowNativeUrlError/u);
});

test('imports the native entrypoint without browser globals or network access', async () => {
  const script = `
    for (const name of [
      'window', 'document', 'navigator', 'fetch', 'URL', 'TextEncoder',
      'FontFace', 'ResizeObserver', 'requestAnimationFrame', 'matchMedia',
    ]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('Unexpected global access: ' + name); },
      });
    }
    const native = await import('@tileflow/core/native');
    console.log(JSON.stringify(Object.keys(native).sort()));
  `;
  const args = ['--input-type=module', '--eval', script];
  const {stdout} = await execFileAsync(process.execPath, args, {
    cwd: fileURLToPath(packageRoot),
    timeout: 10_000,
  });
  assert.deepEqual(JSON.parse(stdout), [
    'TileflowNativeUrlError',
    'resolveTileflowNativeManifestUrl',
    'resolveTileflowNativeResourceUrl',
    'tileflowNativeUrlLimits',
  ]);
});
