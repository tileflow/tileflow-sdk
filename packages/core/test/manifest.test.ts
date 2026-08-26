import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTileflowManifestCache,
  defaultTileflowRuntimeView,
  defineMap,
  loadTileflowManifest,
  normalizeTileflowRuntimeCenter,
  parseTileflowRuntimeManifest,
  resolveTileflowManifestMap,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  tileflowRuntimeManifestSchema,
} from '../src';
import {createManifest} from '../src/build';
import {extendStreets} from './map-fixture';

test('creates a discriminated self-hosted manifest and transports configured views', () => {
  const manifest = createManifest(
    {
      maps: {
        main: {
          ...extendStreets({id: 'main'}),
          view: {bearing: 12, center: [-3.7, 40.4], pitch: 35, zoom: 10},
        },
      },
    },
    {styleBaseUrl: '/tileflow'},
  );

  assert.equal(manifest.kind, 'self-hosted');
  assert.deepEqual(manifest.views?.main, {
    bearing: 12,
    center: [-3.7, 40.4],
    pitch: 35,
    zoom: 10,
  });
  assert.deepEqual(resolveTileflowManifestMap(manifest, 'main')?.view, manifest.views?.main);
});

test('manifest generation sorts maps and transports the resolved inherited view', () => {
  const parent = extendStreets({
    id: 'parent',
    view: {bearing: 8, center: [-3.7, 40.4], zoom: 9},
  });
  const alpha = defineMap({
    id: 'alpha',
    version: 1,
    extends: parent,
    view: {pitch: 40},
  });
  const zulu = extendStreets({id: 'zulu', view: {zoom: 3}});
  const manifest = createManifest({maps: {zulu, alpha}}, {styleBaseUrl: './tileflow/'});

  assert.equal(manifest.version, 3);
  assert.deepEqual(Object.keys(manifest.maps), ['alpha', 'zulu']);
  assert.deepEqual(Object.keys(manifest.styles), ['alpha', 'zulu']);
  assert.deepEqual(Object.keys(manifest.views ?? {}), ['alpha', 'zulu']);
  assert.deepEqual(manifest.views?.alpha, {
    bearing: 8,
    center: [-3.7, 40.4],
    pitch: 40,
    zoom: 9,
  });
  assert.equal(manifest.maps.alpha, './tileflow/styles/alpha.json');
});

test('self-hosted manifest creation fails explicitly for non-canonical map identifiers', () => {
  for (const mapName of ['Main', 'not_portable', 'constructor', 'prototype', 'm'.repeat(65)]) {
    assert.throws(() =>
      createManifest({
        maps: Object.fromEntries([[mapName, extendStreets({id: mapName})]]),
      }),
    );
  }
});

test('rejects every legacy manifest shape instead of normalizing aliases', () => {
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      kind: 'self-hosted',
      maps: {main: '/tileflow/styles/main.json'},
      styles: {main: '/tileflow/styles/main.json'},
      version: 2,
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      maps: {main: '/tileflow/styles/main.json'},
      styles: {main: '/tileflow/styles/main.json'},
      version: 3,
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      apiUrl: 'https://api.example.test',
      kind: 'hosted',
      maps: {
        main: {
          environment: 'main',
          mapId: 'map_main',
          url: 'https://api.example.test/maps/map_main/style.json',
        },
      },
      styles: {main: 'https://api.example.test/maps/map_main/style.json'},
      version: 3,
    }),
  );
});

test('parses only explicit canonical self-hosted and hosted variants', () => {
  const selfHosted = parseTileflowRuntimeManifest({
    kind: 'self-hosted',
    maps: {main: '/tileflow/styles/main.json'},
    styles: {main: '/tileflow/styles/main.json'},
    version: 3,
  });
  assert.equal(selfHosted.kind, 'self-hosted');

  const hosted = parseTileflowRuntimeManifest({
    apiUrl: 'https://api.example.test',
    kind: 'hosted',
    maps: {
      main: {
        environment: 'main',
        mapId: 'map_main',
        styleUrl: 'https://api.example.test/maps/map_main/style.json',
      },
    },
    styles: {main: 'https://api.example.test/maps/map_main/style.json'},
    version: 3,
  });
  assert.equal(hosted.kind, 'hosted');
  assert.equal(resolveTileflowManifestMap(hosted, 'main')?.mapId, 'map_main');
});

