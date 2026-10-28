import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedNativeSessionController,
  type HostedNativeSessionFetchResponse,
} from '../src/session-controller';
import {
  apiOrigin,
  createClock,
  createFetchQueue,
  createIds,
  credential,
  mapId,
  response,
  success,
} from './session-fixture';

const binding = {kind: 'hosted' as const, apiOrigin, credential, mapId, surfaceId: 'store-locator'};
const rateLimited = {error: 'Too many requests', requestId: 'req_1'};

/** A success for the given session, issued at the clock's current time. */
function issued(clock: ReturnType<typeof createClock>, sessionId = 'ses_test_1') {
  return response(
    201,
    success({
      sessionId,
      issuedAt: clock.now().toISOString(),
      serverTime: clock.now().toISOString(),
      expiresAt: new Date(clock.value + 900_000).toISOString(),
    }),
  );
}

function controllerFor(
  replies: Array<
    HostedNativeSessionFetchResponse | (() => Promise<HostedNativeSessionFetchResponse>)
  >,
  clock = createClock(),
) {
  const queue = createFetchQueue(replies);
  const controller = createHostedNativeSessionController({
    binding,
    fetch: queue.fetch,
    now: clock.now,
    sessionIdFactory: createIds(),
  });
  return {clock, queue, controller};
}

for (const probe of [
  {name: 'a 500', reply: () => response(500, {error: 'Internal'}), code: 'UNAVAILABLE'},
  {name: 'a 502 HTML page', reply: () => response(502, '<html>'), code: 'UNAVAILABLE'},
  {
    name: 'a 503',
    reply: () => response(503, {code: 'MOBILE_SESSION_UNAVAILABLE'}),
    code: 'UNAVAILABLE',
  },
  {name: 'a 504', reply: () => response(504, null), code: 'UNAVAILABLE'},
  {name: 'a 408', reply: () => response(408, null), code: 'UNAVAILABLE'},
  {name: 'a rate-limit 429', reply: () => response(429, rateLimited), code: 'RATE_LIMITED'},
  {name: 'a bare 429', reply: () => response(429, ''), code: 'RATE_LIMITED'},
  {name: 'a redirect status', reply: () => response(302, null), code: 'RESPONSE_INVALID'},
  {
    name: 'a success without no-store',
    reply: () => response(201, success(), {headers: {'cache-control': 'private'}}),
    code: 'RESPONSE_INVALID',
  },
  {name: 'a malformed success', reply: () => response(201, '{'), code: 'RESPONSE_JSON_INVALID'},
] as const) {
  test(`${probe.name} is recoverable: the binding retries after its backoff`, async () => {
    const clock = createClock();
    const {queue, controller} = controllerFor([probe.reply(), async () => issued(clock)], clock);
    try {
      await assert.rejects(controller.acquire(), {
        code: `NATIVE_SESSION_${probe.code}`,
        kind: 'recoverable',
      });
      assert.equal(controller.state.status, 'error');
      assert.equal(controller.retryDelay?.(), 1_000);
      // Within the delay no request leaves the device.
      clock.advance(999);
      await assert.rejects(controller.acquire(), {code: `NATIVE_SESSION_${probe.code}`});
      assert.equal(queue.calls.length, 1);

      clock.advance(1);
      assert.ok(await controller.acquire());
      assert.equal(controller.state.status, 'ready');
      assert.equal(queue.calls.length, 2);
    } finally {
      controller.dispose();
    }
  });
}

for (const probe of [
  {status: 500, body: null},
  {status: 429, body: rateLimited},
  {status: 302, body: null},
]) {
  test(`one ${probe.status} does not stop the map: the next bootstrap succeeds`, async () => {
    const clock = createClock();
    const {queue, controller} = controllerFor(
      [response(probe.status, probe.body), async () => issued(clock)],
      clock,
    );
    try {
      await assert.rejects(controller.acquire());
      clock.advance(60_000);
      const authority = await controller.acquire();
      assert.ok(authority?.grant);
      assert.equal(controller.state.status, 'ready');
      assert.equal(controller.retryDelay?.(), null);
      assert.equal(queue.calls.length, 2);
      assert.ok(controller.transportBudget(authority) > 0);
    } finally {
      controller.dispose();
    }
  });
}

