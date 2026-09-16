import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {snapshotMobileConfiguration} from '../src/mobile-configuration';
import {createNativeConfigurationReader} from '../src/native-configuration-reader';
import {createHostedNativeSessionController} from '../src/session-controller';

const origin = 'https://api.example.test';
const credential = () => `tf_public_${'b'.repeat(48)}`;
const config = () => snapshotMobileConfiguration({apiOrigin: origin, credential: credential()});

function source(metadata: Record<string, unknown> = {}): TileflowNativeSourceState {
  const theme = {name: 'light', colorScheme: 'light' as const, styleUrl: `${origin}/style.json`};
  return {
    status: 'ready',
    generation: 1,
    source: {map: 'streets', manifestUrl: `${origin}/manifest.json`},
    manifestUrl: `${origin}/manifest.json`,
    manifest: {version: 1, maps: {streets: {defaultTheme: 'light', themes: {light: theme}}}},
    map: {
      name: 'streets', defaultTheme: 'light', themes: {light: theme},
      usageMode: 'session', mapId: 'map_abcdefghijklmnop', apiUrl: origin,
      ...metadata,
    },
    theme,
  } as TileflowNativeSourceState;
}

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('non-session delivery never locates configuration or creates commercial identity', async () => {
  let reads = 0;
  let identities = 0;
  let requests = 0;
  const resolver = createHostedNativeBindingResolver(() => {
    reads++;
    throw new Error('Configuration must remain unevaluated.');
  });
  for (const metadata of [
    {usageMode: undefined, mapId: undefined, apiUrl: undefined},
    {usageMode: undefined, apiUrl: 'https://self-hosted.example'},
    {usageMode: undefined, mapId: 'map_abcdefghijklmnop', apiUrl: origin},
  ]) {
    const binding = await resolver.replace(source(metadata));
    assert.deepEqual(binding, {kind: 'direct'});
    const controller = createHostedNativeSessionController({
      binding,
      fetch: async () => { requests++; throw new Error('Unexpected bootstrap.'); },
      now: () => new Date(0),
      sessionIdFactory: () => { identities++; return 'ses_unexpected'; },
    });
    assert.equal(await controller.acquire(), null);
    controller.dispose();
  }
  assert.equal(reads, 0);
  assert.equal(identities, 0);
  assert.equal(requests, 0);
  resolver.dispose();
});

test('requires declared session metadata and exact canonical origin agreement', async () => {
  let reads = 0;
  const resolver = createHostedNativeBindingResolver(async () => { reads++; return config(); });
  for (const metadata of [
    {mapId: undefined}, {mapId: 'streets'}, {mapId: 'map_short'},
    {apiUrl: undefined}, {apiUrl: `${origin}/api`}, {apiUrl: `${origin}?`},
    {usageMode: 'request'},
  ]) {
    await assert.rejects(resolver.replace(source(metadata)), {code: 'NATIVE_CONFIGURATION_SOURCE_INVALID'});
  }
  assert.equal(reads, 0);
  for (const apiUrl of ['https://other.example', 'https://api.example.test:8443']) {
    await assert.rejects(resolver.replace(source({apiUrl})), {code: 'NATIVE_CONFIGURATION_ORIGIN_MISMATCH'});
  }
  const binding = await resolver.replace(source({apiUrl: 'HTTPS://API.EXAMPLE.TEST:443/'}));
  assert.equal(binding.kind, 'hosted');
  if (binding.kind !== 'hosted') assert.fail('Expected Hosted binding.');
  assert.equal(binding.apiOrigin, origin);
  assert.equal(binding.credential, credential());
  assert.equal(binding.mapId, 'map_abcdefghijklmnop');
  assert.ok(Object.isFrozen(binding));
  assert.equal(JSON.stringify(binding).includes(credential()), false);
  assert.equal(JSON.stringify(binding).includes(origin), false);
  resolver.dispose();
});

