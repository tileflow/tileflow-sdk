import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidTileflowRuntimeSource,
  createTileflowSessionController,
  inferTileflowAnalyticsFromStyleUrl,
  mergeTileflowAnalytics,
  resolveTileflowMapMode,
  resolveTileflowRuntimeStyle,
  shouldLoadTileflowManifest,
  startTileflowSession,
  validateTileflowRuntimeSource,
} from '../src/runtime';

test('validates the discriminated runtime source contract', () => {
  const style = {layers: [], name: 'Direct', sources: {}, version: 8 as const};
  for (const source of [
    {kind: 'tileflow', map: 'main'},
    {kind: 'tileflow', manifestUrl: '/custom/manifest.json', map: 'main'},
    {kind: 'maplibre', style},
    {kind: 'maplibre', style: '/styles/main.json'},
  ]) {
    assert.deepEqual(validateTileflowRuntimeSource(source), {ok: true});
  }

  for (const source of [
    undefined,
    null,
    {},
    {kind: 'config', config: {}},
    {kind: 'tileflow', map: ''},
    {kind: 'tileflow', map: ' main'},
    {kind: 'tileflow', manifestUrl: '', map: 'main'},
    {kind: 'maplibre', style: ''},
  ]) {
    assert.equal(validateTileflowRuntimeSource(source).ok, false);
    assert.throws(() => assertValidTileflowRuntimeSource(source), TypeError);
  }
});

test('resolves direct MapLibre sources without a compiler path', () => {
  const style = {layers: [], name: 'Direct', sources: {}, version: 8 as const};
  assert.deepEqual(resolveTileflowRuntimeStyle({source: {kind: 'maplibre', style}}), {
    fontFaces: [],
    style,
  });
  assert.deepEqual(
    resolveTileflowRuntimeStyle({
      source: {kind: 'maplibre', style: 'https://cdn.example.test/style.json'},
    }),
    {analytics: undefined, style: 'https://cdn.example.test/style.json'},
  );
});

test('resolves Tileflow styles only from a loaded manifest entry', () => {
  const source = {kind: 'tileflow', map: 'main'} as const;
  assert.equal(resolveTileflowRuntimeStyle({source}), null);
  assert.deepEqual(
    resolveTileflowRuntimeStyle({
      manifestMap: {
        apiUrl: 'https://api.tileflow.dev',
        fontFaces: [],
        mapId: 'map_1',
        styleId: 'style_1',
        styleUrl: 'https://cdn.tileflow.dev/style.json',
      },
      source,
    }),
    {
      analytics: {
        apiUrl: 'https://api.tileflow.dev',
        mapId: 'map_1',
        styleId: 'style_1',
      },
      fontFaces: [],
      style: 'https://cdn.tileflow.dev/style.json',
    },
  );
});

test('loads manifests only for Tileflow sources that need published delivery data', () => {
  const tileflow = {kind: 'tileflow', map: 'main'} as const;
  const maplibre = {kind: 'maplibre', style: '/style.json'} as const;
  assert.equal(shouldLoadTileflowManifest({source: tileflow}), true);
  assert.equal(shouldLoadTileflowManifest({imageMode: true, source: tileflow}), true);
  assert.equal(
    shouldLoadTileflowManifest({imageMode: true, imageUrl: '/map.png', source: tileflow}),
    false,
  );
  assert.equal(shouldLoadTileflowManifest({source: maplibre}), false);
});

test('map mode has no environment-dependent local fallback', () => {
  assert.equal(resolveTileflowMapMode({}), 'interactive');
  assert.equal(resolveTileflowMapMode({mode: 'interactive'}), 'interactive');
  assert.equal(resolveTileflowMapMode({mode: 'image'}), 'image');
});