for (const [status, body, code, serviceCode] of [
  [401, {code: 'MOBILE_CREDENTIAL_INVALID'}, 'NATIVE_SESSION_CREDENTIAL_REJECTED', undefined],
  [403, {code: 'MOBILE_MAP_MISMATCH'}, 'NATIVE_SESSION_MAP_MISMATCH', undefined],
  [404, {code: 'MOBILE_MAP_NOT_FOUND'}, 'NATIVE_SESSION_MAP_NOT_FOUND', undefined],
  [
    429,
    {code: 'COMMERCIAL_MAP_LIMIT_REACHED', sessionId: 'ses_test_1'},
    'NATIVE_SESSION_QUOTA_EXCEEDED',
    undefined,
  ],
  [429, {code: 'COMMERCIAL_SPENDING_LIMIT_REACHED'}, 'NATIVE_SESSION_QUOTA_EXCEEDED', undefined],
  // The platform's other session-start refusals.
  [
    400,
    {code: 'MOBILE_SESSION_MODE_REQUIRED'},
    'NATIVE_SESSION_REJECTED',
    'MOBILE_SESSION_MODE_REQUIRED',
  ],
  [
    400,
    {code: 'MOBILE_AUTHORITY_CONFLICT'},
    'NATIVE_SESSION_REJECTED',
    'MOBILE_AUTHORITY_CONFLICT',
  ],
  [
    400,
    {code: 'MOBILE_SESSION_INVALID_INPUT'},
    'NATIVE_SESSION_REJECTED',
    'MOBILE_SESSION_INVALID_INPUT',
  ],
  [
    413,
    {code: 'MOBILE_SESSION_BODY_TOO_LARGE'},
    'NATIVE_SESSION_REJECTED',
    'MOBILE_SESSION_BODY_TOO_LARGE',
  ],
  [418, {code: undefined}, 'NATIVE_SESSION_REJECTED', undefined],
] as const) {
  test(`${status} ${body.code ?? 'without a code'} stops the binding until an explicit retry`, async () => {
    const clock = createClock();
    const {queue, controller} = controllerFor(
      [
        response(status, body, {headers: {'cache-control': 'no-store', 'retry-after': '1'}}),
        async () => issued(clock),
      ],
      clock,
    );
    try {
      await assert.rejects(controller.acquire(), {code, kind: 'terminal'});
      const stopped = controller.state;
      assert.equal(stopped.status === 'error' ? stopped.error.serviceCode : null, serviceCode);
      // Neither time nor Retry-After lifts the stop.
      clock.advance(60 * 60 * 1000);
      await assert.rejects(controller.acquire(), (error: unknown) => {
        assert.deepEqual(
          [(error as {code?: string}).code, (error as {serviceCode?: string}).serviceCode],
          [code, serviceCode],
        );
        return true;
      });
      assert.equal(queue.calls.length, 1);
      assert.equal(controller.retryDelay?.(), null);
      assert.equal(controller.state.status, 'error');

      controller.retry?.();
      assert.equal(controller.state.status, 'idle');
      const authority = await controller.acquire();
      assert.ok(authority?.grant);
      assert.equal(controller.state.status, 'ready');
      assert.equal(queue.calls.length, 2);
      // The stopped session never received authority, so its identity is reused.
      assert.equal(JSON.parse(queue.calls[1].init.body).sessionId, 'ses_test_1');
    } finally {
      controller.dispose();
    }
  });
}

test('rate limiting honours Retry-After in seconds before bootstrapping again', async () => {
  const clock = createClock();
  const {queue, controller} = controllerFor(
    [
      response(429, rateLimited, {headers: {'cache-control': 'no-store', 'retry-after': '60'}}),
      async () => issued(clock),
    ],
    clock,
  );
  try {
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_RATE_LIMITED'});
    assert.equal(controller.retryDelay?.(), 60_000);
    clock.advance(59_999);
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_RATE_LIMITED'});
    assert.equal(queue.calls.length, 1);
    clock.advance(1);
    assert.ok(await controller.acquire());
    assert.equal(queue.calls.length, 2);
  } finally {
    controller.dispose();
  }
});

