import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedNativeSessionController,
  type HostedNativeSessionState,
} from '../src/session-controller';
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

for (const [status, errorCode, body] of [
  [401, 'NATIVE_SESSION_CREDENTIAL_REJECTED', null],
  [403, 'NATIVE_SESSION_MAP_MISMATCH', null],
  [429, 'NATIVE_SESSION_QUOTA_EXCEEDED', {code: 'COMMERCIAL_MAP_LIMIT_REACHED', error: 'quota'}],
] as const) {
  for (const rejectionFirst of [true, false]) {
    test(`${status} terminates the entire binding across rotation; rejection first: ${rejectionFirst}`, async () => {
      const clock = createClock();
      const oldReply = deferred<ReturnType<typeof response>>();
      const rotatedReply = deferred<ReturnType<typeof response>>();
      const replacementMapId = 'map_abcdef0123456789';
      const queue = createFetchQueue([
        () => oldReply.promise,
        () => rotatedReply.promise,
        response(
          201,
          success({
            mapId: replacementMapId,
            sessionId: 'ses_test_3',
          }),
        ),
      ]);
      const binding = {
        kind: 'hosted' as const,
        apiOrigin,
        credential,
        mapId,
        surfaceId: 'store-locator',
      };
      const controller = createHostedNativeSessionController({
        binding,
        now: clock.now,
        sessionIdFactory: createIds(),
        fetch: queue.fetch,
      });
      const states: HostedNativeSessionState[] = [];
      controller.subscribe((state) => states.push(state));
      try {
        const old = controller.acquire();
        const oldRejected = assert.rejects(old, {code: errorCode});
        await queue.waitForCalls(1);
        clock.advance(6 * 60 * 60 * 1000);
        const rotated = controller.acquire();
        const rotatedRejected = rejectionFirst ? assert.rejects(rotated, {code: errorCode}) : null;
        await queue.waitForCalls(2);
        const acceptedReply = response(
          201,
          success({
            sessionId: 'ses_test_2',
            issuedAt: clock.now().toISOString(),
            serverTime: clock.now().toISOString(),
            expiresAt: new Date(clock.value + 900_000).toISOString(),
          }),
        );
        if (!rejectionFirst) rotatedReply.resolve(acceptedReply);
        const admitted = rejectionFirst ? null : await rotated;
        if (admitted) assert.ok(controller.transportBudget(admitted) > 0);

        oldReply.resolve(response(status, body));
        await oldRejected;
        assert.equal(controller.state.status, 'error');
        if (rejectionFirst) {
          // Cancellation settles the waiter without waiting for the late network response.
          await rotatedRejected;
          assert.equal(queue.calls[1].init.signal.aborted, true);
          rotatedReply.resolve(acceptedReply);
        } else {
          assert.ok(admitted);
          assert.equal(controller.transportBudget(admitted), 0);
        }
        const afterRejection = states.length;
        controller.background();
        await assert.rejects(controller.resume(), {code: errorCode});
        assert.equal(controller.state.lifecycle, 'foreground');
        await assert.rejects(controller.acquire(), {code: errorCode});
        assert.equal(controller.state.status, 'error');
        assert.ok(states.slice(afterRejection).every((state) => state.status === 'error'));
        assert.equal(queue.calls.length, 2);

        controller.replaceBinding({...binding, mapId: replacementMapId});
        const replacement = await controller.acquire();
        assert.equal(replacement?.mapId, replacementMapId);
        assert.equal(controller.state.status, 'ready');
        assert.equal(queue.calls.length, 3);
      } finally {
        controller.dispose();
      }
    });
  }
}

test('an error observer can replace the rejected binding without poisoning its replacement', async () => {
  const replacementMapId = 'map_abcdef0123456789';
  const queue = createFetchQueue([
    response(401, null),
    response(201, success({mapId: replacementMapId, sessionId: 'ses_test_2'})),
  ]);
  const binding = {
    kind: 'hosted' as const,
    apiOrigin,
    credential,
    mapId,
    surfaceId: 'store-locator',
  };
  const controller = createHostedNativeSessionController({
    binding,
    now: createClock().now,
    sessionIdFactory: createIds(),
    fetch: queue.fetch,
  });
  controller.subscribe((state) => {
    if (state.status === 'error') {
      controller.replaceBinding({...binding, mapId: replacementMapId});
    }
  });
  try {
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_CREDENTIAL_REJECTED'});
    assert.equal(controller.state.status, 'idle');
    assert.equal((await controller.acquire())?.mapId, replacementMapId);
    assert.equal(controller.state.status, 'ready');
  } finally {
    controller.dispose();
  }
});
