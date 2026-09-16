import assert from 'node:assert/strict';
import test from 'node:test';
import {inspect} from 'node:util';
import {
  canonicalMobileApiOrigin,
  NativeConfigurationError,
  snapshotMobileConfiguration,
} from '../src/mobile-configuration';
import {createNativeConfigurationReader} from '../src/native-configuration-reader';

const credential = () => `tf_public_${'a'.repeat(48)}`;
const configuration = () => ({apiOrigin: 'https://api.example.test', credential: credential()});

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

function safe(error: unknown, code = 'NATIVE_CONFIGURATION_INVALID'): boolean {
  assert.ok(error instanceof NativeConfigurationError);
  assert.equal(error.code, code);
  for (const text of [String(error), JSON.stringify(error), inspect(error)]) {
    assert.equal(text.includes(credential()), false);
    assert.equal(text.includes('api.example.test'), false);
    assert.equal(text.includes('remote-detail'), false);
  }
  assert.equal(error.cause, undefined);
  return true;
}

test('normalizes only HTTPS scheme, ASCII host case, port 443 and one root slash', () => {
  for (const [input, expected] of [
    ['HTTPS://API.Example.test:443/', 'https://api.example.test'],
    ['https://api.example.test', 'https://api.example.test'],
    ['https://api.example.test:8443/', 'https://api.example.test:8443'],
    ['https://xn--bcher-kva.example', 'https://xn--bcher-kva.example'],
    ['https://127.0.0.1:65535', 'https://127.0.0.1:65535'],
    ['https://localhost/', 'https://localhost'],
  ]) {
    assert.equal(canonicalMobileApiOrigin(input), expected);
  }
});

test('rejects origin aliases and URL components instead of dropping them', () => {
  for (const input of [
    undefined,
    null,
    1,
    {},
    '',
    ' https://api.example.test',
    'https://api.example.test\n',
    'http://api.example.test',
    '//api.example.test',
    'https://api.example.test/path',
    'https://api.example.test//',
    'https://api.example.test/.',
    'https://api.example.test/..',
    'https://api.example.test?',
    'https://api.example.test/#',
    'https://user@api.example.test',
    'https://api.example.test\\',
    'https://api.%65xample.test',
    'https://bücher.example',
    'https://api.example.test.',
    'https://*.example.test',
    'https://bad_host.example',
    'https://-bad.example',
    'https://bad-.example',
    'https://a..example',
    'https://api.example.test:0',
    'https://api.example.test:0443',
    'https://api.example.test:65536',
    'https://api.example.test:',
    'https://127.1',
    'https://0177.0.0.1',
    'https://0x7f000001',
    'https://2130706433',
    'https://example.0x1',
    'https://256.0.0.1',
    'https://[::1]',
    `https://${'a'.repeat(64)}.example`,
    `https://${'a'.repeat(2048)}`,
  ]) {
    assert.throws(() => canonicalMobileApiOrigin(input), (error) => safe(error));
  }
});

test('requires the exact mobile credential grammar and a complete bounded native result', () => {
  for (const value of [
    undefined,
    null,
    1,
    '',
    'placeholder',
    credential().toUpperCase(),
    `${credential()}\n`,
    ` ${credential()}`,
    `tf_public_${'a'.repeat(47)}`,
    `tf_public_${'a'.repeat(49)}`,
    `tf_public_${'g'.repeat(48)}`,
  ]) {
    assert.throws(() => snapshotMobileConfiguration({...configuration(), credential: value}), safe);
  }
  for (const input of [
    undefined,
    null,
    [],
    {},
    {credential: credential()},
    {apiOrigin: 'https://api.example.test'},
    {...configuration(), extra: 'remote-detail'},
    Object.create(configuration()),
  ]) {
    assert.throws(() => snapshotMobileConfiguration(input), safe);
  }
  let reads = 0;
  const input = Object.defineProperty({apiOrigin: 'https://api.example.test'}, 'credential', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('remote-detail');
    },
  });
  assert.throws(() => snapshotMobileConfiguration(input), safe);
  assert.equal(reads, 0);
});

test('copies and hides private application values from ordinary snapshots and inspection', () => {
  const input = configuration();
  const result = snapshotMobileConfiguration(input);
  assert.notEqual(input, result);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.credential, credential());
  input.credential = 'changed';
  input.apiOrigin = 'https://changed.example';
  assert.equal(result.credential, credential());
  assert.equal(result.apiOrigin, 'https://api.example.test');
  assert.deepEqual(Object.keys(result), []);
  assert.equal(JSON.stringify(result), '{}');
  assert.equal(inspect(result).includes(credential()), false);
});

test('reserves one lazy native read before reentrant and concurrent callers', async () => {
  const response = gate<unknown>();
  let calls = 0;
  let nested: Promise<unknown> | undefined;
  const module = {
    readConfiguration() {
      calls++;
      nested = reader.read();
      return response.promise;
    },
  };
  const reader = createNativeConfigurationReader(() => module);
  assert.equal(calls, 0);
  const first = reader.read();
  const second = reader.read();
  response.resolve(configuration());
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(await nested, left);
  assert.equal(await reader.read(), left);
  assert.equal(calls, 1);
});

test('native absence, throws, rejection and malformed results produce only safe failures', async () => {
  for (const lookup of [
    () => undefined,
    () => ({}),
    () => {
      throw new Error(`remote-detail ${credential()}`);
    },
    () => ({
      readConfiguration() {
        throw new Error(`remote-detail ${credential()}`);
      },
    }),
    () => ({readConfiguration: () => Promise.reject(new Error('remote-detail'))}),
  ]) {
    const reader = createNativeConfigurationReader(lookup);
    await assert.rejects(reader.read(), (error) => safe(error, 'NATIVE_CONFIGURATION_UNAVAILABLE'));
    await assert.rejects(reader.read(), (error) => safe(error, 'NATIVE_CONFIGURATION_UNAVAILABLE'));
  }
  let calls = 0;
  const module = {
    readConfiguration() {
      calls++;
      return Promise.resolve({credential: credential()});
    },
  };
  const reader = createNativeConfigurationReader(() => module);
  await assert.rejects(reader.read(), safe);
  await assert.rejects(reader.read(), safe);
  assert.equal(calls, 1);
});

test('late native results and cached data cannot survive replacement of the bridge owner', async () => {
  const response = gate<unknown>();
  let module = {readConfiguration: () => response.promise};
  const reader = createNativeConfigurationReader(() => module);
  const pending = reader.read();
  await Promise.resolve();
  module = {readConfiguration: () => Promise.resolve(configuration())};
  response.resolve(configuration());
  await assert.rejects(pending, (error) => safe(error, 'NATIVE_CONFIGURATION_UNAVAILABLE'));
  await assert.rejects(reader.read(), (error) => safe(error, 'NATIVE_CONFIGURATION_UNAVAILABLE'));

  const current = {readConfiguration: () => Promise.resolve(configuration())};
  let available: unknown = current;
  const cached = createNativeConfigurationReader(() => available);
  await cached.read();
  available = undefined;
  await assert.rejects(cached.read(), (error) => safe(error, 'NATIVE_CONFIGURATION_UNAVAILABLE'));
});
