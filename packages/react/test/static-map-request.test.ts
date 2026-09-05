import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareStaticMapRequest, STATIC_MAP_RESULT_V2_MEDIA_TYPE} from '@tileflow/static/client';
import {createStaticMapRequestKey, resolveStaticMap} from '../src/static-map-request';

const createUrl = 'https://api.example.test/v1/static/maps';
const scene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
  theme: 'light',
};

test('deduplicates only the same normalized idempotency operation', () => {
  const request = prepareStaticMapRequest(scene);
  const common = {createUrl, request};

  assert.equal(
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
  );
  assert.notEqual(
    createStaticMapRequestKey({...common, idempotencyKey: 'static_first'}),
    createStaticMapRequestKey({...common, idempotencyKey: 'static_second'}),
  );
});

test('attribution mode and requested position participate in the React request key', () => {
  const embedded = prepareStaticMapRequest({
    ...scene,
    attribution: {mode: 'embedded', position: 'bottom-left'},
  });
  const external = prepareStaticMapRequest({
    ...scene,
    attribution: {mode: 'external'},
  });

  assert.notEqual(
    createStaticMapRequestKey({
      createUrl,
      idempotencyKey: 'static_attribution',
      request: embedded,
    }),
    createStaticMapRequestKey({
      createUrl,
      idempotencyKey: 'static_attribution',
      request: external,
    }),
  );
});

test('equivalent explicit defaults share one React request', async () => {
  const implicitDefaults = prepareStaticMapRequest(scene);
  const explicitDefaults = prepareStaticMapRequest({
    ...scene,
    camera: {...scene.camera, bearing: 0},
    overlays: [],
    size: {...scene.size, dpr: 1 as const},
  });
  let calls = 0;
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetcher = (async () => {
    calls += 1;
    return response;
  }) as typeof fetch;

  assert.equal(implicitDefaults.sceneKey, explicitDefaults.sceneKey);
  assert.equal(
    createStaticMapRequestKey({
      createUrl,
      idempotencyKey: 'static_defaults_123',
      request: implicitDefaults,
    }),
    createStaticMapRequestKey({
      createUrl,
      idempotencyKey: 'static_defaults_123',
      request: explicitDefaults,
    }),
  );

  const first = resolveStaticMap({
    createUrl,
    fetch: fetcher,
    idempotencyKey: 'static_defaults_123',
    request: implicitDefaults,
  });
  const second = resolveStaticMap({
    createUrl,
    fetch: fetcher,
    idempotencyKey: 'static_defaults_123',
    request: explicitDefaults,
  });

  finish(readyResponse());
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('the React client rejects operation identity drift through the shared poller', async () => {
  let calls = 0;

  await assert.rejects(
    resolveStaticMap({
      createUrl,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json(
              {operationId: 'smo_12345678901234567890', retryAfterMs: 0, status: 'processing'},
              {status: 202},
            )
          : readyResponse({operationId: 'smo_99999999999999999999'});
      },
      idempotencyKey: 'static_drift_123',
      request: prepareStaticMapRequest(scene),
    }),
    /changed operation identity/i,
  );
  assert.equal(calls, 2);
});

test('the React request budget bounds an uncooperative shared fetch', async () => {
  let requestSignal: AbortSignal | null = null;
  const startedAt = Date.now();

  await assert.rejects(
    resolveStaticMap({
      createUrl,
      fetch: (async (_url, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }) as typeof fetch,
      idempotencyKey: 'static_budget_123',
      maxWaitMs: 100,
      request: prepareStaticMapRequest(scene),
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
  const request = prepareStaticMapRequest(scene);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = resolveStaticMap({
    createUrl,
    fetch: fetcher,
    idempotencyKey: 'static_shared_123',
    request,
    signal: firstController.signal,
  });
  const second = resolveStaticMap({
    createUrl,
    fetch: fetcher,
    idempotencyKey: 'static_shared_123',
    request,
    signal: secondController.signal,
  });

  firstController.abort();
  await assert.rejects(first, /aborted/i);
  finish(readyResponse());

  assert.equal((await second).operationId, 'smo_12345678901234567890');
  assert.equal(calls, 1);
});

test('the last React consumer aborts its shared network request', async () => {
  const consumer = new AbortController();
  let requestSignal: AbortSignal | null = null;
  const pending = resolveStaticMap({
    createUrl,
    fetch: (async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
    idempotencyKey: 'static_last_12345',
    request: prepareStaticMapRequest(scene),
    signal: consumer.signal,
  });

  await Promise.resolve();
  consumer.abort();

  await assert.rejects(pending, /aborted/i);
  assert.equal(requestSignal?.aborted, true);
});

function readyResponse(overrides: {operationId?: string} = {}) {
  return Response.json(
    {
      attribution: {
        entries: [
          {
            authority: 'platform-notice',
            links: [],
            text: '© Example data',
          },
        ],
        mode: 'embedded',
        position: 'bottom-right',
      },
      cached: false,
      hash: 'a'.repeat(43),
      imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
      operationId: 'smo_12345678901234567890',
      remainingUnits: 499_985,
      resultVersion: 2,
      status: 'ready',
      unitCost: 15,
      ...overrides,
    },
    {headers: {'Content-Type': STATIC_MAP_RESULT_V2_MEDIA_TYPE}},
  );
}
