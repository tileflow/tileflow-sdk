import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStaticMapRequestKey,
  requestStaticMapUntilReady,
  resolveStaticMap,
} from '../src/static-map-request';

const scene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
};

test('deduplicates only the same idempotency operation', () => {
  const common = {createUrl: '/v1/static/maps', sceneKey: JSON.stringify(scene)};
  assert.equal(
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
  );
  assert.notEqual(
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
    createStaticMapRequestKey({...common, idempotencyKey: 'static_second'}),
  );
});

test('the React client rejects operation identity drift while polling', async () => {
  let calls = 0;
  await assert.rejects(
    requestStaticMapUntilReady({
      createUrl: 'https://api.example.test/v1/static/maps',
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json(
              {operationId: 'smo_12345678901234567890', retryAfterMs: 0, status: 'processing'},
              {status: 202},
            )
          : Response.json({
              cached: false,
              hash: 'a'.repeat(43),
              imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
              operationId: 'smo_99999999999999999999',
              remainingUnits: 499_985,
              status: 'ready',
              unitCost: 15,
            });
      },
      idempotencyKey: 'static_12345678',
      scene,
    }),
    /changed operation identity/i,
  );
  assert.equal(calls, 2);
});

test('the React request budget bounds an uncooperative fetch', async () => {
  let requestSignal: AbortSignal | null = null;
  const startedAt = Date.now();

  await assert.rejects(
    requestStaticMapUntilReady({
      createUrl: 'https://api.example.test/v1/static/maps',
      fetch: (async (_url, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }) as typeof fetch,
      idempotencyKey: 'static_12345678',
      maxWaitMs: 100,
      scene,
    }),
    /timed out after 100ms/i,
  );

  assert.equal(requestSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'the caller must not wait for an uncooperative fetch');
});

test('one React consumer can unmount without cancelling shared work', async () => {
  let calls = 0;
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetcher = (async () => {
    calls += 1;
    return response;
  }) as typeof fetch;
  const requestKey = createStaticMapRequestKey({
    createUrl: 'https://api.example.test/v1/static/maps',
    idempotencyKey: 'static_shared_123',
    sceneKey: JSON.stringify(scene),
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = resolveStaticMap({
    createUrl: 'https://api.example.test/v1/static/maps',
    fetch: fetcher,
    idempotencyKey: 'static_shared_123',
    requestKey,
    scene,
    signal: firstController.signal,
  });
  const second = resolveStaticMap({
    createUrl: 'https://api.example.test/v1/static/maps',
    fetch: fetcher,
    idempotencyKey: 'static_shared_123',
    requestKey,
    scene,
    signal: secondController.signal,
  });

  firstController.abort();
  await assert.rejects(first, /aborted/i);
  finish(
    Response.json({
      cached: false,
      hash: 'a'.repeat(43),
      imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
      operationId: 'smo_12345678901234567890',
      remainingUnits: 499_985,
      status: 'ready',
      unitCost: 15,
    }),
  );

  assert.equal((await second).operationId, 'smo_12345678901234567890');
  assert.equal(calls, 1);
});

test('the last React consumer aborts its shared network request', async () => {
  const consumer = new AbortController();
  let requestSignal: AbortSignal | null = null;
  const pending = resolveStaticMap({
    createUrl: 'https://api.example.test/v1/static/maps',
    fetch: (async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
    idempotencyKey: 'static_last_12345',
    requestKey: 'last-consumer-request',
    scene,
    signal: consumer.signal,
  });

  await Promise.resolve();
  consumer.abort();

  await assert.rejects(pending, /aborted/i);
  assert.equal(requestSignal?.aborted, true);
});
