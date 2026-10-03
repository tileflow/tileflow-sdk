import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {createNativeAdmissionWire} from '../src/native-admission-wire';
import {
  type NativeAdmissionNativeModule,
  nativeBootstrapLimits,
  type NativeBootstrapReply,
} from '../src/native-bootstrap-contract';
import type {
  HostedNativeSessionAbortSignal,
  HostedNativeSessionFetchInit,
} from '../src/session-controller';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {
  apiOrigin,
  createClock,
  createIds,
  credential,
  deferred,
  grant,
  mapId,
  success,
} from './session-fixture';

class NativeModuleDouble extends AdmissionBridgeDouble implements NativeAdmissionNativeModule {
  readonly bootstraps: Array<{
    installation: string;
    context: string;
    request: string;
    url: string;
    credential: string;
    body: string;
  }> = [];
  readonly cancellations: string[] = [];
  readonly started = deferred<void>();
  readonly reply = deferred<NativeBootstrapReply>();
  async bootstrap(
    installation: string,
    context: string,
    request: string,
    url: string,
    credential: string,
    body: string,
  ) {
    this.bootstraps.push({installation, context, request, url, credential, body});
    this.started.resolve();
    return this.reply.promise;
  }
  async cancelBootstrap(
    _installation: string,
    _context: string,
    request: string,
  ): Promise<{cancelled: true}> {
    this.cancellations.push(request);
    return {cancelled: true};
  }
}

