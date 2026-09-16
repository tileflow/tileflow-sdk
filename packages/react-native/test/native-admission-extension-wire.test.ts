import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionWire} from '../src/native-admission-wire';
import type {NativeAdmissionNativeModule} from '../src/native-bootstrap-contract';
import {deferred} from './session-fixture';

test('resource extension waits for its exact native context receipt', async () => {
  const receipt = deferred<{resources: number}>();
  const calls: unknown[][] = [];
  const native = {
    extendContext(...args: unknown[]) {
      calls.push(args);
      return receipt.promise;
    },
  } as unknown as NativeAdmissionNativeModule;
  const wire = createNativeAdmissionWire(native, () => () => undefined);
  const resources = [
    {url: 'https://maps.example.test/maps/main/style.json', scope: 'style' as const},
  ];
  let settled = false;
  const result = wire.bridge.extendContext!('installation', 'context', resources).then((value) => {
    settled = true;
    return value;
  });
  assert.equal(settled, false);
  assert.deepEqual(calls, [['installation', 'context', resources]]);
  receipt.resolve({resources: 2});
  assert.deepEqual(await result, {resources: 2});
});

test('missing or rejecting extension capability fails with a fixed value-free diagnostic', async () => {
  for (const native of [
    {},
    {
      extendContext() {
        throw new Error('Untrusted native detail.');
      },
    },
  ]) {
    const wire = createNativeAdmissionWire(
      native as unknown as NativeAdmissionNativeModule,
      () => () => undefined,
    );
    await assert.rejects(wire.bridge.extendContext!('installation', 'context', []), {
      code: 'NATIVE_ADMISSION_UNAVAILABLE',
      message: 'Native resource admission failed.',
    });
  }
});
