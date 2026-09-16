import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionWire} from '../src/native-admission-wire';
import type {
  NativeAdmissionNativeModule,
  NativeBootstrapReply,
} from '../src/native-bootstrap-contract';
import type {HostedNativeSessionFetchInit} from '../src/session-controller';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, credential, deferred, mapId} from './session-fixture';

class ModuleDouble extends AdmissionBridgeDouble implements NativeAdmissionNativeModule {
  readonly waiting = new Map<string, ReturnType<typeof deferred<NativeBootstrapReply>>>();
  readonly cancellations: Array<{context: string; request: string}> = [];
  retireGate: Promise<void> | undefined;
  async bootstrap(
    _installation: string,
    _context: string,
    request: string,
    _url: string,
    _credential: string,
    _body: string,
  ) {
    const pending = deferred<NativeBootstrapReply>();
    this.waiting.set(request, pending);
    return pending.promise;
  }
  async cancelBootstrap(
    _installation: string,
    context: string,
    request: string,
  ): Promise<{cancelled: true}> {
    this.cancellations.push({context, request});
    return {cancelled: true};
  }
  override async retireContext(installation: string, context: string): Promise<{retired: true}> {
    await this.retireGate;
    return super.retireContext(installation, context);
  }
}
function fixture() {
  const native = new ModuleDouble();
  const wire = createNativeAdmissionWire(native, (listener) => native.subscribe(listener));
  const init: HostedNativeSessionFetchInit = {
    body: JSON.stringify({mapId, sessionId: 'ses_1', surfaceId: 'default'}),
    method: 'POST',
    credentials: 'omit',
    headers: {'X-Tileflow-Mobile-Client': credential, 'Content-Type': 'application/json'},
    signal: {aborted: false, addEventListener() {}, removeEventListener() {}},
  };
  return {native, wire, init};
}
const reply = {status: 201, cacheControl: 'no-store', bodyBase64: 'e30='};

test('a reader delivered before removal cannot expose bytes after installation retirement', async () => {
  const {native, wire, init} = fixture();
  await wire.bridge.install();
  const pending = wire.fetchForContext('installation_1.1')(`${apiOrigin}/v1/sessions/start`, init);
  native.waiting.values().next().value!.resolve(reply);
  const response = await pending;
  await wire.bridge.remove(native.installation);
  await assert.rejects(response.body!.getReader().read(), {code: 'NATIVE_ADMISSION_CANCELLED'});
});

test('context retirement invalidates pending callbacks immediately but acknowledges only native completion', async () => {
  const {native, wire, init} = fixture();
  await wire.bridge.install();
  const first = wire.fetchForContext('installation_1.1');
  const second = wire.fetchForContext('installation_1.2');
  const a = first(`${apiOrigin}/v1/sessions/start`, init);
  const b = second(`${apiOrigin}/v1/sessions/start`, init);
  const rejected = assert.rejects(a, {code: 'NATIVE_ADMISSION_CANCELLED'});
  const retired = deferred<void>();
  native.retireGate = retired.promise;
  let acknowledged = false;
  const retirement = wire.bridge.retireContext(native.installation, 'installation_1.1').then(() => {
    acknowledged = true;
  });
  await rejected;
  assert.equal(acknowledged, false);
  assert.equal(native.cancellations.length, 1);
  assert.equal(native.cancellations[0].context, 'installation_1.1');
  for (const request of native.waiting.values()) request.resolve(reply);
  assert.equal((await b).status, 201);
  retired.resolve();
  await retirement;
  await assert.rejects(first(`${apiOrigin}/v1/sessions/start`, init), {
    code: 'NATIVE_ADMISSION_CANCELLED',
  });
  await wire.bridge.remove(native.installation);
});

test('bridge bootstrap calls are bounded even before the native module can process them', async () => {
  const {native, wire, init} = fixture();
  await wire.bridge.install();
  const fetch = wire.fetchForContext('installation_1.1');
  const waiting = Array.from({length: 32}, () => fetch(`${apiOrigin}/v1/sessions/start`, init));
  const rejections = waiting.map((pending) =>
    assert.rejects(pending, {code: 'NATIVE_ADMISSION_CANCELLED'}),
  );
  await assert.rejects(fetch(`${apiOrigin}/v1/sessions/start`, init), {
    code: 'NATIVE_ADMISSION_UNAVAILABLE',
  });
  assert.equal(native.waiting.size, 32);
  await wire.bridge.remove(native.installation);
  await Promise.all(rejections);
  assert.equal(native.cancellations.length, 32);
  for (const request of native.waiting.values()) request.resolve(reply);
});
