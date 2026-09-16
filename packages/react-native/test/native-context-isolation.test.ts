import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {AdmissionBridgeDouble, styleResource} from './native-admission-fixture';
import {createClock, createIds, deferred} from './session-fixture';

test('a failed context cleanup cannot dispose another Map or silently retain its renderer', async () => {
  const bridge = new AdmissionBridgeDouble();
  const retired = deferred<void>();
  const original = bridge.retireContext.bind(bridge);
  let firstContext = '';
  let failFirst = true;
  bridge.retireContext = async (installation, context) => {
    if (context === firstContext && failFirst) {
      retired.resolve();
      throw new Error('Native cleanup failed.');
    }
    return original(installation, context);
  };
  const owner = createNativeAdmissionOwner({bridge});
  const input = {
    binding: {kind: 'direct' as const},
    resources: [styleResource],
    now: createClock().now,
    sessionIdFactory: createIds(),
  };
  let firstNotifications = 0;
  let secondNotifications = 0;
  const first = await owner.openMap({
    ...input,
    onRetired: () => {
      firstNotifications++;
    },
  });
  const second = await owner.openMap({
    ...input,
    onRetired: () => {
      secondNotifications++;
    },
  });
  firstContext = first.context;
  bridge.emit({
    kind: 'retired',
    installation: bridge.installation,
    context: first.context,
    generation: 1,
    code: 'NATIVE_ADMISSION_DENIED',
  });
  await retired.promise;
  await Promise.resolve();
  assert.equal(first.state.status, 'retired');
  assert.equal(second.state.status, 'active');
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);
  assert.deepEqual(
    (await bridge.batch(second.context, [styleResource.url]).promise).map((result) => result.kind),
    ['delegate'],
  );
  failFirst = false;
  await first.retire();
  assert.equal(firstNotifications, 1);
  await owner.dispose();
  assert.equal(secondNotifications, 1);
});
