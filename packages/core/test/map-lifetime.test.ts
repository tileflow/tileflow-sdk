import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowMapLifetime} from '../src/map-lifetime';

test('map disposal aborts before releasing every resource in reverse acquisition order', () => {
  const reports: unknown[] = [];
  const lifetime = createTileflowMapLifetime({onCleanupError: (error) => reports.push(error)});
  const released: number[] = [];
  const failure = new Error('One resource failed to close');
  lifetime.defer(() => {
    assert.equal(lifetime.signal.aborted, true);
    released.push(1);
  });
  lifetime.defer(() => {
    released.push(2);
    throw failure;
  });
  lifetime.defer(() => released.push(3));

  lifetime.dispose();
  lifetime.dispose();

  assert.deepEqual(released, [3, 2, 1]);
  assert.deepEqual(reports, [failure]);
});

test('external cancellation rejects a pending loader promptly and observes its later failure', async () => {
  const abort = new AbortController();
  const lifetime = createTileflowMapLifetime({signal: abort.signal, onCleanupError: assert.fail});
  let rejectLoader!: (error: unknown) => void;
  const loader = new Promise<string>((_resolve, reject) => {
    rejectLoader = reject;
  });
  const pending = lifetime.wait(loader);
  const reason = new DOMException('The map was replaced.', 'AbortError');
  abort.abort(reason);
  await assert.rejects(pending, (error) => error === reason);

  rejectLoader(new Error('Late loader failure'));
  await Promise.resolve();
});

test('resources acquired after cancellation are released immediately', () => {
  const abort = new AbortController();
  abort.abort();
  const lifetime = createTileflowMapLifetime({signal: abort.signal, onCleanupError: assert.fail});
  let releases = 0;
  lifetime.defer(() => releases++);
  lifetime.dispose();
  assert.equal(releases, 1);
  assert.equal(lifetime.signal.aborted, true);
});

test('normal loader completion removes its abort subscription and leaves resources owned', async () => {
  const lifetime = createTileflowMapLifetime({onCleanupError: assert.fail});
  let releases = 0;
  lifetime.defer(() => releases++);
  assert.equal(await lifetime.wait(Promise.resolve('loaded')), 'loaded');
  assert.equal(releases, 0);
  lifetime.dispose();
  assert.equal(releases, 1);
});