test('canonical manifest schema rejects unknown fields, bad versions, unsafe URLs, and drift', () => {
  const valid = {
    kind: 'self-hosted' as const,
    maps: {main: '/tileflow/styles/main.json'},
    styles: {main: '/tileflow/styles/main.json'},
    version: 3 as const,
  };
  assert.equal(tileflowRuntimeManifestSchema.safeParse(valid).success, true);
  assert.equal(tileflowRuntimeManifestSchema.safeParse({...valid, extra: true}).success, false);
  assert.throws(() => parseTileflowRuntimeManifest({...valid, version: 2}));
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...valid,
      maps: {main: 'javascript:alert(1)'},
      styles: {main: 'javascript:alert(1)'},
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({...valid, styles: {main: '/different/style.json'}}),
  );
  assert.throws(() => parseTileflowRuntimeManifest({...valid, maps: {}, styles: {}}));
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...valid,
      maps: {main: '/style.json'},
      styles: {main: '/style.json', other: '/other.json'},
    }),
  );
  for (const nonCanonicalName of ['Main', 'not_portable', ' main', 'main ', '1-main']) {
    assert.throws(() =>
      parseTileflowRuntimeManifest({
        ...valid,
        maps: {[nonCanonicalName]: '/style.json'},
        styles: {[nonCanonicalName]: '/style.json'},
      }),
    );
  }
  for (const unsafeName of ['constructor', 'prototype', '__proto__']) {
    const unsafe = JSON.parse(
      JSON.stringify({
        ...valid,
        maps: {[unsafeName]: '/style.json'},
        styles: {[unsafeName]: '/style.json'},
      }),
    ) as unknown;
    assert.throws(() => parseTileflowRuntimeManifest(unsafe));
  }
  assert.throws(() =>
    parseTileflowRuntimeManifest(Object.assign(Object.create({inherited: true}) as object, valid)),
  );

  const largeEntries = Object.fromEntries(
    Array.from({length: 500}, (_, index) => [`map-${index}`, `/${'a'.repeat(1_100)}${index}`]),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({...valid, maps: largeEntries, styles: largeEntries}),
  );
});

test('validates optional font faces and keeps them scoped to declared maps', () => {
  const manifest = parseTileflowRuntimeManifest({
    fontFaces: {
      main: [
        {
          family: 'Oxanium Medium',
          source: '../fonts/oxanium-medium.ttf',
          style: 'normal',
          weight: '500',
        },
      ],
    },
    kind: 'self-hosted',
    maps: {main: './styles/main.json'},
    styles: {main: './styles/main.json'},
    version: 3,
  });
  assert.equal(manifest.kind, 'self-hosted');
  if (manifest.kind !== 'self-hosted') throw new Error('Expected self-hosted manifest.');
  assert.equal(
    resolveTileflowManifestMap(manifest, 'main')?.fontFaces?.[0]?.family,
    'Oxanium Medium',
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...manifest,
      fontFaces: {missing: manifest.fontFaces?.main},
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...manifest,
      fontFaces: {main: [{family: 'Bad', source: 'data:font/ttf;base64,AA=='}]},
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...manifest,
      fontFaces: {
        main: [
          {family: 'Duplicate', source: '../fonts/a.woff2'},
          {
            family: 'Duplicate',
            source: '../fonts/b.woff2',
            style: 'normal',
            weight: '400',
          },
        ],
      },
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...manifest,
      fontFaces: {main: [{family: 'Bad', source: '../fonts%2Fsecret.woff2'}]},
    }),
  );
});

test('runtime view precedence is explicit values, manifest, then fallback', () => {
  assert.deepEqual(
    resolveTileflowRuntimeView({
      center: [3, 4],
      fallback: {bearing: 1, center: [0, 0], pitch: 2, zoom: 3},
      manifestMap: {view: {bearing: 10, center: [1, 2], zoom: 8}},
      zoom: 12,
    }),
    {bearing: 10, center: [3, 4], pitch: 2, zoom: 12},
  );
  assert.deepEqual(resolveTileflowRuntimeView({}), defaultTileflowRuntimeView);
  assert.deepEqual(normalizeTileflowRuntimeCenter({lat: 40.4, lng: -3.7}), [-3.7, 40.4]);
  assert.deepEqual(normalizeTileflowRuntimeCenter({lat: 40.4, lon: -3.7}), [-3.7, 40.4]);
  assert.deepEqual(normalizeTileflowRuntimeCenter(undefined), [0, 20]);
});

test('static image URLs encode hosted map IDs as one path segment', () => {
  const url = resolveTileflowStaticImageUrl({
    center: [1, 2],
    imageSize: {height: 320, width: 640},
    manifestMap: {
      apiUrl: 'https://api.example.test',
      mapId: '../map name?source=other',
    },
    zoom: 3,
  });

  assert.equal(
    url,
    'https://api.example.test/maps/..%2Fmap%20name%3Fsource%3Dother/static.png?center=1%2C2&zoom=3&width=640&height=320',
  );
});

