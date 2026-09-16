import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {canonicalMobileApiOrigin, snapshotMobileConfiguration} from '../src/mobile-configuration';
import {createNativeConfigurationReader} from '../src/native-configuration-reader';

const credential = () => `tf_public_${'c'.repeat(48)}`;
const configuration = () =>
  snapshotMobileConfiguration({
    apiOrigin: 'https://api.example.test',
    credential: credential(),
  });

function source(): TileflowNativeSourceState {
  const theme = {
    name: 'light',
    colorScheme: 'light' as const,
    styleUrl: 'https://maps.example/style.json',
  };
  return {
    status: 'ready',
    generation: 1,
    source: {map: 'streets', manifestUrl: 'https://maps.example/manifest.json'},
    manifestUrl: 'https://maps.example/manifest.json',
    manifest: {version: 1, maps: {streets: {defaultTheme: 'light', themes: {light: theme}}}},
    map: {
      name: 'streets',
      defaultTheme: 'light',
      themes: {light: theme},
      usageMode: 'session',
      mapId: 'map_abcdefghijklmnop',
      apiUrl: 'https://api.example.test',
    },
    theme,
  };
}

test('Unicode case folding cannot turn non-ASCII configuration into an approved origin', () => {
  for (const value of [
    'https://\u212A.example',
    'https://\u017F.example',
    'http\u017F://api.example.test',
  ]) {
    assert.throws(() => canonicalMobileApiOrigin(value), {code: 'NATIVE_CONFIGURATION_INVALID'});
  }
});

test('a session requires matching declared logical identities, not two missing fields', async () => {
  let reads = 0;
  const resolver = createHostedNativeBindingResolver(async () => {
    reads++;
    return configuration();
  });
  for (const name of [undefined, '', 1, null]) {
    const input = source();
    assert.ok(input.status === 'ready');
    Object.assign(input.map, {name});
    Object.assign(input.source, {map: name});
    await assert.rejects(resolver.replace(input), {code: 'NATIVE_CONFIGURATION_SOURCE_INVALID'});
  }
  assert.equal(reads, 0);
  resolver.dispose();
});

test('non-session metadata is not read through incidental getters', async () => {
  const input = source();
  assert.ok(input.status === 'ready');
  Object.assign(input.map, {usageMode: undefined});
  let reads = 0;
  Object.defineProperty(input.map, 'apiUrl', {
    get() {
      reads++;
      throw new Error(credential());
    },
  });
  const resolver = createHostedNativeBindingResolver(async () => {
    reads++;
    throw new Error('Unexpected configuration read.');
  });
  assert.deepEqual(await resolver.replace(input), {kind: 'direct'});
  assert.equal(reads, 0);
  resolver.dispose();
});

test('disposal before queued lookup does not evaluate native configuration', async () => {
  let reads = 0;
  const resolver = createHostedNativeBindingResolver(async () => {
    reads++;
    return configuration();
  });
  const pending = resolver.replace(source());
  resolver.dispose();
  await assert.rejects(pending, {code: 'NATIVE_CONFIGURATION_DISPOSED'});
  assert.equal(reads, 0);
});

test('reentrant reflection cannot publish an older Hosted binding', async () => {
  let replacement: Promise<unknown> | undefined;
  let reads = 0;
  const resolver = createHostedNativeBindingResolver(async () => {
    reads++;
    return configuration();
  });
  const direct = source();
  assert.ok(direct.status === 'ready');
  Object.assign(direct.map, {usageMode: undefined});
  let replaced = false;
  const input = new Proxy(source(), {
    getOwnPropertyDescriptor(target, property) {
      if (!replaced) {
        replaced = true;
        replacement = resolver.replace(direct);
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  await assert.rejects(resolver.replace(input), {code: 'NATIVE_CONFIGURATION_REPLACED'});
  assert.deepEqual(await replacement, {kind: 'direct'});
  assert.equal(reads, 0);
  resolver.dispose();
});

test('a changed method or malicious native error cannot reuse a cached configuration', async () => {
  const module = {readConfiguration: async () => configuration()};
  const reader = createNativeConfigurationReader(() => module);
  await reader.read();
  module.readConfiguration = async () => configuration();
  await assert.rejects(reader.read(), {code: 'NATIVE_CONFIGURATION_UNAVAILABLE'});
  let reads = 0;
  const bad = createNativeConfigurationReader(() => ({
    readConfiguration() {
      throw Object.defineProperty(new Error(credential()), 'code', {
        get() {
          reads++;
          throw new Error(credential());
        },
      });
    },
  }));
  await assert.rejects(bad.read(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(credential()), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(reads, 0);
});
