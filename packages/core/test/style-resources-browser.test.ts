import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController, loadTileflowRuntimeStyle} from '../src/browser';
import {createTileflowStyleFamily, materializeTileflowStyleFamily} from '../src/style-family';
import {resolveTileflowStyleResourceUrls} from '../src/style-family-runtime';
import type {MapLibreStyle} from '../src/types';

const documentUrl = 'https://maps.example/app/generations/123/styles/city/light.json';
const emptyStyle = (): MapLibreStyle => ({version: 8, name: 'city', sources: {}, layers: []});
const json = (value: unknown) => new Response(JSON.stringify(value));

test('prepares every ranged font file without mutating its coverage or input', async () => {
  const input = {
    ...emptyStyle(),
    'font-faces': {
      Brand: [
        {url: '../../fonts/brand.ttf', 'unicode-range': ['U+0020-007E']},
        {url: '../../fonts/greek.otf', 'unicode-range': ['U+0370-03FF']},
      ],
    },
  };
  const before = JSON.stringify(input);
  const {style} = await loadTileflowRuntimeStyle({style: input as never}, {baseUrl: documentUrl});

  assert.deepEqual(style['font-faces'], {
    Brand: [
      {
        url: 'https://maps.example/app/generations/123/fonts/brand.ttf',
        'unicode-range': ['U+0020-007E'],
      },
      {
        url: 'https://maps.example/app/generations/123/fonts/greek.otf',
        'unicode-range': ['U+0370-03FF'],
      },
    ],
  });
  assert.equal(JSON.stringify(input), before);
});

test('prepares portable sprites, fonts, sources and models without touching application data', async () => {
  const geojson = {type: 'FeatureCollection', features: [], url: '../not-a-resource'};
  const layers = [
    {id: 'icons', type: 'symbol', source: 'places', layout: {'icon-image': '../icon-id'}},
  ];
  const custom = {url: '../application-data'};
  const input: MapLibreStyle = {
    ...emptyStyle(),
    sprite: [
      {id: 'default', url: '../../icons/sprite?signature=a%2Fb+%20'},
      {id: 'extra', url: '/shared/sprite'},
    ],
    glyphs: '../../fonts/{fontstack}/{range}.pbf',
    'font-faces': {
      Sans: '../fonts/sans.woff2',
      Emoji: {url: '//cdn.example/emoji.woff2', 'unicode-range': ['U+1F600-1F64F']},
    },
    sources: {
      vector: {
        type: 'vector',
        tiles: ['../tiles/{z}/{x}/{y}{ratio}.pbf?bbox={bbox-epsg-3857}&literal=%7Bz%7D'],
      },
      image: {type: 'image', url: '../image.png'},
      data: {type: 'geojson', data: '../places.json'},
      inline: {type: 'geojson', data: geojson},
      movie: {type: 'video', urls: ['../video.webm', '/video.mp4']},
      archive: {type: 'vector', url: 'tileflow-pmtiles://https://cdn.example/world.pmtiles'},
      extension: {type: 'application', url: '../custom-data', tiles: ['../opaque-data']},
    },
    layers,
    metadata: {
      custom,
      'tileflow:fontFaces': [{family: 'Sans', source: '../../fonts/sans.woff2'}],
      'tileflow:buildings': {
        models: [{model: 'tower', url: '../../models/tower.glb'}],
        landmarks: {url: '../../landmarks/index.json'},
      },
    },
  };
  const before = JSON.stringify(input);
  const {style} = await loadTileflowRuntimeStyle(
    {style: input},
    {
      baseUrl: documentUrl,
      fetch: async () => {
        throw new Error('Unexpected fetch');
      },
    },
  );
  assert.deepEqual(style.sprite, [
    {
      id: 'default',
      url: 'https://maps.example/app/generations/123/icons/sprite?signature=a%2Fb+%20',
    },
    {id: 'extra', url: 'https://maps.example/shared/sprite'},
  ]);
  assert.equal(
    style.glyphs,
    'https://maps.example/app/generations/123/fonts/{fontstack}/{range}.pbf',
  );
  assert.deepEqual(style['font-faces'], {
    Sans: 'https://maps.example/app/generations/123/styles/fonts/sans.woff2',
    Emoji: {url: 'https://cdn.example/emoji.woff2', 'unicode-range': ['U+1F600-1F64F']},
  });
  assert.equal(
    style.sources.vector!.tiles?.[0],
    'https://maps.example/app/generations/123/styles/tiles/{z}/{x}/{y}{ratio}.pbf?bbox={bbox-epsg-3857}&literal=%7Bz%7D',
  );
  assert.equal(
    style.sources.image!.url,
    'https://maps.example/app/generations/123/styles/image.png',
  );
  assert.equal(
    style.sources.data!.data,
    'https://maps.example/app/generations/123/styles/places.json',
  );
  assert.deepEqual(style.sources.movie!.urls, [
    'https://maps.example/app/generations/123/styles/video.webm',
    'https://maps.example/video.mp4',
  ]);
  assert.equal(style.sources.archive!.url, input.sources.archive!.url);
  assert.deepEqual(style.sources.extension, input.sources.extension);
  assert.deepEqual(style.metadata!['tileflow:fontFaces'], [
    {family: 'Sans', source: 'https://maps.example/app/generations/123/fonts/sans.woff2'},
  ]);
  assert.deepEqual(style.metadata!['tileflow:buildings'], {
    models: [{model: 'tower', url: 'https://maps.example/app/generations/123/models/tower.glb'}],
    landmarks: {url: 'https://maps.example/app/generations/123/landmarks/index.json'},
  });
  assert.equal(style.sources.inline!.data, geojson);
  assert.equal(style.layers, layers);
  assert.equal(style.metadata!.custom, custom);
  assert.equal(JSON.stringify(input), before);
});

