import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostedNativeSessionController} from '../src/session-controller';
import {
  apiOrigin,
  createClock,
  createFetchQueue,
  createIds,
  credential,
  deferred,
  mapId,
  response,
  success,
} from './session-fixture';

function fixture() {
  const clock = createClock();
  const delivered = deferred<ReturnType<typeof response>>();
  const queue = createFetchQueue([() => delivered.promise]);
  const binding = {
    kind: 'hosted' as const,
    apiOrigin,
    credential,
    mapId,
    surfaceId: 'store-locator',
  };
  const controller = createHostedNativeSessionController({
    binding,
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  return {controller, clock, delivered, queue, binding};
}

test('transport validity is anchored to the existing bootstrap-start deadline, not receipt time', async () => {
  const f = fixture();
  const pending = f.controller.acquire();
  await f.queue.waitForCalls(1);
  f.clock.advance(120000);
  f.delivered.resolve(response(201, success()));
  const authority = await pending;
  assert.ok(authority);
  assert.equal(f.controller.transportBudget(authority), 780000);
  f.clock.advance(500);
  assert.equal(f.controller.transportBudget(authority), 779500);
  assert.equal(f.queue.calls.length, 1);
  f.controller.dispose();
});

test('expiry, backward clock movement and disposal return zero without exposing a deadline or grant', async () => {
  for (const invalidate of ['expiry', 'backward', 'dispose'] as const) {
    const f = fixture();
    f.delivered.resolve(response(201, success()));
    const authority = await f.controller.acquire();
    assert.ok(authority);
    assert.equal(f.controller.transportBudget(authority), 900000);
    if (invalidate === 'expiry') f.clock.advance(900000);
    if (invalidate === 'backward') f.clock.advance(-1);
    if (invalidate === 'dispose') f.controller.dispose();
    assert.equal(f.controller.transportBudget(authority), 0);
    assert.equal(f.queue.calls.length, 1);
    f.controller.dispose();
  }
});

test('binding retirement invalidates admitted authority but same-Map continuity does not', async () => {
  const f = fixture();
  f.delivered.resolve(response(201, success()));
  const authority = await f.controller.acquire();
  assert.ok(authority);
  f.controller.replaceBinding({...f.binding, surfaceId: 'another-theme'});
  assert.equal(f.controller.transportBudget(authority), 900000);
  f.controller.replaceBinding({kind: 'direct'});
  assert.equal(f.controller.transportBudget(authority), 0);
  f.controller.dispose();
});

test('another controller cannot grant validity to an authority it did not admit', async () => {
  const first = fixture();
  const second = fixture();
  first.delivered.resolve(response(201, success()));
  const authority = await first.controller.acquire();
  assert.ok(authority);
  assert.equal(second.controller.transportBudget(authority), 0);
  first.controller.dispose();
  second.controller.dispose();
});

test('background authority has no transport budget until foreground revalidation', async () => {
  const f = fixture();
  f.delivered.resolve(response(201, success()));
  const authority = await f.controller.acquire();
  assert.ok(authority);
  f.controller.background();
  assert.equal(f.controller.transportBudget(authority), 0);
  await f.controller.resume();
  assert.equal(f.controller.transportBudget(authority), 900000);
  assert.equal(f.queue.calls.length, 1);
  f.controller.dispose();
});
