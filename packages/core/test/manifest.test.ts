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
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowRuntimeView,
  resolveTileflowStaticImageUrl,
  type TileflowRuntimeManifest,
  tileflowRuntimeManifestSchema,
} from '../src';
import {createManifest} from '../src/build';
import {extendStreets, testLightTheme} from './map-fixture';

const validManifest = {
  maps: {
    main: {
      defaultTheme: 'light',
      themes: {
        light: {colorScheme: 'light', styleUrl: './styles/main/light.json'},
      },
    },
  },
  version: 1,
} as const satisfies TileflowRuntimeManifest;

test('creates one multi-theme manifest and transports configured views', () => {
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

  assert.deepEqual(manifest.maps.main?.view, {
    bearing: 12,
    center: [-3.7, 40.4],
    pitch: 35,
    zoom: 10,
  });
  assert.equal(manifest.maps.main?.defaultTheme, 'light');
  assert.deepEqual(Object.keys(manifest.maps.main?.themes ?? {}), ['light']);
  assert.equal(manifest.maps.main?.themes.light?.styleUrl, '/tileflow/styles/main/light.json');
  assert.deepEqual(resolveTileflowManifestMap(manifest, 'main')?.view, manifest.maps.main?.view);
});

test('manifest generation sorts maps and themes and transports inherited configuration', () => {
  const dark = {...testLightTheme, colorScheme: 'dark' as const, id: 'test-dark'};
  const parent = extendStreets({
    id: 'parent',
    defaultTheme: 'dark',
    systemThemes: {dark: 'dark', light: 'light'},
    themes: {dark, light: testLightTheme},
    view: {bearing: 8, center: [-3.7, 40.4], zoom: 9},
  });
  const alpha = defineMap({id: 'alpha', version: 1, extends: parent, view: {pitch: 40}});
  const zulu = extendStreets({id: 'zulu', view: {zoom: 3}});
  const manifest = createManifest({maps: {zulu, alpha}}, {styleBaseUrl: './tileflow/'});

  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest.maps), ['alpha', 'zulu']);
  assert.deepEqual(Object.keys(manifest.maps.alpha?.themes ?? {}), ['dark', 'light']);
  assert.deepEqual(manifest.maps.alpha?.systemThemes, {dark: 'dark', light: 'light'});
  assert.deepEqual(manifest.maps.alpha?.view, {
    bearing: 8,
    center: [-3.7, 40.4],
    pitch: 40,
    zoom: 9,
  });
});

test('manifest creation fails explicitly for non-canonical map identifiers', () => {
  for (const mapName of ['Main', 'not_portable', 'constructor', 'prototype', 'm'.repeat(65)]) {
    assert.throws(() =>
      createManifest({maps: Object.fromEntries([[mapName, extendStreets({id: mapName})]])}),
    );
  }
});

test('rejects every pre-theme manifest instead of normalizing aliases', () => {
  for (const legacy of [
    {kind: 'self-hosted', maps: {main: '/style.json'}, styles: {main: '/style.json'}, version: 3},
    {maps: {main: '/style.json'}, styles: {main: '/style.json'}, version: 3},
    {
      apiUrl: 'https://api.example.test',
      kind: 'hosted',
      maps: {main: {mapId: 'map_main', styleUrl: 'https://api.example.test/style.json'}},
      styles: {main: 'https://api.example.test/style.json'},
      version: 3,
    },
  ]) {
    assert.throws(() => parseTileflowRuntimeManifest(legacy));
  }
});

test('parses one canonical shape for local and Hosted delivery metadata', () => {
  assert.deepEqual(parseTileflowRuntimeManifest(validManifest), validManifest);
  const deployed = parseTileflowRuntimeManifest({
    apiUrl: 'https://api.example.test',
    maps: {
      main: {
        defaultTheme: 'dark',
        environment: 'production',
        mapId: 'map_main',
        systemThemes: {dark: 'dark', light: 'light'},
        themes: {
          dark: {
            colorScheme: 'dark',
            revision: 'rev-dark',
            styleId: 'style_dark',
            styleUrl: 'https://cdn.example.test/styles/main/dark.json',
          },
          light: {
            colorScheme: 'light',
            styleUrl: 'https://cdn.example.test/styles/main/light.json',
          },
        },
      },
    },
    version: 1,
  });
  const map = resolveTileflowManifestMap(deployed, 'main');
  assert.equal(map?.mapId, 'map_main');
  assert.equal(resolveTileflowRuntimeTheme(map!, 'system', 'dark').name, 'dark');
  assert.equal(
    resolveTileflowRuntimeStyle({manifestMap: map, source: {kind: 'tileflow', map: 'main'}})?.theme,
    'dark',
  );
});

