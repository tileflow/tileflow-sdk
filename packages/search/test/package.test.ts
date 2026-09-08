import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
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
  assert.equal(manifest.version, '0.0.0-development');
  assert.equal(manifest.publishConfig.access, 'public');
});

test('preserves the exact source and built root surface', async () => {
  const built = await import('../dist/index.js');
  assert.deepEqual(Object.keys(built).sort(), Object.keys(source).sort());
  assert.equal(typeof built.geocode, 'function');
  assert.equal(typeof built.geocodeReverse, 'function');
  assert.equal(typeof built.autocomplete, 'function');
  assert.equal(typeof built.resolveSuggestion, 'function');
  assert.equal(typeof built.autocompleteRequestSchema, 'object');
  assert.equal(typeof built.resolveSuggestionResponseSchema, 'object');
  assert.equal(typeof built.geocodingForwardResponseSchema, 'object');
  assert.equal(typeof built.geocodingReverseRequestSchema, 'object');
  assert.equal(typeof built.reverseGeocodingKindSchema, 'object');
});

test('imports every built entry without reading browser globals', async () => {
  const script = `
    for (const name of ['window', 'document', 'requestAnimationFrame']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    for (const entry of ['@tileflow/search', '@tileflow/search/contract', '@tileflow/search/client']) {
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
