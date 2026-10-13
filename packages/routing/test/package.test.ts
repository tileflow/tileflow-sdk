import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import {valid} from 'semver';
import * as source from '../src/index';

const execFileAsync = promisify(execFile);

test('publishes root, contract, client and package metadata entries', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(Object.keys(manifest.exports), [
    '.',
    './contract',
    './client',
    './package.json',
  ]);
  assert.equal(manifest.sideEffects, false);
  assert.equal(typeof manifest.version, 'string');
  assert.equal(valid(manifest.version), manifest.version);
  assert.equal(manifest.publishConfig.access, 'public');
});

test('preserves the exact source and built root surface', async () => {
  const built = await import('../dist/index.js');
  assert.deepEqual(Object.keys(built).sort(), Object.keys(source).sort());
  for (const operation of ['route', 'isochrone', 'matrix', 'match', 'nearest'] as const)
    assert.equal(typeof built[operation], 'function', operation);
  assert.equal(typeof built.RoutingError, 'function');
  assert.equal(typeof built.routingRouteRequestSchema, 'object');
  assert.equal(typeof built.routingIsochroneResponseSchema, 'object');
  assert.equal(typeof built.routingMatrixResponseSchema, 'object');
  assert.equal(typeof built.routingMatchResponseSchema, 'object');
  assert.equal(typeof built.routingNearestResponseSchema, 'object');
});

test('imports every built entry without reading browser globals', async () => {
  const script = `
    for (const name of ['window', 'document', 'requestAnimationFrame']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    for (const entry of ['@tileflow/routing', '@tileflow/routing/contract', '@tileflow/routing/client']) {
      await import(entry);
    }
  `;
  const {stderr, stdout} = await execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: new URL('..', import.meta.url)},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