test('manifest loading validates bounded JSON and only shares successful cache entries', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      kind: 'self-hosted',
      maps: {main: '/tileflow/styles/main.json'},
      styles: {main: '/tileflow/styles/main.json'},
      version: 3,
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearTileflowManifestCache();
  });

  clearTileflowManifestCache();
  const [first, second] = await Promise.all([
    loadTileflowManifest('/tileflow/manifest.json'),
    loadTileflowManifest('/tileflow/manifest.json'),
  ]);
  assert.equal(first?.kind, 'self-hosted');
  assert.equal(second, first);
  assert.equal(calls, 1);

  await assert.rejects(() =>
    loadTileflowManifest('/oversized.json', {
      cacheTtlMs: 0,
      fetch: (async () =>
        new Response('{}', {headers: {'content-length': String(1024 * 1024 + 1)}})) as typeof fetch,
    }),
  );
  assert.throws(() => loadTileflowManifest('javascript:alert(1)'), /safe HTTP/);
});

test('resolves loaded self-hosted resources against the manifest request and style URL', async (t) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {baseURI: 'https://app.example.test/app/'},
  });
  t.after(() => {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    clearTileflowManifestCache();
  });

  const manifest = await loadTileflowManifest('./tileflow/manifest.json', {
    cacheTtlMs: 0,
    fetch: (async () =>
      Response.json({
        fontFaces: {
          main: [
            {
              family: 'Oxanium Medium',
              source: '../fonts/oxanium-medium.ttf',
              weight: '500',
            },
          ],
        },
        kind: 'self-hosted',
        maps: {main: './generations/abc/styles/main.json'},
        styles: {main: './generations/abc/styles/main.json'},
        version: 3,
      })) as typeof fetch,
  });
  const resolved = manifest ? resolveTileflowManifestMap(manifest, 'main') : null;
  assert.equal(
    resolved?.styleUrl,
    'https://app.example.test/app/tileflow/generations/abc/styles/main.json',
  );
  assert.equal(
    resolved?.fontFaces?.[0]?.source,
    'https://app.example.test/app/tileflow/generations/abc/fonts/oxanium-medium.ttf',
  );
});

test('resolves hosted font resources against the owning style URL', async () => {
  const manifest = await loadTileflowManifest('https://app.example.test/tileflow/manifest.json', {
    cacheTtlMs: 0,
    fetch: (async () =>
      Response.json({
        apiUrl: 'https://api.example.test',
        kind: 'hosted',
        maps: {
          main: {
            environment: 'production',
            fontFaces: [
              {family: 'Atlas Text', source: '../fonts/atlas-regular.woff2', weight: '400'},
            ],
            mapId: 'map_main',
            styleUrl: 'https://cdn.example.test/releases/rev-1/styles/main.json',
          },
        },
        styles: {main: 'https://cdn.example.test/releases/rev-1/styles/main.json'},
        version: 3,
      })) as typeof fetch,
  });

  assert.equal(
    manifest && resolveTileflowManifestMap(manifest, 'main')?.fontFaces?.[0]?.source,
    'https://cdn.example.test/releases/rev-1/fonts/atlas-regular.woff2',
  );
});

test('manifest loading applies a bounded timeout and composes an external abort signal', async () => {
  const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason), {once: true});
    })) as typeof fetch;

  await assert.rejects(
    loadTileflowManifest('/timeout.json', {
      cacheTtlMs: 0,
      fetch: hangingFetch,
      timeoutMs: 5,
    }),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
  assert.throws(
    () => loadTileflowManifest('/timeout.json', {fetch: hangingFetch, timeoutMs: 60_001}),
    /between 1 and 60000/,
  );

  const controller = new AbortController();
  const external = loadTileflowManifest('/external-abort.json', {
    cacheTtlMs: 0,
    fetch: hangingFetch,
    signal: controller.signal,
  });
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(
    external,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );

  const cleanupController = new AbortController();
  const originalAddEventListener = cleanupController.signal.addEventListener.bind(
    cleanupController.signal,
  );
  const originalRemoveEventListener = cleanupController.signal.removeEventListener.bind(
    cleanupController.signal,
  );
  let listenerAdds = 0;
  let listenerRemoves = 0;
  cleanupController.signal.addEventListener = ((
    ...args: Parameters<AbortSignal['addEventListener']>
  ) => {
    listenerAdds += 1;
    return originalAddEventListener(...args);
  }) as AbortSignal['addEventListener'];
  cleanupController.signal.removeEventListener = ((
    ...args: Parameters<AbortSignal['removeEventListener']>
  ) => {
    listenerRemoves += 1;
    return originalRemoveEventListener(...args);
  }) as AbortSignal['removeEventListener'];

  let synchronousThrow = false;
  let request: Promise<unknown> | undefined;
  try {
    request = loadTileflowManifest('/synchronous-fetch-error.json', {
      cacheTtlMs: 0,
      fetch: (() => {
        throw new Error('synchronous fetch failure');
      }) as typeof fetch,
      signal: cleanupController.signal,
    });
  } catch {
    synchronousThrow = true;
  }
  assert.equal(synchronousThrow, false);
  await assert.rejects(request!, /synchronous fetch failure/);
  assert.equal(listenerAdds, 1);
  assert.equal(listenerRemoves, 1);
});
