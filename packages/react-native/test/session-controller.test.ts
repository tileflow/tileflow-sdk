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

const hosted = () => ({
  kind: 'hosted' as const,
  apiOrigin,
  credential,
  mapId,
  surfaceId: 'store-locator',
});

async function errorCode(operation: Promise<unknown>) {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof HostedNativeSessionError);
  return {code: caught.code, kind: caught.kind, message: caught.message};
}

test('constructs only the accepted native bootstrap request and publishes secret-free state', async () => {
  const clock = createClock();
  const queue = createFetchQueue([response(201, success())]);
  const states: unknown[] = [];
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  controller.subscribe((state) => states.push(state));

  const authority = await controller.acquire();
  assert.ok(authority);
  assert.equal(authority.grant, grant);
  assert.equal(authority.sessionId, 'ses_test_1');
  assert.equal(authority.surfaceId, 'store-locator');
  assert.deepEqual(authority.resourceScopes, [
    'style',
    'tilejson',
    'tile',
    'sprite',
    'glyph',
    'font',
  ]);
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.resourceOrigins), true);

  assert.equal(queue.calls.length, 1);
  const [call] = queue.calls;
  assert.equal(call.url, `${apiOrigin}/v1/sessions/start`);
  assert.deepEqual(call.init.headers, {
    'Content-Type': 'application/json',
    'X-Tileflow-Mobile-Client': credential,
  });
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.credentials, 'omit');
  assert.deepEqual(JSON.parse(call.init.body), {
    mapId,
    sessionId: 'ses_test_1',
    surfaceId: 'store-locator',
  });
  assert.equal(
    Object.keys(call.init).sort().join(','),
    'body,credentials,headers,method,signal',
  );
  const signal = call.init.signal as typeof call.init.signal & {fire?: () => void};
  assert.equal(Object.isFrozen(signal), true);
  assert.equal(signal.fire, undefined);
  assert.equal(signal.aborted, false);
  assert.throws(() => Object.assign(signal, {aborted: true}));
  assert.equal(signal.aborted, false);

  assert.equal(controller.state.status, 'ready');
  assertSafeState(controller.state, [credential, grant]);
  for (const state of states) assertSafeState(state as never, [credential, grant]);
});

