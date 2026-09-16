import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

test('the built private factory never looks up configuration for a non-session source', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-native-configuration-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const native = join(directory, 'node_modules', 'react-native');
  await mkdir(native, {recursive: true});
  await writeFile(
    join(native, 'package.json'),
    JSON.stringify({name: 'react-native', type: 'module', exports: './index.js'}),
  );
  await writeFile(
    join(native, 'index.js'),
    `
    export let lookups = 0;
    export const NativeModules = Object.defineProperty({}, 'TileflowNativeConfiguration', {
      get() { lookups++; throw new Error('Native lookup must remain lazy.'); }
    });
  `,
  );
  const entry = join(directory, 'bridge.mjs');
  await copyFile(
    new URL('../dist/internal/native-configuration-bridge.js', import.meta.url),
    entry,
  );
  const script = `
    import assert from 'node:assert/strict';
    for (const name of ['window', 'document', 'navigator', 'fetch', 'XMLHttpRequest']) {
      Object.defineProperty(globalThis, name, {configurable: true, get() {
        throw new Error('Unexpected ambient service.');
      }});
    }
    const {createReactNativeHostedBindingResolver} = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const native = await import(${JSON.stringify(pathToFileURL(join(native, 'index.js')).href)});
    assert.equal(native.lookups, 0);
    const first = createReactNativeHostedBindingResolver();
    const second = createReactNativeHostedBindingResolver();
    const source = {
      status: 'ready', generation: 1,
      source: {map: 'streets', manifestUrl: 'https://maps.example.test/manifest.json'},
      map: {name: 'streets', usageMode: undefined},
    };
    assert.deepEqual(await first.replace(source), {kind: 'direct'});
    assert.deepEqual(await second.replace(source), {kind: 'direct'});
    assert.equal(native.lookups, 0);
    await assert.rejects(first.replace({...source, map: {
      name: 'streets', usageMode: 'session', mapId: 'map_abcdefghijklmnop',
      apiUrl: 'https://api.example.test'
    }}), {code: 'NATIVE_CONFIGURATION_UNAVAILABLE'});
    assert.equal(native.lookups, 1);
    assert.deepEqual(await second.replace(source), {kind: 'direct'});
    assert.equal(native.lookups, 1);
    first.dispose(); second.dispose();
  `;
  const {stdout, stderr} = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {cwd: directory, timeout: 10_000},
  );
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});