test('replacement snapshots metadata and retires stale success or failure immediately', async () => {
  for (const rejects of [false, true]) {
    const response = gate<ReturnType<typeof config>>();
    const entered = gate<void>();
    const resolver = createHostedNativeBindingResolver(() => {
      entered.resolve();
      return response.promise;
    });
    const mutable = source();
    const pending = resolver.replace(mutable);
    const rejected = assert.rejects(pending, {code: 'NATIVE_CONFIGURATION_REPLACED'});
    await entered.promise;
    if (mutable.status !== 'ready') assert.fail('Expected resolved source.');
    Object.assign(mutable.map, {apiUrl: 'https://other.example', mapId: 'map_ponmlkjihgfedcba'});
    assert.deepEqual(await resolver.replace(source({usageMode: undefined})), {kind: 'direct'});
    await rejected;
    if (rejects) response.reject(new Error(`remote-detail ${credential()}`));
    else response.resolve(config());
    await response.promise.catch(() => undefined);
    resolver.dispose();
  }
});

test('metadata changes during configuration acquisition cannot redirect the binding', async () => {
  const response = gate<ReturnType<typeof config>>();
  const resolver = createHostedNativeBindingResolver(() => response.promise);
  const mutable = source();
  const pending = resolver.replace(mutable);
  if (mutable.status !== 'ready') assert.fail('Expected resolved source.');
  Object.assign(mutable.map, {apiUrl: 'https://other.example', mapId: 'map_ponmlkjihgfedcba'});
  response.resolve(config());
  const binding = await pending;
  assert.equal(binding.kind, 'hosted');
  if (binding.kind !== 'hosted') assert.fail('Expected Hosted binding.');
  assert.equal(binding.apiOrigin, origin);
  assert.equal(binding.mapId, 'map_abcdefghijklmnop');
  resolver.dispose();
});

test('disposal during configuration lookup cancels only that Map and suppresses late completion', async () => {
  const response = gate<unknown>();
  let calls = 0;
  const module = {readConfiguration() { calls++; return response.promise; }};
  const application = createNativeConfigurationReader(() => module);
  const first = createHostedNativeBindingResolver(application.read);
  const second = createHostedNativeBindingResolver(application.read);
  const old = first.replace(source());
  const cancelled = assert.rejects(old, {code: 'NATIVE_CONFIGURATION_DISPOSED'});
  const live = second.replace(source({mapId: 'map_ponmlkjihgfedcba'}));
  first.dispose();
  first.dispose();
  await cancelled;
  response.resolve({apiOrigin: origin, credential: credential()});
  const binding = await live;
  assert.equal(binding.kind, 'hosted');
  if (binding.kind !== 'hosted') assert.fail('Expected Hosted binding.');
  assert.equal(binding.mapId, 'map_ponmlkjihgfedcba');
  assert.equal(calls, 1);
  await assert.rejects(first.replace(source()), {code: 'NATIVE_CONFIGURATION_DISPOSED'});
  second.dispose();
});

test('shared application data never shares controllers or session identities', async () => {
  const read = async () => config();
  const first = createHostedNativeBindingResolver(read);
  const second = createHostedNativeBindingResolver(read);
  const bindings = await Promise.all([first.replace(source()), second.replace(source())]);
  assert.notEqual(bindings[0], bindings[1]);
  let sequence = 0;
  const controllers = bindings.map((binding) => createHostedNativeSessionController({
    binding,
    fetch: async () => { throw new Error('No acquisition requested.'); },
    now: () => new Date(0),
    sessionIdFactory: () => `ses_isolated_${++sequence}`,
  }));
  assert.notDeepEqual(controllers[0]!.state, controllers[1]!.state);
  controllers[0]!.dispose();
  assert.notEqual(controllers[1]!.state.status, 'disposed');
  controllers[1]!.dispose();
  first.dispose();
  second.dispose();
});

test('reentrant configuration lookup cannot bind a source it replaced', async () => {
  let replacement: Promise<unknown> | undefined;
  const resolver = createHostedNativeBindingResolver(async () => {
    replacement = resolver.replace(source({usageMode: undefined}));
    return config();
  });
  await assert.rejects(resolver.replace(source()), {code: 'NATIVE_CONFIGURATION_REPLACED'});
  assert.deepEqual(await replacement, {kind: 'direct'});
  resolver.dispose();
});
