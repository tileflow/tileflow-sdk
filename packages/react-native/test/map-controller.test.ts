import assert from 'node:assert/strict';
import test from 'node:test';
import {MapController} from '../src/map-controller';
import type {Spec} from '../src/specs/NativeTileflowMapModule';

function harness(call: Spec['call'] = async () => 'null') {
  const calls: Parameters<Spec['call']>[] = [];
  const controller = new MapController(
    'mount-a',
    () => ({
      call: async (...args) => {
        calls.push(args);
        return call(...args);
      },
    }),
    () => {},
  );
  return {controller, calls};
}

test('commands wait for this mount and its ready event', async () => {
  const {controller, calls} = harness();
  const camera = controller.call('getCamera', {});
  controller.attach(12);
  assert.equal(controller.receive('old-mount', 'contentReady', {}), false);
  assert.equal(calls.length, 0);
  controller.receive('mount-a', 'contentReady', {});
  await camera;
  assert.deepEqual(calls, [[12, 'mount-a', 'getCamera', '{}']]);
});

test('an in-flight animation does not delay a newer movement', async () => {
  let finish: (value: string) => void = () => {};
  const {controller, calls} = harness(async (_tag, _id, _method, payload) => {
    if (JSON.parse(payload).zoomLevel === 5)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return 'null';
  });
  controller.attach(12);
  controller.receive('mount-a', 'contentReady', {});
  const first = controller.call('setCamera', {zoomLevel: 5});
  await controller.call('setCamera', {zoomLevel: 7});
  assert.equal(calls.length, 2);
  finish('null');
  await first;
});

test('retirement rejects queued and in-flight calls and ignores late events', async () => {
  const {controller} = harness(async () => new Promise(() => {}));
  const queued = controller.call('getCamera', {});
  controller.attach(12);
  const queueFailure = assert.rejects(queued, {code: 'disposed'});
  controller.dispose();
  await queueFailure;
  assert.equal(controller.receive('mount-a', 'contentReady', {}), false);
  const live = harness(async () => new Promise(() => {})).controller;
  live.attach(12);
  live.receive('mount-a', 'contentReady', {});
  const pending = assert.rejects(live.call('getCamera', {}), {code: 'disposed'});
  live.dispose();
  await pending;
});

test('development ref replay preserves the native mount', async () => {
  const {controller} = harness();
  controller.attach(12);
  controller.receive('mount-a', 'contentReady', {});
  controller.attach(null);
  controller.attach(12);
  await Promise.resolve();
  assert.equal(controller.isDisposed, false);
  await controller.call('getCamera', {});
  controller.attach(null);
  await Promise.resolve();
  assert.equal(controller.isDisposed, true);
});

test('a load failure rejects queued work while explicit reload and permission remain available', async () => {
  const {controller, calls} = harness();
  controller.attach(12);
  const pending = assert.rejects(controller.call('getCamera', {}), {code: 'accessDenied'});
  controller.receive('mount-a', 'failed', {
    code: 'accessDenied',
    message: 'Unavailable',
    recoverable: false,
  });
  await pending;
  await controller.call('reload', {});
  await controller.call('requestLocationPermission', {});
  assert.deepEqual(
    calls.map((args) => args[2]),
    ['reload', 'requestLocationPermission'],
  );
});

test('non-finite arguments are rejected without turning them into null', async () => {
  const {controller, calls} = harness();
  controller.attach(12);
  controller.receive('mount-a', 'contentReady', {});
  for (const zoomLevel of [NaN, Infinity, -Infinity]) {
    await assert.rejects(controller.call('setCamera', {zoomLevel}), {code: 'invalidRequest'});
  }
  assert.deepEqual(calls, []);
});