test('normalizes Surface and rejects malformed credentials and non-canonical trusted origins before fetch', async () => {
  const queue = createFetchQueue([]);
  const valid = createHostedNativeSessionController({
    binding: {...hosted(), surfaceId: 'INVALID SURFACE'},
    fetch: queue.fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(valid.state.status, 'idle');

  for (const binding of [
    {...hosted(), credential: `tf_public_${'A'.repeat(48)}`},
    {...hosted(), credential: `tf_public_${'a'.repeat(47)}`},
    {...hosted(), apiOrigin: 'http://api.tileflow.test'},
    {...hosted(), apiOrigin: 'https://api.tileflow.test/path'},
    {...hosted(), apiOrigin: 'https://user:pass@api.tileflow.test'},
  ]) {
    assert.throws(
      () =>
        createHostedNativeSessionController({
          binding,
          fetch: queue.fetch,
          now: createClock().now,
          sessionIdFactory: createIds(),
        }),
      (error: unknown) =>
        error instanceof HostedNativeSessionError &&
        error.code === 'NATIVE_SESSION_INPUT_INVALID',
    );
  }
  assert.equal(queue.calls.length, 0);
});

test('enforces actual-byte, UTF-8, JSON and strict success-response bounds', async () => {
  const oversized = new Uint8Array(65_537).fill(0x61);
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
  const cases = [
    {
      response: response(201, '', {chunks: [oversized]}),
      code: 'NATIVE_SESSION_RESPONSE_TOO_LARGE',
    },
    {
      response: response(201, '', {chunks: [invalidUtf8]}),
      code: 'NATIVE_SESSION_RESPONSE_UTF8_INVALID',
    },
    {response: response(201, '{'), code: 'NATIVE_SESSION_RESPONSE_JSON_INVALID'},
    {
      response: response(201, success({unexpected: true})),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(201, success({grant: 'x'.repeat(24_577)})),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(201, success({resourceOrigins: ['https://api.tileflow.test/path']})),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(
        201,
        success({
          resourceOrigins: [
            'https://api.tileflow.test',
            'https://tiles.tileflow.test',
            'https://third.tileflow.test',
          ],
        }),
      ),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(201, success({resourceScopes: ['style', 'admin']})),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(
        201,
        success({tilesetIds: Array.from({length: 19}, (_, index) => `tls_${index}`)}),
      ),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
    {
      response: response(201, success(), {
        headers: {'cache-control': 'public, max-age=60'},
      }),
      code: 'NATIVE_SESSION_RESPONSE_INVALID',
    },
  ];
  for (const item of cases) {
    const controller = createHostedNativeSessionController({
      binding: hosted(),
      fetch: createFetchQueue([item.response]).fetch,
      now: createClock().now,
      sessionIdFactory: createIds(),
    });
    assert.equal((await errorCode(controller.acquire())).code, item.code);
    assertSafeState(controller.state, [credential, grant]);
  }
});

test('rejects binding/time mismatches and never extends lifetime when the device clock moves backwards', async () => {
  const mismatchCases = [
    {mapId: 'map_other'},
    {sessionId: 'ses_other'},
    {surfaceId: 'other-surface'},
    {kind: 'web'},
    {usageMode: 'request'},
    {counted: true},
    {issuedAt: '2026-09-15T20:16:00.000Z'},
    {serverTime: '2026-09-15T19:59:00.000Z'},
    {expiresAt: '2026-09-15T20:00:00.000Z'},
  ];
  for (const overrides of mismatchCases) {
    const controller = createHostedNativeSessionController({
      binding: hosted(),
      fetch: createFetchQueue([response(201, success(overrides))]).fetch,
      now: createClock().now,
      sessionIdFactory: createIds(),
    });
    assert.equal((await errorCode(controller.acquire())).code, 'NATIVE_SESSION_RESPONSE_INVALID');
  }

  const clock = createClock();
  const queue = createFetchQueue([
    response(201, success()),
    response(
      201,
      success({
        serverTime: '2026-09-15T20:15:00.000Z',
        issuedAt: '2026-09-15T20:15:00.000Z',
        expiresAt: '2026-09-15T20:30:00.000Z',
      }),
    ),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  await controller.acquire();
  clock.advance(14 * 60_000 + 31_000);
  clock.set(Date.parse('2026-09-15T19:00:00.000Z'));
  await controller.acquire();
  assert.equal(queue.calls.length, 2);
});

test('binds every success response to the exact Surface sent in that bootstrap or refresh', async () => {
  const firstMismatch = createHostedNativeSessionController({
    binding: hosted(),
    fetch: createFetchQueue([response(201, success({surfaceId: 'other-surface'}))]).fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(
    (await errorCode(firstMismatch.acquire())).code,
    'NATIVE_SESSION_RESPONSE_INVALID',
  );

  const clock = createClock();
  const queue = createFetchQueue([
    response(201, success()),
    response(
      201,
      success({
        surfaceId: 'other-surface',
        issuedAt: '2026-09-15T20:14:31.000Z',
        serverTime: '2026-09-15T20:14:31.000Z',
        expiresAt: '2026-09-15T20:29:31.000Z',
      }),
    ),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  await controller.acquire();
  clock.advance(14 * 60_000 + 31_000);
  assert.equal(
    (await errorCode(controller.acquire())).code,
    'NATIVE_SESSION_RESPONSE_INVALID',
  );
  assert.deepEqual(JSON.parse(queue.calls[1].init.body), {
    mapId,
    sessionId: 'ses_test_1',
    surfaceId: 'store-locator',
  });
});

test('network latency cannot extend authority beyond the server expiry window', async () => {
  const clock = createClock();
  const first = deferred<ReturnType<typeof response>>();
  const queue = createFetchQueue([
    () => first.promise,
    response(
      201,
      success({
        issuedAt: '2026-09-15T20:15:10.000Z',
        serverTime: '2026-09-15T20:15:10.000Z',
        expiresAt: '2026-09-15T20:30:10.000Z',
      }),
    ),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });

  const initial = controller.acquire();
  await queue.waitForCalls(1);
  clock.advance(60_000);
  first.resolve(response(201, success()));
  assert.equal((await initial)?.sessionId, 'ses_test_1');

  clock.advance(14 * 60_000 + 10_000);
  const refreshed = await controller.acquire();
  assert.equal(refreshed?.sessionId, 'ses_test_1');
  assert.equal(queue.calls.length, 2);
});

test('coalesces concurrent bootstrap and ordinary refresh while preserving the exact Surface and session', async () => {
  const clock = createClock();
  const first = deferred<ReturnType<typeof response>>();
  const queue = createFetchQueue([
    () => first.promise,
    response(
      201,
      success({
        serverTime: '2026-09-15T20:15:00.000Z',
        issuedAt: '2026-09-15T20:15:00.000Z',
        expiresAt: '2026-09-15T20:30:00.000Z',
      }),
    ),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  const one = controller.acquire();
  const two = controller.acquire();
  await queue.waitForCalls(1);
  assert.equal(queue.calls.length, 1);
  first.resolve(response(201, success()));
  const [a, b] = await Promise.all([one, two]);
  assert.equal(a?.grant, b?.grant);
  assert.equal(a?.sessionId, 'ses_test_1');
  assert.equal(a?.surfaceId, 'store-locator');

  clock.advance(14 * 60_000 + 31_000);
  const refreshes = await Promise.all([
    controller.acquire(),
    controller.acquire(),
    controller.acquire(),
  ]);
  assert.equal(queue.calls.length, 2);
  assert.equal(refreshes.every((value) => value?.sessionId === 'ses_test_1'), true);
  assert.deepEqual(JSON.parse(queue.calls[1].init.body), {
    mapId,
    sessionId: 'ses_test_1',
    surfaceId: 'store-locator',
  });
});

test('retries only the exact restart response once with a new session identity', async () => {
  const restart = response(409, {
    code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
    error: 'ignored',
    retryWithNewSession: true,
    sessionId: 'ses_test_1',
  });
  const queue = createFetchQueue([
    restart,
    response(201, success({sessionId: 'ses_test_2'})),
  ]);
  const controller = createHostedNativeSessionController({
    binding: hosted(),
    fetch: queue.fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  const authority = await controller.acquire();
  assert.equal(authority?.sessionId, 'ses_test_2');
  assert.equal(queue.calls.length, 2);

  for (const [status, body, code] of [
    [
      409,
      {
        code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
        retryWithNewSession: false,
        sessionId: 'ses_test_1',
      },
      'NATIVE_SESSION_REJECTED',
    ],
    [
      409,
      {
        code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
        retryWithNewSession: true,
        sessionId: 'ses_wrong',
      },
      'NATIVE_SESSION_REJECTED',
    ],
    [429, {code: 'COMMERCIAL_MAP_LIMIT_REACHED'}, 'NATIVE_SESSION_QUOTA_EXCEEDED'],
    [401, {code: 'MOBILE_CREDENTIAL_INVALID'}, 'NATIVE_SESSION_CREDENTIAL_REJECTED'],
    [503, {code: 'MOBILE_SESSION_UNAVAILABLE'}, 'NATIVE_SESSION_UNAVAILABLE'],
  ] as const) {
    const local = createFetchQueue([response(status, body)]);
    const candidate = createHostedNativeSessionController({
      binding: hosted(),
      fetch: local.fetch,
      now: createClock().now,
      sessionIdFactory: createIds(),
    });
    assert.equal((await errorCode(candidate.acquire())).code, code);
    assert.equal(local.calls.length, 1);
  }
});

test('direct sources never bootstrap, same Hosted binding retains identity, and a different Map cannot reuse authority', async () => {
  const queue = createFetchQueue([
    response(201, success()),
    response(
      201,
      success({mapId: 'map_abcdef0123456789', sessionId: 'ses_test_2'}),
    ),
  ]);
  const controller = createHostedNativeSessionController({
    binding: {kind: 'direct'},
    fetch: queue.fetch,
    now: createClock().now,
    sessionIdFactory: createIds(),
  });
  assert.equal(await controller.acquire(), null);
  assert.equal(queue.calls.length, 0);

  controller.replaceBinding(hosted());
  const first = await controller.acquire();
  controller.replaceBinding({...hosted(), surfaceId: 'theme-change-does-not-retarget'});
  const same = await controller.acquire();
  assert.equal(same?.sessionId, first?.sessionId);
  assert.equal(queue.calls.length, 1);

  controller.replaceBinding({...hosted(), mapId: 'map_abcdef0123456789'});
  const replaced = await controller.acquire();
  assert.equal(replaced?.sessionId, 'ses_test_2');
  assert.notEqual(replaced?.sessionId, first?.sessionId);
  assert.equal(queue.calls.length, 2);
});