test('loads TileJSON once, uses its own directory, and preserves style overrides and request policy', async () => {
  const requests: {url: string; init?: RequestInit}[] = [];
  const transforms: string[] = [];
  const style: MapLibreStyle = {
    ...emptyStyle(),
    sprite: '/icons/sprite',
    sources: {
      roads: {type: 'vector', url: '../../data/world.json', maxzoom: 12},
      land: {type: 'vector', url: '../../data/world.json'},
      own: {type: 'vector', url: '../../data/world.json', tiles: ['./own/{z}/{x}/{y}.pbf']},
    },
  };
  const loaded = await loadTileflowRuntimeStyle(
    {
      style: documentUrl,
      theme: 'light',
      fontFaces: [{family: 'Sans', source: '../../fonts/sans.woff2'}],
    },
    {
      transformRequest: (url, type) => {
        transforms.push(type);
        return {url, credentials: 'include', headers: {Authorization: 'test-token'}};
      },
      fetch: async (url, init) => {
        requests.push({url: String(url), init});
        return json(
          String(url) === documentUrl
            ? style
            : {
                tiles: ['tiles/{z}/{x}/{y}.pbf?key=a%2Bb'],
                maxzoom: 14,
                attribution: 'Map source',
                promoteId: 'untrusted-option',
              },
        );
      },
    },
  );
  assert.deepEqual(transforms, ['Style', 'Source']);
  assert.deepEqual(
    requests.map((r) => r.url),
    [documentUrl, 'https://maps.example/app/generations/123/data/world.json'],
  );
  for (const {init} of requests) {
    assert.equal(init?.credentials, 'include');
    assert.deepEqual(init?.headers, {Authorization: 'test-token'});
  }
  assert.equal(loaded.style.sources.roads!.url, undefined);
  assert.deepEqual(loaded.style.sources.roads!.tiles, [
    'https://maps.example/app/generations/123/data/tiles/{z}/{x}/{y}.pbf?key=a%2Bb',
  ]);
  assert.equal(loaded.style.sources.roads!.maxzoom, 12);
  assert.equal(loaded.style.sources.land!.maxzoom, 14);
  assert.equal(loaded.style.sources.roads!.attribution, 'Map source');
  assert.equal(loaded.style.sources.roads!.promoteId, undefined);
  assert.deepEqual(loaded.style.sources.own!.tiles, [
    'https://maps.example/app/generations/123/styles/city/own/{z}/{x}/{y}.pbf',
  ]);
  assert.equal(
    loaded.fontFaces![0]!.source,
    'https://maps.example/app/generations/123/fonts/sans.woff2',
  );
});

