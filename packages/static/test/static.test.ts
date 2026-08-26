import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileStaticOverlays,
  createStaticMap,
  createStaticMapIdempotencyKey,
  hashStaticSceneRequest,
  prepareStaticMapRequest,
  requestStaticMapUntilReady,
  validateStaticMapIdempotencyKey,
  validateStaticScene,
} from '../src/index';

const baseScene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
};

test('rejects open polygon rings', () => {
  const result = validateStaticScene({
    ...baseScene,
    overlays: [
      {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
        type: 'polygon',
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /must end at their starting coordinate/);
});

test('rejects unsupported device pixel ratios before a render request', () => {
  const result = validateStaticScene({
    ...baseScene,
    size: {...baseScene.size, dpr: 2},
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /dpr/i);
});

test('compiles closed polygon rings', () => {
  const result = validateStaticScene({
    ...baseScene,
    overlays: [
      {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        type: 'polygon',
      },
    ],
  });

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  const compiled = compileStaticOverlays(result.scene.overlays);
  assert.equal(compiled.layers[0]?.type, 'fill');
});

test('requires a bounded idempotency key before making a request', async () => {
  let calls = 0;

  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => {
        calls += 1;
        return new Response();
      },
      idempotencyKey: 'short',
    }),
    /idempotency key/i,
  );

  assert.equal(calls, 0);
  assert.equal(validateStaticMapIdempotencyKey('static_12345678').ok, true);
  assert.equal(validateStaticMapIdempotencyKey('contains spaces').ok, false);
  assert.equal(validateStaticMapIdempotencyKey(createStaticMapIdempotencyKey()).ok, true);
});

test('rejects unsafe API and endpoint URLs before making a request', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response();
  };

  await assert.rejects(
    createStaticMap(baseScene, {
      apiUrl: 'https://user:secret@example.test',
      fetch,
      idempotencyKey: 'static_12345678',
    }),
    /apiUrl must be HTTP\(S\)/,
  );
  await assert.rejects(
    requestStaticMapUntilReady(prepareStaticMapRequest(baseScene), {
      createUrl: 'javascript:alert(1)',
      fetch,
      idempotencyKey: 'static_12345678',
    }),
    /createUrl must be HTTP\(S\)/,
  );
  assert.equal(calls, 0);
});

test('accepts a strict root-relative create URL for same-origin proxies', async () => {
  const urls: string[] = [];
  const result = await requestStaticMapUntilReady(prepareStaticMapRequest(baseScene), {
    createUrl: '/api/static-maps',
    fetch: (async (url) => {
      urls.push(String(url));
      return readyResponse();
    }) as typeof fetch,
    idempotencyKey: 'static_12345678',
  });

  assert.deepEqual(urls, ['/api/static-maps']);
  assert.equal(result.status, 'ready');

  for (const createUrl of [
    '//example.test/static-maps',
    '/\\example.test/static-maps',
    '/api/static-maps?secret=value',
    '/api/static-maps#fragment',
  ]) {
    await assert.rejects(
      requestStaticMapUntilReady(prepareStaticMapRequest(baseScene), {
        createUrl,
        fetch: (async () => readyResponse()) as typeof fetch,
        idempotencyKey: 'static_12345678',
      }),
      /safe root-relative path/,
    );
  }
});

test('retries a processing operation with the same key and validates the ready response', async () => {
  const headers: string[] = [];
  let calls = 0;

  const result = await createStaticMap(baseScene, {
    apiUrl: 'https://api.example.test/',
    fetch: async (_url, init) => {
      calls += 1;
      headers.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');

      if (calls === 1) {
        return Response.json(
          {
            operationId: 'smo_12345678901234567890',
            retryAfterMs: 0,
            status: 'processing',
          },
          {status: 202},
        );
      }

      return Response.json({
        cached: false,
        hash: 'a'.repeat(43),
        imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
        operationId: 'smo_12345678901234567890',
        remainingUnits: 499_985,
        status: 'ready',
        unitCost: 15,
      });
    },
    idempotencyKey: 'static_12345678',
    pollIntervalMs: 0,
  });

  assert.equal(calls, 2);
  assert.deepEqual(headers, ['static_12345678', 'static_12345678']);
  assert.equal(result.unitCost, 15);
  assert.equal(result.remainingUnits, 499_985);
});

test('rejects malformed success responses instead of casting them', async () => {
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => Response.json({cached: true, status: 'ready'}),
      idempotencyKey: 'static_12345678',
    }),
    /invalid response/i,
  );
});

