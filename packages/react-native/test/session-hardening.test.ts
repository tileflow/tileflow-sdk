import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedNativeSessionController,
  HostedNativeSessionError,
} from '../src/session-controller';
import {
  apiOrigin,
  assertSafeState,
  createClock,
  createFetchQueue,
  createIds,
  credential,
  deferred,
  grant,
  mapId,
  response,
  success,
} from './session-fixture';

const hosted = (surfaceId: string | undefined = 'store-locator') => ({
  kind: 'hosted' as const,
  apiOrigin,
  credential,
  mapId,
  surfaceId,
});

async function rejectedCode(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof HostedNativeSessionError);
  assert.equal(caught.message.includes(credential), false);
  assert.equal(caught.message.includes(grant), false);
  return caught.code;
}

test('safe observable state contains identities only and retains a bounded error across lifecycle changes', async () => {
  const queue = createFetchQueue([
    response(503, {code: 'MOBILE_SESSION_UNAVAILABLE', error: `${credential}${grant}`}),
    response(201, success()),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_UNAVAILABLE');
  assert.equal(controller.state.status, 'error');
  assertSafeState(controller.state, [credential, grant]);
  assert.equal(JSON.stringify(controller.state).includes('requestCount'), false);
  assert.equal(JSON.stringify(controller.state).includes('expiresAt'), false);

  controller.background();
  assert.equal(controller.state.status, 'error');
  assert.equal(controller.state.lifecycle, 'background');
  await controller.resume();
  assert.equal(controller.state.status, 'error');
  assert.equal(controller.state.lifecycle, 'foreground');

  const authority = await controller.acquire();
  assert.ok(authority);
  assert.equal(authority.grant, grant);
  assert.equal(Object.keys(authority).includes('grant'), false);
  assert.equal(JSON.stringify(authority).includes(grant), false);
  assert.equal(controller.state.status, 'ready');
  assertSafeState(controller.state, [credential, grant]);
  assert.equal(JSON.stringify(controller.state).includes('requestCount'), false);
  assert.equal(JSON.stringify(controller.state).includes('expiresAt'), false);
});

test('invalid Surface is normalized in the bootstrap body and response origins must be canonical origin strings', async () => {
  for (const surfaceId of ['INVALID SURFACE', credential]) {
    const normalizedQueue = createFetchQueue([
      response(201, success({surfaceId: 'default'})),
    ]);
    const normalized = createHostedNativeSessionController({
      binding: hosted(surfaceId),
      fetch: normalizedQueue.fetch,
      now: createClock().now,
      sessionIdFactory: createIds(),
    });
    await normalized.acquire();
    assert.deepEqual(JSON.parse(normalizedQueue.calls[0].init.body), {
      mapId,
      sessionId: 'ses_test_1',
      surfaceId: 'default',
    });
  }

  const invalidOrigin = createHostedNativeSessionController({
    binding: hosted(),
    fetch: createFetchQueue([
      response(201, success({resourceOrigins: ['https://api.tileflow.test/']})),
    ]).fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await rejectedCode(invalidOrigin.acquire()), 'NATIVE_SESSION_RESPONSE_INVALID');
});

test('Map, session and server identity fields reject secret-shaped values before they can reach safe state', async () => {
  for (const invalidMapId of [credential, 'map_short']) {
    assert.throws(
      () =>
        createHostedNativeSessionController({
          binding: {...hosted(), mapId: invalidMapId},
          fetch: createFetchQueue([]).fetch,
          now: createClock().now,
          sessionIdFactory: createIds(),
        }),
      (error: unknown) =>
        error instanceof HostedNativeSessionError &&
        error.code === 'NATIVE_SESSION_INPUT_INVALID',
    );
  }
  for (const generated of [credential, grant]) {
    assert.throws(
      () =>
        createHostedNativeSessionController({
          binding: hosted(),
          fetch: createFetchQueue([]).fetch,
          now: createClock().now,
          sessionIdFactory: () => generated,
        }),
      (error: unknown) =>
        error instanceof HostedNativeSessionError &&
        error.code === 'NATIVE_SESSION_INPUT_INVALID',
    );
  }
  for (const overrides of [{surfaceId: credential}, {credentialId: credential}]) {
    const controller = createHostedNativeSessionController({
      binding: hosted(),
      fetch: createFetchQueue([response(201, success(overrides))]).fetch,
      now: createClock().now,
      sessionIdFactory: createIds(),
    });
    assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_RESPONSE_INVALID');
  }
});

test('restart authority requires the exact bounded server shape rather than only matching code fields', async () => {
  const queue = createFetchQueue([
    response(409, {
      code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
      error: 'restart',
      retryWithNewSession: true,
      sessionId: 'ses_test_1',
      unexpected: true,
    }),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_REJECTED');
  assert.equal(queue.calls.length, 1);
});

test('clock rollback while bootstrap is pending still forces fresh authority before acquire returns', async () => {
  const clock = createClock();
  const pending = deferred<ReturnType<typeof response>>();
  const queue = createFetchQueue([
    () => pending.promise,
    response(201, success()),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });

  const acquisition = controller.acquire();
  await queue.waitForCalls(1);
  clock.set(Date.parse('2026-09-15T19:00:00.000Z'));
  pending.resolve(response(201, success()));
  const authority = await acquisition;
  assert.equal(authority?.sessionId, 'ses_test_1');
  assert.equal(queue.calls.length, 2);
});

test('unmetered disposition is accepted only with disabled metering', async () => {
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: createFetchQueue([
      response(201, success({meterMode: 'shadow', disposition: 'unmetered'})),
    ]).fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_RESPONSE_INVALID');
});

test('constructor captures injected dependencies so later caller mutation cannot retarget session work', async () => {
  const queue = createFetchQueue([response(201, success())]);
  const clock = createClock();
  const dependencies = {
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  };
  const controller = createHostedNativeSessionController(dependencies);
  dependencies.fetch = async () => {
    throw new Error(credential);
  };
  dependencies.now = () => {
    throw new Error(grant);
  };
  dependencies.sessionIdFactory = () => credential;
  const authority = await controller.acquire();
  assert.equal(authority?.sessionId, 'ses_test_1');
  assert.equal(queue.calls.length, 1);
});

test('rotation and restart cannot reuse an already issued session identity', async () => {
  const clock = createClock();
  const queue = createFetchQueue([response(201, success({sessionId: 'ses_same'}))]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: () => 'ses_same',
  });
  await controller.acquire();
  clock.advance(6 * 60 * 60 * 1000);
  assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_INPUT_INVALID');
  assert.equal(queue.calls.length, 1);
});

test('injected clock and fetch failures are normalized without exposing causes or authority material', async () => {
  assert.throws(
    () =>
      createHostedNativeSessionController({
        binding: hosted(),
        fetch: async () => {
          throw new Error(credential);
        },
        now: () => {
          throw new Error(grant);
        },
        sessionIdFactory: createIds(),
      }),
    (error: unknown) =>
      error instanceof HostedNativeSessionError &&
      error.code === 'NATIVE_SESSION_INPUT_INVALID' &&
      !error.message.includes(grant),
  );

  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: async () => {
      throw new Error(`${credential}${grant}`);
    },
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_UNAVAILABLE');
  assertSafeState(controller.state, [credential, grant]);
});