test('commercial grant preflight is shared, scoped, and attached before hosted delivery', async () => {
  let now = Date.parse('2026-08-13T12:00:00.000Z');
  let calls = 0;
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      return Response.json(
        {
          expiresAt: new Date(now + 15 * 60_000).toISOString(),
          grant: `grant-${calls}`,
          ok: true,
          resourceOrigins: ['https://api.tileflow.dev', 'https://cdn.tileflow.dev'],
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date(now),
    sessionIdFactory: () => 'ses_one',
    source: 'test',
  });
  const analytics = {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'};
  const style = await controller.resolveRequestUrl(
    'https://api.tileflow.dev/maps/map_1/style.json',
    analytics,
  );
  const tile = await controller.resolveRequestUrl(
    'https://cdn.tileflow.dev/tiles/world/v1/0/0/0.pbf?map=map_1',
    analytics,
  );

  assert.equal(calls, 1);
  assert.equal(new URL(style!).searchParams.get('grant'), 'grant-1');
  assert.equal(new URL(tile!).searchParams.get('grant'), 'grant-1');
  assert.equal(new URL(tile!).searchParams.get('session'), 'ses_one');
  assert.equal(
    await controller.resolveRequestUrl('https://attacker.example/tiles/world/0/0/0.pbf', analytics),
    undefined,
  );
  assert.equal(calls, 1);

  now += 14 * 60_000 + 31_000;
  await controller.resolveRequestUrl('https://api.tileflow.dev/fonts/Noto/0-255.pbf', analytics);
  assert.equal(calls, 2, 'the short-lived capability refreshes without rotating the map session');
  assert.equal(controller.sessionId, 'ses_one');
});

test('changing the commercial map rotates the bound grant instead of replaying it', async () => {
  const ids = ['ses_map_one', 'ses_map_two'];
  let idIndex = 0;
  const requestedMaps: string[] = [];
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {mapId: string; sessionId: string};
      requestedMaps.push(request.mapId);
      return Response.json(
        {
          expiresAt: '2026-08-13T12:15:00.000Z',
          grant: `grant-${request.mapId}`,
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    sessionIdFactory: () => ids[idIndex++]!,
    source: 'test',
  });

  const first = new URL(
    (await controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', {
      apiUrl: 'https://api.tileflow.dev',
      mapId: 'map_1',
    }))!,
  );
  const second = new URL(
    (await controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_2/style.json', {
      apiUrl: 'https://api.tileflow.dev',
      mapId: 'map_2',
    }))!,
  );

  assert.deepEqual(requestedMaps, ['map_1', 'map_2']);
  assert.equal(first.searchParams.get('session'), 'ses_map_one');
  assert.equal(first.searchParams.get('grant'), 'grant-map_1');
  assert.equal(second.searchParams.get('session'), 'ses_map_two');
  assert.equal(second.searchParams.get('grant'), 'grant-map_2');
});

test('telemetry opt-out preserves server-owned commercial preflight', async () => {
  const analytics = mergeTileflowAnalytics(
    {enabled: false},
    {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1', styleId: 'style_1'},
  );
  let calls = 0;
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      return Response.json(
        {
          expiresAt: '2026-08-13T12:15:00.000Z',
          grant: 'commercial-grant',
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    sessionIdFactory: () => 'ses_private',
    source: 'test',
  });

  assert.equal(analytics?.enabled, false);
  assert.equal(analytics?.mapId, 'map_1');
  const resolved = await controller.resolveRequestUrl(
    'https://api.tileflow.dev/maps/map_1/style.json',
    analytics,
  );

  assert.equal(calls, 1);
  assert.equal(new URL(resolved!).searchParams.get('grant'), 'commercial-grant');
});

test('commercial preflight rejects non-web resource origins', async () => {
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      return Response.json(
        {
          expiresAt: '2026-08-13T12:15:00.000Z',
          grant: 'commercial-grant',
          ok: true,
          resourceOrigins: ['file:///', 'https://user:password@example.com'],
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    sessionIdFactory: () => 'ses_origin',
    source: 'test',
  });

  await assert.rejects(
    controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', {
      apiUrl: 'https://api.tileflow.dev',
      mapId: 'map_1',
    }),
    /session grant response was invalid/u,
  );
});