test('keeps signed absolute URLs and protocol-owned source documents unchanged', async () => {
  const sprite = 'https://cdn.example/a/../sprite?token=a%2fb+%20';
  const input: MapLibreStyle = {
    ...emptyStyle(),
    sprite,
    sources: {
      custom: {type: 'vector', url: 'mapbox://tiles/world'},
      delegated: {type: 'vector', url: 'https://maps.example/source.json'},
    },
  };
  const loaded = await loadTileflowRuntimeStyle(
    {style: input},
    {
      transformRequest: (url) => ({url: `private://${encodeURIComponent(url)}`}),
      fetch: async () => {
        throw new Error('A protocol must handle this source');
      },
    },
  );
  assert.equal(loaded.style.sprite, sprite);
  assert.deepEqual(loaded.style.sources, input.sources);
});

test('prepares family resources with the request policy and reuses them for appearances and rebuilds', async () => {
  const variant = (color: string): MapLibreStyle => ({
    ...emptyStyle(),
    sprite: './icons/sprite',
    glyphs: './fonts/{fontstack}/{range}.pbf',
    'font-faces': {Sans: './fonts/sans.woff2'},
    sources: {world: {type: 'vector', url: './data/world.json'}},
    metadata: {'tileflow:vegetation': {models: [{url: './models/tree.glb'}]}},
    layers: [{id: 'background', type: 'background', paint: {'background-color': color}}],
  });
  const family = createTileflowStyleFamily({light: variant('#ffffff'), dark: variant('#000000')});
  const before = JSON.stringify(family);
  const requests: string[] = [];
  const prepared = await loadTileflowRuntimeStyle(
    {theme: 'light', style: documentUrl, familyUrl: '/family.json'},
    {
      baseUrl: 'https://app.example/nested/page',
      transformRequest: (url, type) => ({
        url: type === 'Style' ? 'https://cdn.example/published/family.json' : url,
        headers: {Authorization: 'family-token'},
      }),
      fetch: async (url, init) => {
        assert.deepEqual(init?.headers, {Authorization: 'family-token'});
        requests.push(String(url));
        return json(requests.length === 1 ? family : {tiles: ['./tiles/{z}/{x}/{y}.pbf']});
      },
    },
  );
  assert.deepEqual(requests, [
    'https://cdn.example/published/family.json',
    'https://cdn.example/published/data/world.json',
  ]);
  assert.equal(prepared.style.sprite, 'https://cdn.example/published/icons/sprite');
  assert.equal(
    prepared.style.glyphs,
    'https://cdn.example/published/fonts/{fontstack}/{range}.pbf',
  );
  assert.deepEqual(prepared.style['font-faces'], {
    Sans: 'https://cdn.example/published/fonts/sans.woff2',
  });
  assert.deepEqual(prepared.style.metadata!['tileflow:vegetation'], {
    models: [{url: 'https://cdn.example/published/models/tree.glb'}],
  });
  assert.equal(JSON.stringify(family), before);
  const listeners = new Map<string, Set<() => void>>();
  const applied: MapLibreStyle[] = [];
  const controller = createTileflowThemeController({
    initial: prepared,
    loadFonts: async () => {},
    styleLoadOptions: {fetch: async () => assert.fail('a prepared family must be reused')},
    map: {
      on(type, handler) {
        const handlers = listeners.get(type) ?? new Set();
        handlers.add(handler);
        listeners.set(type, handlers);
      },
      off(type, handler) {
        listeners.get(type)?.delete(handler);
      },
      setPaintProperty() {},
      setStyle(style) {
        applied.push(style as MapLibreStyle);
        queueMicrotask(() => {
          for (const handler of listeners.get('style.load') ?? []) handler();
        });
      },
    },
  });
  const target = {theme: 'dark', familyUrl: '/family.json', style: documentUrl};
  assert.equal((await controller.setTheme(target, {transition: {duration: 0}})).status, 'applied');
  assert.equal(applied.length, 0, 'appearance changes retain the map sources');
  assert.equal(
    (await controller.setTheme(target, {rebuild: true, transition: {duration: 0}})).status,
    'applied',
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0]!.sources.world!.url, undefined);
  assert.deepEqual(applied[0]!.sources.world!.tiles, [
    'https://cdn.example/published/data/tiles/{z}/{x}/{y}.pbf',
  ]);
  assert.equal(applied[0]!.sprite, prepared.style.sprite);
  controller.dispose();
});