test('Retry-After accepts an HTTP date and is bounded', async () => {
  const clock = createClock();
  const date = new Date(clock.value + 90_000).toUTCString();
  const dated = controllerFor(
    [response(503, null, {headers: {'cache-control': 'no-store', 'retry-after': date}})],
    clock,
  );
  await assert.rejects(dated.controller.acquire(), {code: 'NATIVE_SESSION_UNAVAILABLE'});
  assert.equal(dated.controller.retryDelay?.(), 90_000);
  dated.controller.dispose();

  for (const [value, delay] of [
    ['86400', 15 * 60 * 1000],
    ['0', 1_000],
    ['soon', 1_000],
    [new Date(clock.value - 60_000).toUTCString(), 1_000],
  ] as const) {
    const probe = controllerFor(
      [response(503, null, {headers: {'cache-control': 'no-store', 'retry-after': value}})],
      clock,
    );
    await assert.rejects(probe.controller.acquire());
    assert.equal(probe.controller.retryDelay?.(), delay, value);
    probe.controller.dispose();
  }
});

test('consecutive recoverable failures back off exponentially up to one minute', async () => {
  const clock = createClock();
  const failures = Array.from({length: 9}, () => response(503, null));
  const {queue, controller} = controllerFor([...failures, async () => issued(clock)], clock);
  try {
    const delays: Array<number | null | undefined> = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_UNAVAILABLE'});
      const delay = controller.retryDelay?.();
      delays.push(delay);
      clock.advance(delay ?? 0);
    }
    assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    assert.ok(await controller.acquire());
    assert.equal(queue.calls.length, 10);
    assert.equal(controller.retryDelay?.(), null);
  } finally {
    controller.dispose();
  }
});

test('a failed renewal keeps admitting with the still-valid grant until its delay elapses', async () => {
  const clock = createClock();
  const {queue, controller} = controllerFor(
    [async () => issued(clock), response(503, null), async () => issued(clock)],
    clock,
  );
  try {
    const first = await controller.acquire();
    assert.ok(first);
    // Inside the refresh margin the renewal fails once.
    clock.advance(880_000);
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_UNAVAILABLE'});
    const kept = await controller.acquire();
    assert.equal(kept, first);
    assert.ok(controller.transportBudget(first) > 0);
    assert.equal(queue.calls.length, 2);

    clock.advance(1_000);
    const renewed = await controller.acquire();
    assert.notEqual(renewed, first);
    assert.equal(queue.calls.length, 3);
    assert.equal(controller.state.status, 'ready');
  } finally {
    controller.dispose();
  }
});

test('retry clears a recoverable delay at once', async () => {
  const clock = createClock();
  const {queue, controller} = controllerFor(
    [
      response(429, rateLimited, {headers: {'cache-control': 'no-store', 'retry-after': '60'}}),
      async () => issued(clock),
    ],
    clock,
  );
  try {
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_RATE_LIMITED'});
    controller.retry?.();
    assert.equal(controller.retryDelay?.(), null);
    assert.ok(await controller.acquire());
    assert.equal(queue.calls.length, 2);
  } finally {
    controller.dispose();
  }
});

test('a grant whose lifetime from server time exceeds fifteen minutes is rejected', async () => {
  const {controller} = controllerFor([
    response(
      201,
      success({
        issuedAt: '2026-09-15T20:00:20.000Z',
        serverTime: '2026-09-15T20:00:00.000Z',
        expiresAt: '2026-09-15T20:15:20.000Z',
      }),
    ),
  ]);
  try {
    await assert.rejects(controller.acquire(), {code: 'NATIVE_SESSION_RESPONSE_INVALID'});
  } finally {
    controller.dispose();
  }
});