test('an expired unused reservation rotates once and retries the preflight transparently', async () => {
  const ids = ['ses_expired', 'ses_replacement'];
  let idIndex = 0;
  const requestedIds: string[] = [];
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      requestedIds.push(request.sessionId);
      if (requestedIds.length === 1) {
        return Response.json(
          {
            code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
            ok: false,
            retryWithNewSession: true,
            sessionId: request.sessionId,
          },
          {status: 409},
        );
      }
      return Response.json(
        {
          expiresAt: '2026-08-13T12:15:00.000Z',
          grant: 'replacement-grant',
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    sessionIdFactory: () => ids[idIndex++]!,
    source: 'test',
  });

  const resolved = await controller.resolveRequestUrl(
    'https://api.tileflow.dev/maps/map_1/style.json',
    {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'},
  );

  assert.deepEqual(requestedIds, ids);
  assert.equal(controller.sessionId, 'ses_replacement');
  assert.equal(new URL(resolved!).searchParams.get('session'), 'ses_replacement');
  assert.equal(new URL(resolved!).searchParams.get('grant'), 'replacement-grant');
});

test('a controller rotates identity at six hours and the 10,000-request boundary', async () => {
  let now = Date.parse('2026-08-13T12:00:00.000Z');
  let sequence = 0;
  const ids = ['ses_1', 'ses_2', 'ses_3'];
  const fetchGrant = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {sessionId: string};
    return Response.json(
      {
        expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
        grant: `grant-${request.sessionId}`,
        ok: true,
        sessionId: request.sessionId,
      },
      {status: 201},
    );
  }) as typeof fetch;
  const controller = createTileflowSessionController({
    fetch: fetchGrant,
    now: () => new Date(now),
    sessionIdFactory: () => ids[sequence++]!,
    source: 'test',
  });
  const analytics = {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'};
  const url = 'https://api.tileflow.dev/maps/map_1/style.json';

  for (let index = 0; index < 10_000; index += 1)
    await controller.resolveRequestUrl(url, analytics);
  assert.equal(controller.sessionId, 'ses_1');
  await controller.resolveRequestUrl(url, analytics);
  assert.equal(controller.sessionId, 'ses_2');
  now += 6 * 60 * 60_000;
  await controller.resolveRequestUrl(url, analytics);
  assert.equal(controller.sessionId, 'ses_3');
});

test('concurrent eligible resources share exactly one commercial preflight', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      await gate;
      return Response.json(
        {
          expiresAt: '2026-08-13T12:15:00.000Z',
          grant: 'shared-grant',
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    sessionIdFactory: () => 'ses_concurrent',
    source: 'test',
  });
  const analytics = {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'};
  const requests = Promise.all([
    controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', analytics),
    controller.resolveRequestUrl('https://api.tileflow.dev/fonts/Noto/0-255.pbf', analytics),
    controller.resolveRequestUrl('https://cdn.tileflow.dev/tiles/world/v1/0/0/0.pbf', analytics),
  ]);

  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const urls = await requests;
  assert.equal(
    urls.every((url) => new URL(url!).searchParams.get('grant') === 'shared-grant'),
    true,
  );
});