function abortFixture() {
  let aborted = false;
  const listeners = new Set<() => void>();
  const signal: HostedNativeSessionAbortSignal = {
    get aborted() {
      return aborted;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      aborted = true;
      for (const listener of [...listeners]) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
}
function init(signal: HostedNativeSessionAbortSignal): HostedNativeSessionFetchInit {
  return {
    body: JSON.stringify({mapId, sessionId: 'ses_test_1', surfaceId: 'store-locator'}),
    credentials: 'omit',
    headers: {'Content-Type': 'application/json', 'X-Tileflow-Mobile-Client': credential},
    method: 'POST',
    signal,
  };
}
function response(body = JSON.stringify(success())): NativeBootstrapReply {
  return {status: 201, cacheControl: 'no-store', bodyBase64: Buffer.from(body).toString('base64')};
}
function fixture() {
  const native = new NativeModuleDouble();
  const wire = createNativeAdmissionWire(native, (listener) => native.subscribe(listener));
  return {native, wire};
}

test('native bootstrap is independent, context-bound and returned as one bounded byte reader', async () => {
  const {native, wire} = fixture();
  await wire.bridge.install();
  const abort = abortFixture();
  const fetch = wire.fetchForContext('installation_1.1');
  const pending = fetch(`${apiOrigin}/v1/sessions/start`, init(abort.signal));
  await native.started.promise;
  assert.equal(native.bootstraps[0].context, 'installation_1.1');
  assert.equal(native.bootstraps[0].credential, credential);
  assert.equal(native.bootstraps[0].url, `${apiOrigin}/v1/sessions/start`);
  assert.equal(native.completions.length, 0);
  native.reply.resolve(response());
  const result = await pending;
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const reader = result.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(Buffer.from(first.value!).toString(), JSON.stringify(success()));
  assert.equal((await reader.read()).done, true);
  assert.equal(abort.listeners, 0);
});

test('abort remains wired until a delivered bootstrap body releases its reservation', async () => {
  const {native, wire} = fixture();
  await wire.bridge.install();
  const abort = abortFixture();
  const pending = wire.fetchForContext('installation_1.1')(
    `${apiOrigin}/v1/sessions/start`,
    init(abort.signal),
  );
  await native.started.promise;
  native.reply.resolve(response());
  const result = await pending;

  assert.equal(abort.listeners, 1);
  abort.abort();

  await assert.rejects(result.body!.getReader().read(), {
    code: 'NATIVE_ADMISSION_CANCELLED',
  });
  assert.equal(abort.listeners, 0);
});

test('abort before native dispatch creates no request; abort during native wait invalidates late bytes', async () => {
  for (const before of [true, false]) {
    const {native, wire} = fixture();
    await wire.bridge.install();
    const abort = abortFixture();
    if (before) abort.abort();
    const pending = wire.fetchForContext('installation_1.1')(
      `${apiOrigin}/v1/sessions/start`,
      init(abort.signal),
    );
    const rejected = assert.rejects(pending, {code: 'NATIVE_ADMISSION_CANCELLED'});
    if (!before) {
      await native.started.promise;
      abort.abort();
    }
    await rejected;
    native.reply.resolve(response());
    assert.equal(native.bootstraps.length, before ? 0 : 1);
    assert.equal(native.cancellations.length, before ? 0 : 1);
    assert.equal(abort.listeners, 0);
  }
});

test('bootstrap errors and malformed or oversized native payloads are secret-free', async () => {
  for (const invalid of ['error', 'base64', 'oversize', 'status'] as const) {
    const {native, wire} = fixture();
    await wire.bridge.install();
    const pending = wire.fetchForContext('installation_1.1')(
      `${apiOrigin}/v1/sessions/start`,
      init(abortFixture().signal),
    );
    const rejected = assert.rejects(pending, (error: unknown) => {
      assert.equal(String(error).includes(grant), false);
      assert.equal(JSON.stringify(error).includes(grant), false);
      return true;
    });
    await native.started.promise;
    if (invalid === 'error') native.reply.reject(new Error(grant));
    if (invalid === 'base64') native.reply.resolve({...response(), bodyBase64: grant});
    if (invalid === 'oversize')
      native.reply.resolve(response('x'.repeat(nativeBootstrapLimits.responseBytes + 1)));
    if (invalid === 'status') native.reply.resolve({...response(), status: 0});
    await rejected;
  }
});

test('another context or installation never reuses bootstrap request identity', async () => {
  const {native, wire} = fixture();
  await wire.bridge.install();
  const first = wire.fetchForContext('installation_1.1');
  const second = wire.fetchForContext('installation_1.2');
  const pending = [
    first(`${apiOrigin}/v1/sessions/start`, init(abortFixture().signal)),
    second(`${apiOrigin}/v1/sessions/start`, init(abortFixture().signal)),
  ];
  native.reply.resolve(response());
  await Promise.all(pending);
  assert.notEqual(native.bootstraps[0].request, native.bootstraps[1].request);
  assert.notEqual(native.bootstraps[0].context, native.bootstraps[1].context);
  await wire.bridge.remove(native.installation);
  await assert.rejects(first(`${apiOrigin}/v1/sessions/start`, init(abortFixture().signal)), {
    code: 'NATIVE_ADMISSION_CANCELLED',
  });
  assert.equal(native.bootstraps.length, 2);
});

test('the real controller reaches admission through the native bootstrap and batch boundary', async () => {
  const {native, wire} = fixture();
  const clock = createClock();
  const owner = createNativeAdmissionOwner({
    bridge: wire.bridge,
    sessionFetch: wire.fetchForContext,
  });
  const resource = {
    url: 'https://tiles.tileflow.test/world/0/0/0.pbf',
    scope: 'tile' as const,
    tilesetId: 'world',
  };
  const map = await owner.openMap({
    binding: {kind: 'hosted', apiOrigin, credential, mapId, surfaceId: 'store-locator'},
    now: clock.now,
    sessionIdFactory: createIds(),
    resources: [resource],
  });
  const batch = native.batch(map.context, [resource.url, resource.url]);
  await native.started.promise;
  assert.equal(native.bootstraps.length, 1);
  assert.equal(native.bootstraps[0].context, map.context);
  native.reply.resolve(response());
  const results = await batch.promise;
  assert.deepEqual(
    results.map((item) => item.kind),
    ['grant', 'grant'],
  );
  assert.equal(JSON.stringify(owner.state).includes(grant), false);
  await owner.dispose();
});