test('prepares structural family variants without fetching a shared TileJSON twice', async () => {
  const variant = (sprite: string): MapLibreStyle => ({
    ...emptyStyle(),
    sprite,
    sources: {world: {type: 'vector', url: './world.json'}},
  });
  const family = createTileflowStyleFamily({
    light: variant('./light/sprite'),
    dark: variant('./dark/sprite'),
  });
  assert.equal(family.updates.appearanceOnly, false);
  const requests: string[] = [];
  const prepared = await loadTileflowRuntimeStyle(
    {theme: 'light', style: documentUrl, familyUrl: 'https://maps.example/family.json'},
    {
      fetch: async (url) => {
        requests.push(String(url));
        return json(
          String(url).endsWith('/family.json') ? family : {tiles: ['./tiles/{z}/{x}/{y}.pbf']},
        );
      },
    },
  );
  assert.deepEqual(requests, [
    'https://maps.example/family.json',
    'https://maps.example/world.json',
  ]);
  const dark = materializeTileflowStyleFamily(prepared.family!, 'dark');
  assert.equal(dark.sprite, 'https://maps.example/dark/sprite');
  assert.deepEqual(dark.sources.world!.tiles, ['https://maps.example/tiles/{z}/{x}/{y}.pbf']);
});

test('uses the fetched style document location and requires an explicit base outside a browser', async () => {
  const loaded = await loadTileflowRuntimeStyle(
    {style: '/light.json'},
    {
      baseUrl: 'https://app.example/nested/page',
      transformRequest: (url) => ({url: url.replace('app.example', 'cdn.example')}),
      fetch: async () => json({...emptyStyle(), sprite: './icons/sprite'}),
    },
  );
  assert.equal(loaded.style.sprite, 'https://cdn.example/icons/sprite');
  await assert.rejects(
    loadTileflowRuntimeStyle({style: {...emptyStyle(), sprite: './sprite'}}),
    /absolute style URL or baseUrl/,
  );
});

test('fails before constructing a map on HTTP errors, invalid documents and oversized responses', async () => {
  for (const response of [
    new Response('', {status: 403}),
    json({version: 8}),
    new Response('[]'),
    new Response('{}', {headers: {'content-length': String(17 * 1024 * 1024)}}),
  ]) {
    await assert.rejects(
      loadTileflowRuntimeStyle({style: documentUrl}, {fetch: async () => response}),
    );
  }
  await assert.rejects(
    loadTileflowRuntimeStyle(
      {
        style: {
          ...emptyStyle(),
          sources: {bad: {type: 'vector', url: 'https://maps.example/source.json'}},
        },
      },
      {fetch: async () => json({})},
    ),
    /tiles array/,
  );
});

test('cancels an in-flight resource fetch and never fetches for an already aborted load', async () => {
  const abort = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const loading = loadTileflowRuntimeStyle(
    {style: documentUrl},
    {
      signal: abort.signal,
      fetch: async (_url, init) => {
        started();
        return new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true}),
        );
      },
    },
  );
  await ready;
  abort.abort();
  await assert.rejects(loading, {name: 'AbortError'});
  await assert.rejects(
    loadTileflowRuntimeStyle(
      {style: documentUrl},
      {
        signal: abort.signal,
        fetch: async () => {
          assert.fail('aborted load fetched');
        },
      },
    ),
    {name: 'AbortError'},
  );
});