test('an in-flight grant remains bound to its session when age rotation starts', async () => {
  const startedAt = Date.parse('2026-08-13T12:00:00.000Z');
  let now = startedAt;
  let releaseOldGrant!: () => void;
  const oldGrantGate = new Promise<void>((resolve) => {
    releaseOldGrant = resolve;
  });
  const requestedIds: string[] = [];
  const ids = ['ses_age_old', 'ses_age_new'];
  let idIndex = 0;
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      requestedIds.push(request.sessionId);
      if (request.sessionId === 'ses_age_old') await oldGrantGate;
      return Response.json(
        {
          expiresAt: new Date(now + 15 * 60_000).toISOString(),
          grant: `grant-${request.sessionId}`,
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date(now),
    sessionIdFactory: () => ids[idIndex++]!,
    source: 'test',
  });
  const analytics = {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'};
  const oldRequest = controller.resolveRequestUrl(
    'https://api.tileflow.dev/maps/map_1/style.json',
    analytics,
  );

  await Promise.resolve();
  now = startedAt + 6 * 60 * 60_000;
  const newRequest = controller.resolveRequestUrl(
    'https://api.tileflow.dev/maps/map_1/style.json',
    analytics,
  );
  const newUrl = new URL((await newRequest)!);
  releaseOldGrant();
  const oldUrl = new URL((await oldRequest)!);

  assert.deepEqual(requestedIds, ids);
  assert.equal(oldUrl.searchParams.get('session'), 'ses_age_old');
  assert.equal(oldUrl.searchParams.get('grant'), 'grant-ses_age_old');
  assert.equal(newUrl.searchParams.get('session'), 'ses_age_new');
  assert.equal(newUrl.searchParams.get('grant'), 'grant-ses_age_new');
  assert.equal(controller.sessionId, 'ses_age_new');
});

test('concurrent requests cannot overrun the 10,000-request session boundary', async () => {
  const startedAt = Date.parse('2026-08-13T12:00:00.000Z');
  let now = startedAt;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const requestedIds: string[] = [];
  const ids = ['ses_count_old', 'ses_count_new'];
  let idIndex = 0;
  const controller = createTileflowSessionController({
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {sessionId: string};
      requestedIds.push(request.sessionId);
      if (requestedIds.length === 2) await refreshGate;
      return Response.json(
        {
          expiresAt: new Date(
            now + (requestedIds.length === 1 ? 2 * 60 * 60_000 : 15 * 60_000),
          ).toISOString(),
          grant: `grant-${request.sessionId}`,
          ok: true,
          sessionId: request.sessionId,
          usageMode: 'session',
        },
        {status: 201},
      );
    }) as typeof fetch,
    now: () => new Date(now),
    sessionIdFactory: () => ids[idIndex++]!,
    source: 'test',
  });
  const analytics = {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'};
  const url = 'https://api.tileflow.dev/maps/map_1/style.json';

  for (let index = 0; index < 9_999; index += 1) {
    await controller.resolveRequestUrl(url, analytics);
  }
  now = startedAt + 2 * 60 * 60_000 - 29_000;
  const lastOldRequest = controller.resolveRequestUrl(url, analytics);
  await Promise.resolve();
  const firstNewRequest = controller.resolveRequestUrl(url, analytics);
  await Promise.resolve();
  releaseRefresh();
  const [lastOldUrl, firstNewUrl] = (await Promise.all([lastOldRequest, firstNewRequest])).map(
    (value) => new URL(value!),
  );

  assert.deepEqual(requestedIds, ['ses_count_old', 'ses_count_old', 'ses_count_new']);
  assert.equal(lastOldUrl.searchParams.get('session'), 'ses_count_old');
  assert.equal(firstNewUrl.searchParams.get('session'), 'ses_count_new');
  assert.equal(controller.sessionId, 'ses_count_new');
});

test('rejects malformed or wrong-mode grant responses at runtime', async () => {
  for (const responseBody of [
    {
      expiresAt: '2026-08-13T12:15:00.000Z',
      grant: 'grant',
      ok: 'true',
      sessionId: 'ses_invalid',
      usageMode: 'session',
    },
    {
      expiresAt: '2026-08-13T12:15:00.000Z',
      grant: 'grant',
      ok: true,
      resourceOrigins: 'https://cdn.tileflow.dev',
      sessionId: 'ses_invalid',
      usageMode: 'session',
    },
    {
      expiresAt: '2026-08-13T12:15:00.000Z',
      grant: 'grant',
      ok: true,
      sessionId: 'ses_invalid',
      usageMode: 'request',
    },
  ]) {
    const controller = createTileflowSessionController({
      fetch: (async () => Response.json(responseBody, {status: 201})) as typeof fetch,
      now: () => new Date('2026-08-13T12:00:00.000Z'),
      sessionIdFactory: () => 'ses_invalid',
      source: 'test',
    });
    await assert.rejects(
      controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', {
        apiUrl: 'https://api.tileflow.dev',
        mapId: 'map_1',
      }),
      /session grant response was invalid/u,
    );
  }
});

