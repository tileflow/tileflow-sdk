import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeManifestOperation} from '@tileflow/core/native';
import {createMountedMapOwner} from '../src/mounted-map-owner';
import {
  createNativeAdmissionOwner,
  type NativeMapAdmission,
  type NativeMapAdmissionInput,
} from '../src/native-admission-owner';
import {createHostedNativeSessionController} from '../src/session-controller';
import {AdmissionBridgeDouble} from './native-admission-fixture';
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

const resource = Object.freeze({
  url: 'https://tiles.tileflow.test/world/0/0/0.pbf',
  scope: 'tile' as const,
  tilesetId: 'world',
});

function admission() {
  const clock = createClock();
  const bridge = new AdmissionBridgeDouble();
  const issue = () =>
    response(
      201,
      success({
        issuedAt: clock.now().toISOString(),
        serverTime: clock.now().toISOString(),
        expiresAt: new Date(clock.value + 900_000).toISOString(),
      }),
    );
  const owner = createNativeAdmissionOwner({
    bridge,
    createController: createHostedNativeSessionController,
  });
  const errors: Array<{code: string; kind: string}> = [];
  const open = (replies: Parameters<typeof createFetchQueue>[0]) => {
    const queue = createFetchQueue(replies);
    const map = owner.openMap({
      binding: {kind: 'hosted', apiOrigin, credential, mapId, surfaceId: 'store-locator'},
      fetch: queue.fetch,
      now: clock.now,
      sessionIdFactory: createIds(),
      resources: [resource],
      onSessionError: (error) => errors.push(error),
    });
    return {queue, map};
  };
  const admit = async (context: string) => {
    const {promise} = bridge.batch(context, [resource.url]);
    return (await promise)[0];
  };
  return {clock, bridge, owner, errors, issue, open, admit};
}

test('a terminal renewal rejection after admission reaches the opener once and lifts on retry', async () => {
  const f = admission();
  const {queue, map: opening} = f.open([
    async () => f.issue(),
    response(401, {code: 'MOBILE_CREDENTIAL_INVALID'}),
    async () => f.issue(),
  ]);
  const map = await opening;
  try {
    assert.equal((await f.admit(map.context))?.kind, 'grant');
    f.clock.advance(880_000);
    assert.equal((await f.admit(map.context))?.kind, 'reject');
    assert.equal((await f.admit(map.context))?.kind, 'reject');
    assert.deepEqual(f.errors, [{code: 'NATIVE_SESSION_CREDENTIAL_REJECTED', kind: 'terminal'}]);
    assert.equal(map.retryDelay(), null);
    assert.equal(queue.calls.length, 2);

    map.retry();
    assert.equal((await f.admit(map.context))?.kind, 'grant');
    assert.equal(queue.calls.length, 3);
    assert.equal(f.errors.length, 1);
  } finally {
    await f.owner.dispose();
  }
});

test('a failed renewal is recoverable: the still-valid grant keeps admitting until the delay elapses', async () => {
  const f = admission();
  const {queue, map: opening} = f.open([
    async () => f.issue(),
    response(503, {code: 'MOBILE_SESSION_UNAVAILABLE'}),
    async () => f.issue(),
  ]);
  const map = await opening;
  try {
    assert.equal((await f.admit(map.context))?.kind, 'grant');
    f.clock.advance(880_000);
    // The tile that met the failed renewal is refused; the map is not stopped.
    assert.equal((await f.admit(map.context))?.kind, 'reject');
    assert.deepEqual(f.errors, [{code: 'NATIVE_SESSION_UNAVAILABLE', kind: 'recoverable'}]);
    assert.equal(map.retryDelay(), 1_000);
    assert.equal((await f.admit(map.context))?.kind, 'grant');
    assert.equal(queue.calls.length, 2);

    f.clock.advance(1_000);
    assert.equal((await f.admit(map.context))?.kind, 'grant');
    assert.equal(queue.calls.length, 3);
    assert.equal(map.retryDelay(), null);
  } finally {
    await f.owner.dispose();
  }
});

