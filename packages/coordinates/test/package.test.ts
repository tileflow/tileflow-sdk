import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import * as contractSource from '../src/contract';
import * as rootSource from '../src/index';

const execFileAsync = promisify(execFile);

test('built root exposes the client while contract remains validation-only', async () => {
  const root = await import('../dist/index.js');
  const contract = await import('../dist/contract.js');
  assert.deepEqual(
    Object.keys(root)
      .filter((key) => key !== 'createCoordinatesClient')
      .sort(),
    Object.keys(contract).sort(),
  );
  assert.deepEqual(Object.keys(root).sort(), Object.keys(rootSource).sort());
  assert.deepEqual(Object.keys(contract).sort(), Object.keys(contractSource).sort());
  assert.equal(typeof root.createCoordinatesClient, 'function');
  assert.equal('createCoordinatesClient' in contract, false);
  assert.equal(typeof root.parseCoordinatesResponse, 'function');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.exports), ['.', './contract', './package.json']);
  assert.equal(manifest.version, '0.0.0-development');
  assert.equal(manifest.sideEffects, false);
});

test('built exports import without browser globals, network, filesystem or a native runtime', async () => {
  const script = `
    for (const name of ['window', 'document', 'fetch', 'requestAnimationFrame']) {
      Object.defineProperty(globalThis, name, {get() {throw new Error('Unexpected global access');}});
    }
    for (const entry of ['@tileflow/coordinates', '@tileflow/coordinates/contract']) {
      const module = await import(entry);
      if (module.parseCoordinatesRequest('search', {}).schemaVersion !== 1) throw new Error('Bad contract');
    }
  `;
  const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
  });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