test('commercial preflight bounds chunked grant responses before JSON parsing', async () => {
  let cancelled = false;
  const controller = createTileflowSessionController({
    fetch: (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          start(stream) {
            stream.enqueue(new Uint8Array(40_000));
            stream.enqueue(new Uint8Array(30_000));
          },
        }),
        {status: 201},
      )) as typeof fetch,
    sessionIdFactory: () => 'ses_oversized',
    source: 'test',
  });

  await assert.rejects(
    controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', {
      apiUrl: 'https://api.tileflow.dev',
      mapId: 'map_1',
    }),
    /session grant response was too large/u,
  );
  assert.equal(cancelled, true);
});

test('never preflights or decorates a resource URL containing credentials', async () => {
  let calls = 0;
  const controller = createTileflowSessionController({
    fetch: (async () => {
      calls += 1;
      return new Response();
    }) as typeof fetch,
    sessionIdFactory: () => 'ses_credentials',
    source: 'test',
  });

  assert.equal(
    await controller.resolveRequestUrl(
      'https://user:password@api.tileflow.dev/tiles/world/v1/0/0/0.pbf',
      {apiUrl: 'https://api.tileflow.dev', mapId: 'map_1'},
    ),
    undefined,
  );
  assert.equal(calls, 0);
});

test('commercial preflight has a hard client timeout and aborts its fetch', async () => {
  let requestSignal: AbortSignal | null = null;
  const controller = createTileflowSessionController({
    fetch: (async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
    grantTimeoutMs: 25,
    sessionIdFactory: () => 'ses_timeout',
    source: 'test',
  });
  const startedAt = Date.now();

  await assert.rejects(
    controller.resolveRequestUrl('https://api.tileflow.dev/maps/map_1/style.json', {
      apiUrl: 'https://api.tileflow.dev',
      mapId: 'map_1',
    }),
    /timed out after 25ms/i,
  );

  assert.equal(requestSignal?.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'preflight must not wait for an uncooperative fetch');
});

test('analytics inference accepts only the canonical public style URL', () => {
  assert.equal(
    inferTileflowAnalyticsFromStyleUrl(
      'https://api.tileflow.dev/maps/map_1234567890abcdef/style.json',
    )?.mapId,
    'map_1234567890abcdef',
  );
  assert.equal(
    inferTileflowAnalyticsFromStyleUrl(
      'https://api.tileflow.dev/v1/maps/map_1234567890abcdef/style.json',
    ),
    undefined,
  );
  assert.equal(
    inferTileflowAnalyticsFromStyleUrl(
      'https://api.tileflow.dev/v1/styles/prj_123/production.json',
    ),
    undefined,
  );
});

test('analytics fallback absorbs a rejected keepalive request', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let calls = 0;

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {sendBeacon: () => false},
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      calls += 1;
      throw new Error('offline');
    },
  });

  try {
    startTileflowSession(
      {apiUrl: 'https://api.tileflow.dev'},
      {mapId: 'map_1', sessionId: 'ses_analytics', source: 'test'},
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  } finally {
    restoreGlobal('navigator', navigatorDescriptor);
    restoreGlobal('fetch', fetchDescriptor);
  }
});

function restoreGlobal(key: 'fetch' | 'navigator', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else Reflect.deleteProperty(globalThis, key);
}