test('rejects oversized response documents without echoing their contents', async () => {
  const secret = 'sensitive-response-body';
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => new Response(JSON.stringify({padding: 'x'.repeat(70_000), secret})),
      idempotencyKey: 'static_12345678',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /exceeded 64 KiB/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test('rejects response JSON that is not strict UTF-8', async () => {
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => new Response(Uint8Array.of(0xc3, 0x28)),
      idempotencyKey: 'static_12345678',
    }),
    /expected UTF-8 JSON/,
  );
});

test('rejects a server response that changes the logical operation while polling', async () => {
  let calls = 0;
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json(
              {
                operationId: 'smo_12345678901234567890',
                retryAfterMs: 0,
                status: 'processing',
              },
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
      pollIntervalMs: 0,
    }),
    /changed operation identity/i,
  );
  assert.equal(calls, 2);
});

test('rejects a non-http immutable image URL', async () => {
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () =>
        Response.json({
          cached: false,
          hash: 'a'.repeat(43),
          imageUrl: 'javascript:alert(1)',
          operationId: 'smo_12345678901234567890',
          remainingUnits: 499_985,
          status: 'ready',
          unitCost: 15,
        }),
      idempotencyKey: 'static_12345678',
    }),
    /invalid response/i,
  );
});

test('maxWaitMs bounds the complete request even when fetch ignores abort', async () => {
  let requestSignal: AbortSignal | null = null;
  const startedAt = Date.now();

  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: (async (_url, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }) as typeof fetch,
      idempotencyKey: 'static_12345678',
      maxWaitMs: 100,
    }),
    /timed out after 100ms/i,
  );

  assert.equal(requestSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'the caller must not wait for an uncooperative fetch');
});

test('an external signal cancels Static Maps and aborts the request', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null = null;
  const pending = createStaticMap(baseScene, {
    fetch: (async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
    idempotencyKey: 'static_12345678',
    signal: controller.signal,
  });

  await Promise.resolve();
  controller.abort();

  await assert.rejects(pending, /aborted/i);
  assert.equal(requestSignal?.aborted, true);
});

test('a pre-aborted signal performs no Static Maps request', async () => {
  const controller = new AbortController();
  let calls = 0;
  controller.abort();

  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: (async () => {
        calls += 1;
        return new Response();
      }) as typeof fetch,
      idempotencyKey: 'static_12345678',
      signal: controller.signal,
    }),
    /aborted/i,
  );

  assert.equal(calls, 0);
});

test('hashes the normalized request body rather than input spelling', async () => {
  const left = await hashStaticSceneRequest(baseScene);
  const right = await hashStaticSceneRequest({
    ...baseScene,
    overlays: [],
    size: {...baseScene.size, dpr: 1},
  });

  assert.equal(left, right);
  assert.match(left, /^[A-Za-z0-9_-]{43}$/);
});

test('prepares one normalized scene for both the request body and dedupe key', async () => {
  const implicitDefaults = prepareStaticMapRequest(baseScene);
  const explicitDefaults = prepareStaticMapRequest({
    ...baseScene,
    camera: {...baseScene.camera, bearing: 0},
    overlays: [],
    size: {...baseScene.size, dpr: 1 as const},
  });
  const bodies: string[] = [];
  const fetcher = (async (_url, init) => {
    bodies.push(String(init?.body));
    return Response.json({
      cached: false,
      hash: 'a'.repeat(43),
      imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
      operationId: 'smo_12345678901234567890',
      remainingUnits: 499_985,
      status: 'ready',
      unitCost: 15,
    });
  }) as typeof fetch;

  assert.equal(implicitDefaults.sceneKey, explicitDefaults.sceneKey);

  await requestStaticMapUntilReady(implicitDefaults, {
    createUrl: 'https://api.example.test/v1/static/maps',
    fetch: fetcher,
    idempotencyKey: 'static_implicit_123',
  });
  await requestStaticMapUntilReady(explicitDefaults, {
    createUrl: 'https://api.example.test/v1/static/maps',
    fetch: fetcher,
    idempotencyKey: 'static_explicit_123',
  });

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0] ?? '{}'), {
    camera: {bearing: 0, center: [0, 0], type: 'center', zoom: 2},
    map: 'main',
    overlays: [],
    size: {dpr: 1, height: 480, width: 640},
  });
});

function readyResponse(): Response {
  return Response.json({
    cached: false,
    hash: 'a'.repeat(43),
    imageUrl: `https://cdn.example.test/static-maps/v1/${'a'.repeat(43)}.png`,
    operationId: 'smo_12345678901234567890',
    remainingUnits: 499_985,
    status: 'ready',
    unitCost: 15,
  });
}