function mounted(origin = 'https://maps.example.test') {
  const events: Array<{type: string; [key: string]: unknown}> = [];
  const inputs: NativeMapAdmissionInput[] = [];
  const maps: Array<NativeMapAdmission & {retries: number}> = [];
  const scheduled: Array<{run: () => void; delayMs: number; cancelled: boolean}> = [];
  const failures: Array<'recoverable' | 'terminal'> = [];
  const documents: Record<string, unknown> = {
    [`${origin}/manifest.json`]: {
      version: 1,
      maps: {
        main: {
          defaultTheme: 'light',
          themes: {light: {colorScheme: 'light', styleUrl: './light.json'}},
        },
      },
    },
    [`${origin}/light.json`]: {version: 8, sources: {}, layers: []},
  };
  const owner = createMountedMapOwner({
    documents: {
      acquire(url: string): TileflowNativeManifestOperation {
        const bytes = new TextEncoder().encode(JSON.stringify(documents[url]));
        let done = false;
        return {
          response: Promise.resolve({
            url,
            status: 200,
            reader: {
              async read() {
                if (done) return {done: true};
                done = true;
                return {done: false, value: bytes};
              },
              cancel() {},
            },
          }),
          async cancel() {},
        };
      },
    },
    createBinding() {
      return {
        async replace() {
          return {kind: 'direct' as const};
        },
        dispose() {},
      };
    },
    appearance() {
      return () => undefined;
    },
    installation: {
      open(input: NativeMapAdmissionInput) {
        inputs.push(input);
        let live = true;
        let failure: 'recoverable' | 'terminal' | undefined;
        const context = `context_${maps.length}`;
        const map = {
          context,
          generation: 1,
          scope: {installation: 'installation', context},
          retries: 0,
          get state() {
            return {context, status: live ? ('active' as const) : ('retired' as const)};
          },
          async prepare() {
            failure = failures.shift();
            if (failure) throw new Error('Session refused.');
            return null;
          },
          discriminate: (url: string) => url,
          discriminateForTest: (url: string) => url,
          async extendResources() {
            return {resources: 0};
          },
          retry() {
            map.retries += 1;
            failure = undefined;
          },
          retryDelay() {
            return failure === 'recoverable' ? 1_000 : null;
          },
          async retire() {
            if (live) {
              live = false;
              input.onRetired?.();
            }
            return {retired: true as const};
          },
        };
        maps.push(map);
        return {
          ready: Promise.resolve(map),
          async retire() {
            await map.retire();
          },
        };
      },
      async retryRetirements() {},
    },
    surfaces: {
      available() {},
      async attach() {
        throw new Error('The test drives preparation only.');
      },
      async retireRoot() {},
    },
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    schedule(run, delayMs) {
      const entry = {run, delayMs, cancelled: false};
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  owner.update({
    source: {map: 'main', manifestUrl: `${origin}/manifest.json`},
    onError: (event) => events.push(event),
  });
  return {owner, events, inputs, maps, scheduled, failures};
}

test('terminal session errors after the first load reach onError; recoverable ones do not', async () => {
  const f = mounted();
  try {
    await f.owner.whenIdle();
    assert.ok(f.owner.getSnapshot().renderer);
    f.inputs[0].onSessionError?.({code: 'NATIVE_SESSION_UNAVAILABLE', kind: 'recoverable'});
    f.inputs[0].onSessionError?.({code: 'NATIVE_SESSION_QUOTA_EXCEEDED', kind: 'terminal'});
    await f.owner.whenIdle();
    assert.deepEqual(f.events, [
      {
        type: 'session-error',
        generation: 1,
        error: {code: 'NATIVE_SESSION_QUOTA_EXCEEDED', kind: 'terminal'},
      },
    ]);
  } finally {
    await f.owner.dispose();
  }
});

test('a first preparation refused by a recoverable session failure prepares again after its delay', async () => {
  const f = mounted();
  f.failures.push('recoverable');
  try {
    await f.owner.whenIdle();
    assert.equal(f.owner.getSnapshot().renderer, undefined);
    assert.deepEqual(
      f.scheduled.map((entry) => entry.delayMs),
      [1_000],
    );
    f.scheduled[0].run();
    await f.owner.whenIdle();
    assert.ok(f.owner.getSnapshot().renderer);
    assert.equal(f.maps.length, 1);
  } finally {
    await f.owner.dispose();
  }
});

test('a terminal first preparation waits for an explicit retry', async () => {
  const f = mounted();
  f.failures.push('terminal');
  try {
    await f.owner.whenIdle();
    assert.equal(f.owner.getSnapshot().renderer, undefined);
    assert.equal(f.scheduled.length, 0);
    assert.ok(f.events.some((event) => event.type === 'renderer-error'));

    f.owner.retry();
    await f.owner.whenIdle();
    assert.equal(f.maps[0].retries, 1);
    assert.ok(f.owner.getSnapshot().renderer);
  } finally {
    await f.owner.dispose();
  }
});

test('backgrounding cancels a scheduled preparation retry', async () => {
  const f = mounted();
  f.failures.push('recoverable');
  try {
    await f.owner.whenIdle();
    assert.equal(f.scheduled.length, 1);
    f.owner.background();
    assert.equal(f.scheduled[0].cancelled, true);
  } finally {
    await f.owner.dispose();
  }
});

test('native retirement of a live context reports a renderer error and opens another, boundedly', async () => {
  const f = mounted();
  try {
    await f.owner.whenIdle();
    assert.equal(f.owner.getSnapshot().renderer?.key, 'context_0');

    await f.maps[0].retire();
    await f.owner.whenIdle();
    assert.equal(f.events.filter((event) => event.type === 'renderer-error').length, 1);
    assert.equal(f.maps.length, 2);
    assert.equal(f.owner.getSnapshot().renderer?.key, 'context_1');

    // Without a load in between, reopening stops after three attempts.
    for (const index of [1, 2, 3]) {
      await f.maps[index].retire();
      await f.owner.whenIdle();
    }
    assert.equal(f.maps.length, 4);
    assert.equal(f.events.filter((event) => event.type === 'renderer-error').length, 4);

    f.owner.retry();
    await f.owner.whenIdle();
    assert.equal(f.maps.length, 5);
    assert.equal(f.owner.getSnapshot().renderer?.key, 'context_4');
  } finally {
    await f.owner.dispose();
  }
});

test('deliberate retirement on source change or disposal does not reopen', async () => {
  const f = mounted();
  await f.owner.whenIdle();
  f.owner.update({
    source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json?b'},
    onError: (event) => f.events.push(event),
  });
  await f.owner.whenIdle();
  await f.owner.dispose();
  assert.equal(f.events.filter((event) => event.type === 'renderer-error').length, 0);
  assert.ok(f.maps.length <= 2);
});
