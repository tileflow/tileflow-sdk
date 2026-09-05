import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileStaticOverlays,
  createRenderManifest,
  createRenderManifestV2,
  createStaticMap,
  createStaticMapIdempotencyKey,
  hashRenderManifest,
  hashStaticSceneRequest,
  prepareStaticMapRequest,
  requestStaticMapUntilReady,
  STATIC_MAP_RESULT_V2_MEDIA_TYPE,
  staticRenderManifestV1Schema,
  staticSceneLimits,
  validateStaticMapIdempotencyKey,
  validateStaticRenderManifest,
  validateStaticScene,
} from '../src/index';

const baseScene = {
  camera: {center: [0, 0] as [number, number], type: 'center' as const, zoom: 2},
  map: 'main',
  size: {height: 480, width: 640},
  theme: 'light',
};

const attributionPlan = {
  entries: [
    {
      authority: 'team-declared' as const,
      provenance: {
        authority: 'team-declared' as const,
        sources: [
          {
            mapRevision: 'deployment-1',
            resourceId: 'stores',
            sourceId: 'stores',
            sourceSelectionIdentity: 'archive:stores-v1',
          },
        ],
      },
      segments: [
        {kind: 'text' as const, text: '© Example '},
        {
          kind: 'link' as const,
          label: 'terms',
          url: 'https://example.test/terms',
        },
      ],
    },
  ],
  mode: 'embedded' as const,
  position: 'auto' as const,
  schemaVersion: 1 as const,
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

test('accepts DPR 2 within the physical pixel budget', () => {
  const result = validateStaticScene({
    ...baseScene,
    size: {...baseScene.size, dpr: 2},
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.scene.size, {dpr: 2, height: 480, width: 640});
});

test('rejects invalid DPR and admits the 2048-logical parity maximum', () => {
  for (const dpr of [0, 1.5, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateStaticScene({
      ...baseScene,
      size: {...baseScene.size, dpr},
    });

    assert.equal(result.ok, false, String(dpr));
    if (!result.ok) assert.match(result.error, /dpr/i);
  }

  assert.equal(staticSceneLimits.maxDimension, 2048);
  assert.equal(staticSceneLimits.maxPhysicalPixels, 2048 * 2048 * 4);
  assert.equal(
    validateStaticScene({...baseScene, size: {dpr: 2, height: 2048, width: 2048}}).ok,
    true,
  );
  const overDimension = validateStaticScene({
    ...baseScene,
    size: {dpr: 2, height: 2049, width: 2048},
  });
  assert.equal(overDimension.ok, false);
  if (!overDimension.ok) assert.match(overDimension.error, /2048/i);
});

test('validates output formats and keeps PNG as an omitted canonical default', () => {
  const implicit = validateStaticScene(baseScene);
  const png = validateStaticScene({...baseScene, format: 'png'});
  const jpeg = validateStaticScene({...baseScene, format: 'jpeg'});
  const webp = validateStaticScene({...baseScene, format: 'webp'});
  const unknown = validateStaticScene({...baseScene, format: 'gif'});

  assert.equal(implicit.ok, true);
  assert.equal(png.ok, true);
  assert.equal(jpeg.ok, true);
  assert.equal(webp.ok, true);
  assert.equal(unknown.ok, false);
  if (implicit.ok && png.ok && jpeg.ok && webp.ok) {
    assert.deepEqual(png.scene, implicit.scene);
    assert.equal('format' in png.scene, false);
    assert.equal(jpeg.scene.format, 'jpeg');
    assert.equal(webp.scene.format, 'webp');
  }
});

test('validates attribution choices without injecting the omitted default into the scene', () => {
  const omitted = validateStaticScene(baseScene);
  const empty = validateStaticScene({...baseScene, attribution: {}});
  const explicitAuto = validateStaticScene({
    ...baseScene,
    attribution: {mode: 'embedded', position: 'auto'},
  });
  const external = validateStaticScene({...baseScene, attribution: {mode: 'external'}});

  assert.equal(omitted.ok, true);
  assert.equal(empty.ok, true);
  assert.equal(explicitAuto.ok, true);
  assert.equal(external.ok, true);
  assert.equal(
    validateStaticScene({
      ...baseScene,
      attribution: {mode: 'external', position: 'bottom-right'},
    }).ok,
    false,
  );
  if (omitted.ok && empty.ok && explicitAuto.ok && external.ok) {
    assert.equal('attribution' in omitted.scene, false);
    assert.equal('attribution' in empty.scene, false);
    assert.deepEqual(explicitAuto.scene.attribution, {
      mode: 'embedded',
      position: 'auto',
    });
    assert.deepEqual(external.scene.attribution, {mode: 'external'});
  }
});

test('requires one concrete theme for deterministic static rendering', () => {
  assert.equal(validateStaticScene({...baseScene, theme: 'system'}).ok, false);
  assert.equal(validateStaticScene({...baseScene, theme: ''}).ok, false);
  assert.equal(validateStaticScene({...baseScene, theme: 'Dark'}).ok, false);
  assert.equal(validateStaticScene({...baseScene, theme: 'con'}).ok, false);
  assert.equal(validateStaticScene({...baseScene, map: 'Main'}).ok, false);
  assert.equal(validateStaticScene({...baseScene, theme: 'dark'}).ok, true);
});

test('keeps the scene map distinct from the resolved Hosted Map identity', () => {
  const manifest = createRenderManifest({
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v1',
    scene: {...baseScene, map: 'madrid', theme: 'dark'},
    styleRevision: 'revision-1',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/dark.json',
  });

  assert.equal(manifest.mapId, 'map_1234567890abcdef');
  assert.equal(manifest.scene.map, 'madrid');
  assert.equal(manifest.scene.theme, 'dark');
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
      return hostedReadyResponse();
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
        fetch: (async () => hostedReadyResponse()) as typeof fetch,
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

      return hostedReadyResponse();
    },
    idempotencyKey: 'static_12345678',
    pollIntervalMs: 0,
  });

  assert.equal(calls, 2);
  assert.deepEqual(headers, ['static_12345678', 'static_12345678']);
  assert.equal(result.unitCost, 15);
  assert.equal(result.remainingUnits, 499_985);
});