test('canonical schema rejects drift, unsafe resources, and invalid theme relationships', () => {
  assert.equal(tileflowRuntimeManifestSchema.safeParse(validManifest).success, true);
  assert.equal(
    tileflowRuntimeManifestSchema.safeParse({...validManifest, extra: true}).success,
    false,
  );
  assert.throws(() => parseTileflowRuntimeManifest({...validManifest, version: 2}));
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...validManifest,
      maps: {
        main: {
          ...validManifest.maps.main,
          themes: {light: {colorScheme: 'light', styleUrl: 'javascript:alert(1)'}},
        },
      },
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...validManifest,
      maps: {main: {...validManifest.maps.main, defaultTheme: 'missing'}},
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...validManifest,
      maps: {
        main: {
          ...validManifest.maps.main,
          systemThemes: {dark: 'light', light: 'light'},
        },
      },
    }),
  );
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...validManifest,
      maps: {
        main: {
          defaultTheme: 'system',
          themes: {system: {colorScheme: 'light', styleUrl: '/style.json'}},
        },
      },
    }),
  );
  for (const name of ['CON', 'Dark', 'dark_mode', 'd'.repeat(65)]) {
    assert.throws(
      () =>
        parseTileflowRuntimeManifest({
          ...validManifest,
          maps: {
            main: {
              defaultTheme: name,
              themes: {[name]: {colorScheme: 'dark', styleUrl: '/style.json'}},
            },
          },
        }),
      undefined,
      name,
    );
  }
  assert.throws(() => parseTileflowRuntimeManifest({...validManifest, maps: {}}));
  assert.throws(() =>
    parseTileflowRuntimeManifest(Object.assign(Object.create({inherited: true}), validManifest)),
  );
});

test('font closures belong to concrete themes and reject unsafe or duplicate faces', () => {
  const manifest = parseTileflowRuntimeManifest({
    maps: {
      main: {
        defaultTheme: 'light',
        themes: {
          light: {
            colorScheme: 'light',
            fontFaces: [
              {
                family: 'Oxanium Medium',
                source: '../../fonts/oxanium-medium.ttf',
                style: 'normal',
                weight: '500',
              },
            ],
            styleUrl: './styles/main/light.json',
          },
        },
      },
    },
    version: 1,
  });
  assert.equal(
    resolveTileflowManifestMap(manifest, 'main')?.themes.light?.fontFaces?.[0]?.family,
    'Oxanium Medium',
  );
  const light = manifest.maps.main!.themes.light!;
  assert.throws(() =>
    parseTileflowRuntimeManifest({
      ...manifest,
      maps: {
        main: {
          ...manifest.maps.main,
          themes: {
            light: {
              ...light,
              fontFaces: [
                {family: 'Duplicate', source: '../a.woff2'},
                {family: 'Duplicate', source: '../b.woff2', style: 'normal', weight: '400'},
              ],
            },
          },
        },
      },
    }),
  );
});

test('runtime view precedence is explicit values, manifest, then fallback', () => {
  const manifestMap = {
    defaultTheme: 'light',
    name: 'main',
    themes: {light: {colorScheme: 'light' as const, styleUrl: '/light.json'}},
    view: {bearing: 10, center: [1, 2] as [number, number], zoom: 8},
  };
  assert.deepEqual(
    resolveTileflowRuntimeView({
      center: [3, 4],
      fallback: {bearing: 1, center: [0, 0], pitch: 2, zoom: 3},
      manifestMap,
      zoom: 12,
    }),
    {bearing: 10, center: [3, 4], pitch: 2, zoom: 12},
  );
  assert.deepEqual(resolveTileflowRuntimeView({}), defaultTileflowRuntimeView);
  assert.deepEqual(normalizeTileflowRuntimeCenter({lat: 40.4, lng: -3.7}), [-3.7, 40.4]);
});

test('static image URLs encode map IDs and always include one concrete theme', () => {
  const url = resolveTileflowStaticImageUrl({
    center: [1, 2],
    colorScheme: 'dark',
    imageSize: {height: 320, width: 640},
    manifestMap: {
      apiUrl: 'https://api.example.test',
      defaultTheme: 'light',
      mapId: '../map name?source=other',
      name: 'main',
      systemThemes: {dark: 'dark', light: 'light'},
      themes: {
        dark: {colorScheme: 'dark', styleUrl: '/dark.json'},
        light: {colorScheme: 'light', styleUrl: '/light.json'},
      },
    },
    theme: 'system',
    zoom: 3,
  });
  assert.equal(
    url,
    'https://api.example.test/maps/..%2Fmap%20name%3Fsource%3Dother/static.png?center=1%2C2&theme=dark&zoom=3&width=640&height=320',
  );
});

test('manifest loading validates bounded JSON and shares successful cache entries', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(validManifest);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    clearTileflowManifestCache();
  });

  const [first, second] = await Promise.all([
    loadTileflowManifest('/tileflow/manifest.json'),
    loadTileflowManifest('/tileflow/manifest.json'),
  ]);
  assert.equal(second, first);
  assert.equal(calls, 1);
  await assert.rejects(() =>
    loadTileflowManifest('/oversized.json', {
      cacheTtlMs: 0,
      fetch: (async () =>
        new Response('{}', {headers: {'content-length': String(1024 * 1024 + 1)}})) as typeof fetch,
    }),
  );
});

test('loaded theme resources resolve against the manifest and their owning style URL', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {baseURI: 'https://app.example.test/app/'},
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  const manifest = await loadTileflowManifest('./tileflow/manifest.json', {
    cacheTtlMs: 0,
    fetch: (async () => Response.json(validManifest)) as typeof fetch,
  });
  const theme = manifest && resolveTileflowManifestMap(manifest, 'main')?.themes.light;
  assert.equal(theme?.styleUrl, 'https://app.example.test/app/tileflow/styles/main/light.json');
});

test('manifest loading applies a bounded timeout and composes an external abort signal', async () => {
  const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), {once: true});
    })) as typeof fetch;

  await assert.rejects(
    loadTileflowManifest('/timeout.json', {cacheTtlMs: 0, fetch: hangingFetch, timeoutMs: 5}),
    (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError',
  );
  const controller = new AbortController();
  const pending = loadTileflowManifest('/abort.json', {
    cacheTtlMs: 0,
    fetch: hangingFetch,
    signal: controller.signal,
  });
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
