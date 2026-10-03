import assert from 'node:assert/strict';
import test from 'node:test';
import {cancelNativeOperation, NativeSourceCancellation} from '../src/native-source-cancellation';
import {deferred} from './native-manifest-fixture';

test('retirement is idempotent and fires each active cancellation hook once', () => {
  const scope = new NativeSourceCancellation();
  let calls = 0;
  scope.onCancel(() => {
    calls++;
  });
  const off = scope.onCancel(() => {
    calls += 10;
  });
  off();
  off();
  scope.cancel();
  scope.cancel();
  assert.equal(calls, 1);
  assert.equal(scope.aborted, true);
  assert.throws(() => scope.check(), {code: 'NATIVE_SOURCE_ABORTED'});
});

test('a hanging operation settles on cancellation and its late rejection remains handled', async () => {
  const scope = new NativeSourceCancellation();
  const operation = deferred<string>();
  const result = scope.race(operation.promise);
  scope.cancel();
  await assert.rejects(result, {code: 'NATIVE_SOURCE_ABORTED'});
  operation.reject(new Error('late secret'));
});

test('pre-cancellation still observes a future rejection', async () => {
  const scope = new NativeSourceCancellation();
  scope.cancel();
  const operation = deferred<string>();
  const result = scope.race(operation.promise);
  await assert.rejects(result, {code: 'NATIVE_SOURCE_ABORTED'});
  operation.reject(new Error('ignored abort'));
});

test('settled operations are not retroactively cancelled', async () => {
  const scope = new NativeSourceCancellation();
  assert.equal(await scope.race(Promise.resolve('done')), 'done');
  scope.cancel();
});

test('signal linking never reads the cancellation reason', async () => {
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'reason', {
    get() {
      throw new Error('private reason');
    },
  });
  const scope = new NativeSourceCancellation();
  const detach = scope.link(controller.signal);
  const operation = deferred<string>();
  const result = scope.race(operation.promise);
  controller.abort();
  await assert.rejects(result, {code: 'NATIVE_SOURCE_ABORTED'});
  detach();
  detach();
  operation.resolve('late');
});

test('unlinking a signal and cleanup failures cannot affect another scope', () => {
  const signal = new AbortController();
  const first = new NativeSourceCancellation();
  const second = new NativeSourceCancellation();
  const detach = first.link(signal.signal);
  detach();
  second.link(signal.signal);
  second.onCancel(() => {
    throw new Error('cleanup');
  });
  signal.abort();
  assert.equal(first.aborted, false);
  assert.equal(second.aborted, true);
});

test('cleanup is best effort even for rejected or never-settling promises', () => {
  cancelNativeOperation(() => {
    throw new Error('private');
  });
  cancelNativeOperation(() => Promise.reject(new Error('private')));
  cancelNativeOperation(() => new Promise<void>(() => undefined));
});

test('malformed cancellation signals fail with a sanitized local error', () => {
  const scope = new NativeSourceCancellation();
  assert.throws(() => scope.link(null as never), {code: 'NATIVE_SOURCE_INVALID', field: 'signal'});
  assert.throws(
    () =>
      scope.link({
        get aborted() {
          throw new Error('private');
        },
      } as never),
    {code: 'NATIVE_SOURCE_INVALID', field: 'signal'},
  );
});
