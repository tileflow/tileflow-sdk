import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostedNativeSessionController} from '../src/session-controller';
import {
  apiOrigin,
  createClock,
  createIds,
  credential,
  deferred,
  grant,
  mapId,
  response,
  success,
} from './session-fixture';

function fixture() {
  const clock = createClock();
  const bodies: Array<{sessionId: string; mapId: string; surfaceId: string}> = [];
  let gate: Promise<void> | undefined;
  let entered: (() => void) | undefined;
  let restart = false;
  const controller = createHostedNativeSessionController({
    binding: {kind: 'hosted', apiOrigin, credential, mapId},
    now: clock.now,
    sessionIdFactory: createIds(),
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      entered?.();
      await gate;
      if (restart) {
        restart = false;
        return response(409, {
          code: 'SESSION_ID_CONFLICT',
          error: 'Conflict',
          retryWithNewSession: true,
          sessionId: body.sessionId,
        });
      }
      return response(
        201,
        success({
          sessionId: body.sessionId,
          surfaceId: body.surfaceId,
          issuedAt: clock.now().toISOString(),
          serverTime: clock.now().toISOString(),
          expiresAt: new Date(clock.value + 900000).toISOString(),
        }),
      );
    },
  });
  return {
    controller,
    bodies,
    clock,
    hold(value: Promise<void>, notify: () => void) {
      gate = value;
      entered = notify;
    },
    restart() {
      restart = true;
    },
  };
}

test('preparation returns immutable policy only and leaves all ten thousand admissions available', async () => {
  const f = fixture();
  const policy = await f.controller.prepare!();
  assert.deepEqual(Object.keys(policy!).sort(), [
    'mapId',
    'resourceOrigins',
    'resourceScopes',
    'tilesetIds',
  ]);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy!.resourceOrigins));
  assert.equal(JSON.stringify(policy).includes(grant), false);
  assert.equal(JSON.stringify(policy).includes(credential), false);
  await f.controller.prepare!();
  for (let index = 1; index <= 10000; index++) {
    const authority = await f.controller.acquire();
    if (index >= 9999) assert.equal(authority!.sessionId, 'ses_test_1');
  }
  assert.equal((await f.controller.acquire())!.sessionId, 'ses_test_2');
  assert.equal(f.bodies.length, 2);
  f.controller.dispose();
});

test('concurrent preparation and acquisitions share only bootstrap, never their accounting', async () => {
  const f = fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  f.hold(release.promise, () => entered.resolve());
  const preparation = f.controller.prepare!();
  await entered.promise;
  const tickets = [f.controller.acquire(), f.controller.acquire()];
  release.resolve();
  assert.equal((await preparation)!.mapId, mapId);
  assert.equal((await Promise.all(tickets)).length, 2);
  assert.equal(f.bodies.length, 1);
  f.clock.advance(6 * 60 * 60 * 1000);
  await f.controller.prepare!();
  assert.equal(f.bodies.at(-1)!.sessionId, 'ses_test_2');
  assert.equal((await f.controller.acquire())!.sessionId, 'ses_test_2');
  f.controller.dispose();
});

test('non-session preparation does not read identity or fetch; background and retirement cannot deliver policy', async () => {
  const direct = createHostedNativeSessionController({
    binding: {kind: 'direct'},
    now: createClock().now,
    sessionIdFactory: () => {
      throw new Error('Unexpected identity.');
    },
    fetch: async () => {
      throw new Error('Unexpected fetch.');
    },
  });
  assert.equal(await direct.prepare!(), null);
  direct.dispose();
  for (const retire of ['dispose', 'background'] as const) {
    const f = fixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    f.hold(release.promise, () => entered.resolve());
    const pending = f.controller.prepare!();
    const rejected = assert.rejects(pending);
    await entered.promise;
    f.controller[retire]();
    release.resolve();
    await rejected;
    f.controller.dispose();
  }
});
