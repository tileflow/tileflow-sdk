import assert from 'node:assert/strict';
import test from 'node:test';
import {
  circle,
  compileStaticOverlays,
  createRenderManifest,
  createStaticMap,
  createStaticMapIdempotencyKey,
  hashRenderManifest,
  hashStaticSceneRequest,
  line,
  marker,
  polygon,
  prepareStaticMapRequest,
  requestStaticMapUntilReady,
  STATIC_MAP_RESULT_MEDIA_TYPE,
  StaticMapError,
  staticOverlayPlacements,
  staticRenderManifestSchema,
  staticSceneLimits,
  staticSceneSchema,
  staticSymbolAnchors,
  staticSymbolLabelAppearances,
  staticSymbolLabelPositions,
  staticSymbolLanguages,
  symbol,
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

test('Hosted requests carry an explicit Map target separately from the scene', async () => {
  let target: string | null = null;
  let body: unknown;
  await createStaticMap(baseScene, {
    apiKey: 'synthetic-team-key',
    mapId: 'map_AbCdEfGhIjKlMnOp',
    idempotencyKey: 'static_target_1234',
    fetch: (async (_url, init) => {
      target = new Headers(init?.headers).get('X-Tileflow-Map-Id');
      body = JSON.parse(String(init?.body));
      return hostedReadyResponse();
    }) as typeof fetch,
  });
  assert.equal(target, 'map_AbCdEfGhIjKlMnOp');
  assert.equal((body as Record<string, unknown>).mapId, undefined);
  let calls = 0;
  await assert.rejects(
    createStaticMap(baseScene, {
      mapId: 'bad',
      idempotencyKey: 'static_target_1234',
      fetch: (async () => {
        calls++;
        return hostedReadyResponse();
      }) as typeof fetch,
    }),
    /Map ID/u,
  );
  assert.equal(calls, 0);
});

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

const composition = {
  anchors: {
    'above-water': 'building-areas',
    'below-roads': 'roads',
    'above-roads': 'boundaries',
    'above-buildings': 'vegetation',
    'below-labels': 'labels',
    'above-labels': null,
  },
  icons: [],
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

test('uses one semantic placement vocabulary across every overlay', async () => {
  assert.deepEqual(staticOverlayPlacements, [
    'above-water',
    'below-roads',
    'above-roads',
    'above-buildings',
    'below-labels',
    'above-labels',
  ]);

  const inputs = [
    marker({coordinate: [0, 0], placement: 'below-labels'}),
    circle({coordinate: [0, 0], placement: 'below-labels'}),
    line({
      coordinates: [
        [0, 0],
        [1, 1],
      ],
      placement: 'below-labels',
    }),
    polygon({
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
      placement: 'below-labels',
    }),
    symbol({coordinate: [0, 0], icon: 'store', placement: 'below-labels'}),
  ];

  assert.ok(inputs.every((overlay) => overlay.placement === 'below-labels'));

  const implicit = marker({coordinate: [0, 0]});
  const explicit = marker({coordinate: [0, 0], placement: 'above-labels'});
  assert.deepEqual(explicit, implicit);
  assert.equal('placement' in implicit, false);
  assert.equal(
    await hashStaticSceneRequest({...baseScene, overlays: [implicit]}),
    await hashStaticSceneRequest({...baseScene, overlays: [explicit]}),
  );
  assert.notEqual(
    await hashStaticSceneRequest({
      ...baseScene,
      overlays: [
        symbol({
          coordinate: [0, 0],
          label: {appearance: 'plain', language: 'ja', text: '骨'},
        }),
      ],
    }),
    await hashStaticSceneRequest({
      ...baseScene,
      overlays: [
        symbol({
          coordinate: [0, 0],
          label: {appearance: 'plain', language: 'zh-Hans', text: '骨'},
        }),
      ],
    }),
  );
});

test('normalizes deterministic icon, plain-label, and badge symbols', () => {
  assert.deepEqual(staticSymbolAnchors, [
    'center',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
    'top-left',
  ]);
  assert.deepEqual(staticSymbolLanguages, ['ja', 'zh-Hans', 'zh-Hant', 'ko']);
  assert.deepEqual(staticSymbolLabelAppearances, ['plain', 'badge']);
  assert.deepEqual(staticSymbolLabelPositions, [
    'center',
    'above',
    'above-right',
    'right',
    'below-right',
    'below',
    'below-left',
    'left',
    'above-left',
  ]);

  assert.deepEqual(
    symbol({
      anchor: 'bottom',
      coordinate: [-3.7038, 40.4168],
      icon: 'store',
      label: {
        appearance: 'badge',
        language: 'ja',
        position: 'above-right',
        text: '23',
      },
      offset: [0, -4],
      scale: 1,
    }),
    {
      anchor: 'bottom',
      collision: 'always-visible',
      coordinate: [-3.7038, 40.4168],
      icon: 'store',
      label: {
        appearance: 'badge',
        backgroundColor: '#111827',
        borderColor: '#ffffff',
        borderRadius: 6,
        borderWidth: 1,
        color: '#ffffff',
        fontSize: 12,
        gap: 2,
        language: 'ja',
        padding: {x: 5, y: 3},
        position: 'above-right',
        text: '23',
      },
      offset: [0, -4],
      opacity: 1,
      scale: 1,
      type: 'symbol',
    },
  );

  assert.deepEqual(symbol({coordinate: [0, 0], icon: 'store', label: 'Madrid'}).label, {
    appearance: 'plain',
    color: '#111827',
    fontSize: 12,
    gap: 4,
    haloColor: '#ffffff',
    haloWidth: 2,
    language: 'zh-Hans',
    position: 'above',
    text: 'Madrid',
  });
  assert.equal(symbol({coordinate: [0, 0], label: 'Madrid'}).label?.position, 'center');
  assert.equal(
    symbol({coordinate: [0, 0], label: {appearance: 'plain', text: '東京'}}).label?.language,
    'zh-Hans',
  );
});

test('accepts the deterministic multilingual baseline and closed CJK languages', async () => {
  for (const [text, language] of [
    ['Madrid', undefined],
    ['Tiếng Việt', undefined],
    ['Αθήνα', undefined],
    ['Москва', undefined],
    ['القاهرة', undefined],
    ['ירושלים', undefined],
    ['दिल्ली', undefined],
    ['กรุงเทพมหานคร', undefined],
    ['東京', 'ja'],
    ['北京', 'zh-Hans'],
    ['臺北', 'zh-Hant'],
    ['서울', 'ko'],
  ] as const) {
    const label = {
      appearance: 'plain' as const,
      ...(language ? {language} : {}),
      text,
    };
    assert.equal(
      validateStaticScene({...baseScene, overlays: [{coordinate: [0, 0], label, type: 'symbol'}]})
        .ok,
      true,
      text,
    );
  }

  assert.throws(
    () =>
      symbol({
        coordinate: [0, 0],
        label: {appearance: 'plain', language: 'fr' as 'ja', text: 'Paris'},
      }),
    /language/iu,
  );

  const implicit = symbol({
    coordinate: [0, 0],
    label: {appearance: 'plain', text: '東京'},
  });
  const explicit = symbol({
    coordinate: [0, 0],
    label: {appearance: 'plain', language: 'zh-Hans', text: '東京'},
  });
  assert.deepEqual(implicit, explicit);
  assert.equal(
    await hashStaticSceneRequest({...baseScene, overlays: [implicit]}),
    await hashStaticSceneRequest({...baseScene, overlays: [explicit]}),
  );
});

test('rejects unsafe or unsupported symbol content deterministically', () => {
  assert.equal(
    validateStaticScene({...baseScene, overlays: [{coordinate: [0, 0], type: 'symbol'}]}).ok,
    false,
  );
  assert.equal(
    validateStaticScene({
      ...baseScene,
      overlays: [{coordinate: [0, 0], icon: 'https://example.test/pin.png', type: 'symbol'}],
    }).ok,
    false,
  );
  assert.deepEqual(
    validateStaticScene({
      ...baseScene,
      overlays: [{coordinate: [0, 0], id: 'emoji', label: 'Map 🗺️', type: 'symbol'}],
    }),
    {
      code: 'STATIC_MAP_LABEL_UNSUPPORTED',
      details: {
        codePoint: 0x1f5fa,
        overlay: {id: 'emoji', index: 0, type: 'symbol'},
      },
      error: 'Overlay overlays.0 label contains unsupported glyph U+1F5FA',
      ok: false,
      reason: 'UNSUPPORTED_GLYPH',
      retryable: false,
    },
  );
  assert.throws(() => symbol({coordinate: [0, 0], label: 'line\nbreak'}), /label|text/i);
});

test('compiles placement groups and symbol composition without physical layer input', () => {
  const overlays = [
    line({
      coordinates: [
        [0, 0],
        [1, 1],
      ],
      placement: 'below-labels',
    }),
    symbol({coordinate: [0, 0], icon: 'store'}),
    symbol({coordinate: [1, 1], label: {appearance: 'badge', text: '23'}}),
  ];
  const compiled = compileStaticOverlays(overlays);

  assert.equal(compiled.placements[compiled.layers[0]!.id], 'below-labels');
  assert.equal(compiled.placements[compiled.layers[1]!.id], 'above-labels');
  assert.equal(compiled.layers[1]?.type, 'symbol');
  assert.equal((compiled.layers[1]?.layout as Record<string, unknown>)['icon-image'], 'store');
  assert.equal((compiled.layers[1]?.layout as Record<string, unknown>)['icon-allow-overlap'], true);
  assert.equal(compiled.symbols[0]?.imageId, 'store');
  assert.match(compiled.symbols[1]?.imageId ?? '', /^__tileflow-static-symbol-/u);
  assert.equal(
    (compiled.layers[2]?.layout as Record<string, unknown>)['icon-image'],
    compiled.symbols[1]?.imageId,
  );
  assert.ok(compiled.layers.every((layer) => !Object.hasOwn(layer, 'beforeLayerId')));

  const collision = compileStaticOverlays([
    symbol({collision: 'avoid-overlap', coordinate: [0, 0], icon: 'store'}),
  ]);
  assert.equal(
    (collision.layers[0]?.layout as Record<string, unknown>)['icon-allow-overlap'],
    false,
  );
  assert.equal(
    (collision.layers[0]?.layout as Record<string, unknown>)['icon-ignore-placement'],
    false,
  );
});

test('rejects unknown fields at every public scene object boundary', () => {
  const candidates = [
    {...baseScene, quality: 80},
    {...baseScene, attribution: {mode: 'embedded', position: 'auto', unknown: true}},
    {...baseScene, size: {...baseScene.size, pixelRatio: 2}},
    {...baseScene, camera: {...baseScene.camera, pitch: 45}},
    {
      ...baseScene,
      camera: {bounds: [-10, -10, 10, 10], padding: 16, type: 'bounds', unknown: true},
    },
    {...baseScene, camera: {maxZoom: 12, padding: 16, type: 'auto', unknown: true}},
    {
      ...baseScene,
      camera: {maxZoom: 12, padding: {top: 16, unknown: true}, type: 'auto'},
    },
    {
      ...baseScene,
      overlays: [{coordinate: [0, 0], label: 'Madrid', type: 'marker'}],
    },
    {
      ...baseScene,
      overlays: [{coordinate: [0, 0], icon: 'pin', type: 'circle'}],
    },
    {
      ...baseScene,
      overlays: [
        {
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          dasharray: [2, 2],
          type: 'line',
        },
      ],
    },
    {
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
          label: 'Area',
          type: 'polygon',
        },
      ],
    },
  ];

  for (const candidate of candidates) {
    const result = validateStaticScene(candidate);

    assert.equal(result.ok, false, JSON.stringify(candidate));
    assert.equal(staticSceneSchema.safeParse(candidate).success, false, JSON.stringify(candidate));
    if (!result.ok) assert.notEqual(result.error, '');
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
    attribution: attributionPlan,
    composition,
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

test('requests the single strict result contract on create and every poll', async () => {
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
    idempotencyKey: 'static_result_v1',
    pollIntervalMs: 0,
  });

  assert.deepEqual(acceptHeaders, [STATIC_MAP_RESULT_MEDIA_TYPE, STATIC_MAP_RESULT_MEDIA_TYPE]);
  assert.equal(result.resultVersion, 1);
  assert.equal(result.attribution.position, 'bottom-right');
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

test('preserves bounded structured fields from non-422 API errors', async () => {
  const cases = [
    {
      body: {
        code: 'STATIC_MAP_IDEMPOTENCY_KEY_INVALID',
        error: 'Idempotency key is invalid',
        internal: 'not-public',
        requestId: 'request-400',
        retryable: false,
      },
      status: 400,
    },
    {
      body: {
        code: 'STATIC_MAP_IDEMPOTENCY_CONFLICT',
        error: 'Idempotency key was already used',
      },
      status: 409,
    },
    {
      body: {
        code: 'STATIC_MAP_SHARED_API_QUOTA_EXHAUSTED',
        error: 'Fewer than 15 shared API units remain',
        remainingUnits: 4,
      },
      status: 429,
    },
    {
      body: {
        code: 'STATIC_MAP_LEDGER_STALE',
        error: 'Static Maps is temporarily unavailable',
        retryable: true,
      },
      status: 503,
    },
    {
      body: {
        code: 'STATIC_MAP_ATTRIBUTION_INTEGRITY_FAILED',
        error: 'Static Maps attribution integrity check failed',
      },
      status: 500,
    },
    {
      body: {error: 'Too many requests', requestId: 'request-rate-limit'},
      status: 429,
    },
  ] as const;

  for (const expected of cases) {
    const requestId = 'requestId' in expected.body ? expected.body.requestId : 'code';

    await assert.rejects(
      createStaticMap(baseScene, {
        fetch: async () => Response.json(expected.body, {status: expected.status}),
        idempotencyKey: `static_error_${expected.status}_${requestId}`,
      }),
      (error: unknown) => {
        assert.ok(error instanceof StaticMapError);
        assert.equal(error.name, 'StaticMapError');
        assert.equal(Reflect.get(error, 'status'), expected.status);
        assert.equal(
          Reflect.get(error, 'code'),
          'code' in expected.body ? expected.body.code : null,
        );
        assert.equal(
          Reflect.get(error, 'retryable'),
          'retryable' in expected.body ? expected.body.retryable : null,
        );
        assert.equal(
          Reflect.get(error, 'requestId'),
          'requestId' in expected.body ? expected.body.requestId : null,
        );
        assert.equal(
          Reflect.get(error, 'remainingUnits'),
          'remainingUnits' in expected.body ? expected.body.remainingUnits : null,
        );
        assert.match(error.message, new RegExp(expected.body.error, 'u'));
        assert.equal('internal' in error.response, false);
        return true;
      },
    );
  }
});

test('does not reflect malformed or oversized API error bodies', async () => {
  const secret = 'sensitive-remote-diagnostic';

  for (const body of [
    JSON.stringify({error: `${secret}\u0000`}),
    JSON.stringify({error: secret, padding: 'x'.repeat(9_000)}),
    '<html>upstream failure</html>',
  ]) {
    await assert.rejects(
      createStaticMap(baseScene, {
        fetch: async () => new Response(body, {status: 503}),
        idempotencyKey: 'static_invalid_error_body',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof StaticMapError, false);
        assert.equal(error.message, 'Tileflow static map failed (503).');
        assert.doesNotMatch(error.message, new RegExp(secret, 'u'));
        return true;
      },
    );
  }
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

test('hashes the single complete render manifest deterministically', async () => {
  const manifest = createRenderManifest({
    attribution: attributionPlan,
    composition,
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-v1',
    scene: baseScene,
    styleRevision: 'revision-1',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(await hashRenderManifest(manifest), await hashRenderManifest({...manifest}));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal('format' in manifest.scene, false);
});

test('creates one strict attributed manifest with resolved composition', async () => {
  const manifest = createRenderManifest({
    attribution: attributionPlan,
    composition,
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-semantic-overlays',
    scene: {...baseScene, attribution: {mode: 'embedded', position: 'auto'}},
    styleRevision: 'revision-2',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.attribution.position, 'auto');
  assert.equal(validateStaticRenderManifest(manifest).ok, true);
  assert.equal(validateStaticRenderManifest({...manifest, unexpected: true}).ok, false);
  assert.notEqual(
    await hashRenderManifest(manifest),
    await hashRenderManifest(
      createRenderManifest({
        ...manifest,
        attribution: {...attributionPlan, mode: 'external', position: null},
        scene: {...baseScene, attribution: {mode: 'external'}},
      }),
    ),
  );
});

test('has no prelaunch legacy render-manifest branch', () => {
  const manifest = createRenderManifest({
    attribution: attributionPlan,
    composition,
    mapId: 'map_1234567890abcdef',
    rendererVersion: 'static-semantic-overlays',
    scene: baseScene,
    styleRevision: 'revision-1',
    styleUrl: 'https://api.tileflow.dev/maps/map_1234567890abcdef/light.json',
  });

  assert.equal(staticRenderManifestSchema.safeParse(manifest).success, true);
  assert.equal(
    staticRenderManifestSchema.safeParse({...manifest, schemaVersion: 2}).success,
    false,
  );
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
      resultVersion: 1,
      status: 'ready',
      unitCost: 15,
      ...overrides,
    },
    {headers: {'Content-Type': STATIC_MAP_RESULT_MEDIA_TYPE}},
  );
}
