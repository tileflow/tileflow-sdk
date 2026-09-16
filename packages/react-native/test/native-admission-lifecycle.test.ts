import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionWire} from '../src/native-admission-wire';
import type {
  NativeAdmissionNativeModule,
  NativeBootstrapReply,
} from '../src/native-bootstrap-contract';
import {AdmissionBridgeDouble} from './native-admission-fixture';

class ModuleDouble extends AdmissionBridgeDouble implements NativeAdmissionNativeModule {
  async bootstrap(): Promise<NativeBootstrapReply> {
    throw new Error('Unexpected bootstrap.');
  }
  async cancelBootstrap(): Promise<{cancelled: true}> {
    return {cancelled: true};
  }
}

test('native lifecycle is observable privately without identifying Map contexts', async () => {
  const native = new ModuleDouble();
  const wire = createNativeAdmissionWire(native, (listener) => native.subscribe(listener));
  const lifecycle: boolean[] = [];
  const release = wire.subscribeLifecycle((foreground) => lifecycle.push(foreground));
  const unsubscribe = wire.bridge.subscribe(() => undefined);
  await wire.bridge.install();
  native.listener({kind: 'lifecycle', installation: native.installation, foreground: false});
  native.listener({kind: 'lifecycle', installation: native.installation, foreground: true});
  assert.deepEqual(lifecycle, [false, true]);
  assert.equal(JSON.stringify(lifecycle).includes('context'), false);
  release();
  native.listener({kind: 'lifecycle', installation: native.installation, foreground: false});
  assert.deepEqual(lifecycle, [false, true]);
  await wire.bridge.remove(native.installation);
  unsubscribe();
});
