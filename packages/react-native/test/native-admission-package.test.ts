import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {inspectPublicMapRuntime} from './map-runtime-fixture';

const packageRoot = new URL('../', import.meta.url);

test('native admission does not publish the package or add a public subpath', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
});

test('the public runtime exports only Map and importing it does not activate private admission', async () => {
  assert.deepEqual(await inspectPublicMapRuntime(), {exports: ['Map'], callable: 'function'});
  const source = await readFile(new URL('src/index.ts', packageRoot), 'utf8');
  assert.match(source, /export \{Map\} from ['"]\.\/map['"]/u);
  assert.doesNotMatch(source, /NativeAdmission|HostedNativeSession|native-admission/iu);
});

test('native admission authority and transport contracts remain absent from public declarations', async () => {
  const declarations = await readFile(new URL('dist/index.d.ts', packageRoot), 'utf8');
  for (const forbidden of [
    'NativeAdmission',
    'NativeTransportOwner',
    'HostedNativeSessionAuthority',
    'X-Tileflow-Native-Grant',
  ]) {
    assert.equal(declarations.includes(forbidden), false, forbidden);
  }
});