test('requests strict result v2 on create and every poll', async () => {
  const acceptHeaders: string[] = [];
  let calls = 0;

  const result = await createStaticMap(baseScene, {
    fetch: async (_url, init) => {
      calls += 1;
      acceptHeaders.push(new Headers(init?.headers).get('Accept') ?? '');

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

      return hostedReadyResponse();
    },
    idempotencyKey: 'static_result_v2',
    pollIntervalMs: 0,
  });

  assert.deepEqual(acceptHeaders, [
    STATIC_MAP_RESULT_V2_MEDIA_TYPE,
    STATIC_MAP_RESULT_V2_MEDIA_TYPE,
  ]);
  assert.equal(result.resultVersion, 2);
  assert.equal(result.attribution.position, 'bottom-right');
});

test('a v2 client rejects a legacy success instead of claiming attribution', async () => {
  await assert.rejects(
    createStaticMap(baseScene, {
      fetch: async () => readyResponse(),
      idempotencyKey: 'static_legacy_result',
    }),
    /invalid response/i,
  );
});

test('accepts an unbounded Starter balance in a ready response', async () => {
  const result = await createStaticMap(baseScene, {
    fetch: async () => hostedReadyResponse({remainingUnits: null}),
    idempotencyKey: 'static_12345678',
  });

  assert.equal(result.remainingUnits, null);
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
          : hostedReadyResponse({operationId: 'smo_99999999999999999999'});
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
      fetch: async () => hostedReadyResponse({imageUrl: 'javascript:alert(1)'}),
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

test('preserves old PNG identity and distinguishes DPR and encoded outputs', async () => {
  const implicit = await hashStaticSceneRequest(baseScene);
  const png = await hashStaticSceneRequest({...baseScene, format: 'png'});
  const jpeg = await hashStaticSceneRequest({...baseScene, format: 'jpeg'});
  const webp = await hashStaticSceneRequest({...baseScene, format: 'webp'});
  const dense = await hashStaticSceneRequest({
    ...baseScene,
    size: {...baseScene.size, dpr: 2},
  });

  assert.equal(png, implicit);
  assert.notEqual(jpeg, implicit);
  assert.notEqual(webp, implicit);
  assert.notEqual(jpeg, webp);
  assert.notEqual(dense, implicit);
});

test('keeps the released PNG manifest hash stable', async () => {
  const manifest = createRenderManifest({
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v1',
    scene: baseScene,
    styleRevision: 'revision-1',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(await hashRenderManifest(manifest), 'PsD5OpyyjZk6plYPPPmBmYmCel6kGkeps2HYxOnEh1I');
  assert.equal('format' in manifest.scene, false);
});

test('creates strict attributed manifest v2 while preserving requested auto placement', async () => {
  const manifest = createRenderManifestV2({
    attribution: attributionPlan,
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v2',
    scene: {...baseScene, attribution: {mode: 'embedded', position: 'auto'}},
    styleRevision: 'revision-2',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.attribution.position, 'auto');
  assert.equal(validateStaticRenderManifest(manifest).ok, true);
  assert.equal(validateStaticRenderManifest({...manifest, unexpected: true}).ok, false);
  assert.notEqual(
    await hashRenderManifest(manifest),
    await hashRenderManifest(
      createRenderManifestV2({
        ...manifest,
        attribution: {...attributionPlan, mode: 'external', position: null},
        scene: {...baseScene, attribution: {mode: 'external'}},
      }),
    ),
  );
});

test('the legacy manifest schema rejects v2 before it can omit attribution', () => {
  const manifest = createRenderManifestV2({
    attribution: attributionPlan,
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v2',
    scene: baseScene,
    styleRevision: 'revision-2',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(staticRenderManifestV1Schema.safeParse(manifest).success, false);
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
    return hostedReadyResponse();
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
    theme: 'light',
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

function hostedReadyResponse(
  overrides: Partial<{
    imageUrl: string;
    operationId: string;
    remainingUnits: number | null;
  }> = {},
): Response {
  return Response.json(
    {
      attribution: {
        entries: [
          {
            authority: 'platform-notice',
            links: [{label: 'data', url: 'https://example.test/data'}],
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