test('theme changes prepare relative sprites and rollback uses the last prepared document', async () => {
  const initial = {style: documentUrl, theme: 'light'};
  const styles: MapLibreStyle[] = [];
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const prepared = await loadTileflowRuntimeStyle(initial, {
    fetch: async () => json({...emptyStyle(), sprite: '../../icons/light'}),
  });
  const map = {
    on: (type: string, handler: (event?: unknown) => void) => {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    off: (type: string, handler: (event?: unknown) => void) => {
      listeners.get(type)?.delete(handler);
    },
    setStyle: (input: unknown) => {
      const style = input as MapLibreStyle;
      styles.push(style);
      queueMicrotask(() => {
        for (const handler of listeners.get(style.name === 'broken' ? 'error' : 'style.load') ?? [])
          handler(style.name === 'broken' ? {error: new Error('broken')} : undefined);
      });
    },
  };
  const controller = createTileflowThemeController({
    initial,
    initialStyle: prepared.style,
    map,
    loadFonts: async () => {},
    styleLoadOptions: {
      fetch: async (url) =>
        json({
          ...emptyStyle(),
          name: String(url).includes('broken') ? 'broken' : 'dark',
          sprite: '../../icons/dark',
        }),
    },
  });
  const dark = {style: documentUrl.replace('light', 'dark'), theme: 'dark'};
  assert.equal((await controller.setTheme(dark)).status, 'applied');
  assert.equal(controller.getCurrent(), dark);
  assert.equal(styles[0]!.sprite, 'https://maps.example/app/generations/123/icons/dark');
  assert.equal(
    (await controller.setTheme({style: documentUrl.replace('light', 'broken'), theme: 'broken'}))
      .status,
    'failed',
  );
  assert.equal(styles.at(-1), styles[0]);
  controller.dispose();
});

for (const resource of ['style', 'family']) {
  test(`disposing a theme controller aborts ${resource} preparation without applying the late result`, async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    const controller = createTileflowThemeController({
      initial: {theme: 'light', style: emptyStyle()},
      map: {
        on() {},
        off() {},
        setStyle() {
          assert.fail('disposed controller applied a style');
        },
      },
      loadFonts: async () => {},
      styleLoadOptions: {
        fetch: async (_url, init) => {
          signal = init!.signal!;
          started();
          return new Promise((_resolve, reject) =>
            signal!.addEventListener('abort', () => reject(signal!.reason), {once: true}),
          );
        },
      },
    });
    const change = controller.setTheme({
      theme: 'dark',
      style: documentUrl,
      ...(resource === 'family' ? {familyUrl: 'https://maps.example/family.json'} : {}),
    });
    await ready;
    controller.dispose();
    assert.equal(signal?.aborted, true);
    assert.equal((await change).status, 'superseded');
  });
}

test('style-family resolution preserves the ownership of font files and licenses', () => {
  const style = {
    version: 8 as const,
    sources: {},
    layers: [],
    'font-faces': {Display: [{url: '../fonts/display.ttf', 'unicode-range': ['U+0020-007E']}]},
    metadata: {'tileflow:fontLicenses': ['../fonts/LICENSE.txt']},
  };
  const resolved = resolveTileflowStyleResourceUrls(
    style,
    'https://maps.example/generation/families/map.json',
  );
  assert.deepEqual(resolved.metadata?.['tileflow:fontLicenses'], [
    'https://maps.example/generation/fonts/LICENSE.txt',
  ]);
  assert.equal(
    (resolved['font-faces']!.Display as {url: string}[])[0]!.url,
    'https://maps.example/generation/fonts/display.ttf',
  );
  assert.equal(style['font-faces'].Display[0]!.url, '../fonts/display.ttf');
});
