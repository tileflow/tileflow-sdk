import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';
import {valid} from 'semver';
import * as source from '../src/index';
import * as maplibreSource from '../src/maplibre-entry';
import * as profileSource from '../src/profile-entry';

const execFileAsync = promisify(execFile);

test('publishes root, contract, client, profile, MapLibre and package metadata entries', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.exports), [
    '.',
    './contract',
    './client',
    './profile',
    './maplibre',
    './package.json',
  ]);
  assert.equal(manifest.sideEffects, false);
  assert.equal(valid(manifest.version), manifest.version);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.equal(manifest.peerDependencies, undefined);
});

test('preserves the exact source and built surfaces', async () => {
  const built = await import('../dist/index.js');
  assert.deepEqual(Object.keys(built).sort(), Object.keys(source).sort());
  for (const name of [
    'elevation',
    'elevationBatch',
    'elevationPoints',
    'elevationProfile',
    'elevateLineString',
    'elevateMultiLineString',
    'elevationProfileFromLine',
    'elevationProfileAt',
    'sliceElevationProfile',
    'readGpx',
  ])
    assert.equal(typeof built[name], 'function', name);
  const profile = await import('../dist/profile-entry.js');
  assert.deepEqual(Object.keys(profile).sort(), Object.keys(profileSource).sort());
  const maplibre = await import('../dist/maplibre-entry.js');
  assert.deepEqual(Object.keys(maplibre).sort(), Object.keys(maplibreSource).sort());
  assert.equal(typeof maplibre.createTileflowElevationProfile, 'function');
});

test('the profile entry loads no validation library', async () => {
  const built = await readFile(new URL('../dist/profile-entry.js', import.meta.url), 'utf8');
  const imports = [...built.matchAll(/from\s*["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.ok(
    imports.every((specifier) => specifier.startsWith('./')),
    imports.join(', '),
  );
  for (const specifier of imports) {
    const chunk = await readFile(
      new URL(`../dist/${specifier!.slice(2)}`, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(chunk, /from\s*["']zod["']/u, specifier);
  }
});

test('imports every built entry without reading browser globals', async () => {
  const script = `
    for (const name of ['window', 'document', 'requestAnimationFrame', 'matchMedia', 'ResizeObserver']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() { throw new Error('browser global read during import: ' + name); },
      });
    }
    for (const entry of ['@tileflow/elevation', '@tileflow/elevation/contract', '@tileflow/elevation/client', '@tileflow/elevation/profile', '@tileflow/elevation/maplibre']) {
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
