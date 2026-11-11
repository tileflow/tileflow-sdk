import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createTileflowIconSetProject} from '../../../test-support/icon-set-project';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {withTileflow} from '../src/index';
import {createTileflowRouteHandlers} from '../src/server';
import {
  emitTileflowRouteSnapshot,
  findTileflowRouteSnapshot,
  getTileflowRouteSnapshotDirectory,
} from '../src/snapshot';

test('reuses one watched generation across repeated mutable requests', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-watched-server-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig('#112233'));
  const handlers = createTileflowRouteHandlers({compileWaitMs: 60_000, cwd});
  t.after(() => handlers.close());
  const style = new Request('http://localhost/tileflow/styles/main/light.json');

  assert.equal((await handlers.GET(style)).status, 200);
  assert.equal((await handlers.GET(style)).status, 200);
  const status = (await (
    await handlers.GET(new Request('http://localhost/tileflow/__status'))
  ).json()) as {generation: number};

  assert.equal(status.generation, 1);
});

test('does not share a Next session across distinct explicit icon transports', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-icon-transport-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig());
  const first = createTileflowRouteHandlers({
    compileWaitMs: 60_000,
    cwd,
    icons: {cacheRoot: cwd, fetch: async () => Response.error()},
  });
  const second = createTileflowRouteHandlers({
    compileWaitMs: 60_000,
    cwd,
    icons: {cacheRoot: cwd, fetch: async () => Response.error()},
  });
  t.after(async () => {
    await Promise.allSettled([first.close(), second.close()]);
  });
  const request = new Request('http://localhost/tileflow/styles/main/light.json');

  assert.equal((await first.GET(request)).status, 200);
  assert.equal((await second.GET(request)).status, 200);
  await first.close();
  assert.equal((await second.GET(request)).status, 200);
});

test('emits production artifacts without adding a webpack config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-'));
  await linkWorkspacePackages(cwd);
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig(), 'utf8');
    process.env.NODE_ENV = 'production';

    const config = withTileflow({}, {cwd});
    assert.equal(config.webpack, undefined);
    assert.equal(typeof config.rewrites, 'function');

    const rewrites = await config.rewrites!();
    assert.deepEqual(rewrites, []);

    const manifest = JSON.parse(
      await readFile(join(cwd, 'public/tileflow/manifest.json'), 'utf8'),
    ) as RuntimeManifest;
    assert.equal(manifest.version, 3);
    assert.equal(Object.hasOwn(manifest, 'kind'), false);
    assert.equal(Object.hasOwn(manifest, 'styles'), false);
    const map = manifest.maps.main;
    assert.ok(map);
    assert.match(
      map.familyUrl ?? '',
      /^\/tileflow\/generations\/[a-f0-9]{64}\/families\/main\.json$/u,
    );
    const family = JSON.parse(await readFile(join(cwd, 'public', map.familyUrl!), 'utf8'));
    assert.equal(family.kind, 'tileflow-style-family');
    assert.deepEqual([...family.themes].sort(), ['dark', 'light']);
    assert.equal(map.defaultTheme, 'light');
    assert.deepEqual(map.systemThemes, {dark: 'dark', light: 'light'});
    assert.deepEqual(Object.keys(map.themes).sort(), ['dark', 'light']);
    assert.match(
      map.themes.light?.styleUrl ?? '',
      /^\/tileflow\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/,
    );
    assert.match(
      map.themes.dark?.styleUrl ?? '',
      /^\/tileflow\/generations\/[a-f0-9]{64}\/styles\/main\/dark\.json$/,
    );
    const [lightStyle, darkStyle] = await Promise.all([
      readFile(join(cwd, 'public/tileflow/styles/main/light.json'), 'utf8').then(JSON.parse),
      readFile(join(cwd, 'public/tileflow/styles/main/dark.json'), 'utf8').then(JSON.parse),
    ]);
    const style = lightStyle as {
      glyphs?: string;
      sources?: {tileflow?: {url?: string}};
      sprite?: string;
      version?: number;
    };
    assert.equal((darkStyle as {version?: number}).version, 8);
    assert.equal(style.version, 8);
    assert.equal(style.sources?.tileflow?.url, 'https://api.tileflow.dev/tiles/world/tiles.json');
    assert.equal(style.glyphs, glyphUrl);
    assert.equal(style.sprite, '/tileflow/icons/main/sprite');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    await rm(cwd, {force: true, recursive: true});
  }
});

test('rejects a local PMTiles source before writing Next production assets', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-local-tileset-'));
  await linkWorkspacePackages(cwd);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await rm(cwd, {force: true, recursive: true});
  });
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  const config = withTileflow({}, {cwd});
  await assert.rejects(() => config.rewrites!(), {code: 'TF_LOCAL_TILESET_PRODUCTION_UNRESOLVED'});
  await assert.rejects(stat(join(cwd, 'public')), {code: 'ENOENT'});
});

test('combines valid Next and Tileflow base paths without changing URL kind', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    process.env.NODE_ENV = previousNodeEnv;
  });
  const cases = [
    [
      '',
      '/maps',
      'public/maps/manifest.json',
      /^\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
    ],
    [
      '/app',
      '/maps',
      'public/maps/manifest.json',
      /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
    ],
    [
      '/app',
      '',
      'public/manifest.json',
      /^\/app\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
    ],
  ] as const;

  for (const [nextBasePath, tileflowBase, manifestPath, expectedStyleUrl] of cases) {
    await t.test(`${nextBasePath || '<root>'}:${tileflowBase || '<root>'}`, async (subtest) => {
      const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-base-'));
      await linkWorkspacePackages(cwd);
      subtest.after(() => rm(cwd, {force: true, recursive: true}));
      await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig());
      const config = withTileflow(
        {...(nextBasePath ? {basePath: nextBasePath} : {})},
        {base: tileflowBase, cwd},
      );
      await config.rewrites!();
      const manifest = JSON.parse(
        await readFile(join(cwd, manifestPath), 'utf8'),
      ) as RuntimeManifest;
      assert.match(manifest.maps.main?.themes.light?.styleUrl ?? '', expectedStyleUrl);
    });
  }
});

test('preserves a Hosted manifest unless overwrite is explicitly enabled', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-hosted-'));
  await linkWorkspacePackages(cwd);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await rm(cwd, {force: true, recursive: true});
  });
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig());
  const manifestPath = join(cwd, 'public', 'tileflow', 'manifest.json');
  await mkdir(join(cwd, 'public', 'tileflow'), {recursive: true});
  const hosted = createHostedManifest();
  await writeFile(manifestPath, `${JSON.stringify(hosted)}\n`);

  const guarded = withTileflow({}, {cwd});
  await assert.rejects(() => guarded.rewrites!(), {
    code: 'HOSTED_MANIFEST_OVERWRITE_REFUSED',
  });
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), hosted);

  const optedIn = withTileflow({}, {cwd, overwriteHostedManifest: true});
  await optedIn.rewrites!();
  const replacement = JSON.parse(await readFile(manifestPath, 'utf8')) as RuntimeManifest;
  assertLocalManifest(replacement);
});

test('rejects route traversal and publicDir escape before writing Next artifacts', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-containment-'));
  await linkWorkspacePackages(cwd);
  const outside = await mkdtemp(join(tmpdir(), 'tileflow-next-outside-'));
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    await Promise.all([
      rm(cwd, {force: true, recursive: true}),
      rm(outside, {force: true, recursive: true}),
    ]);
  });
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig());
  await writeFile(join(outside, 'sentinel.txt'), 'untouched\n');

  for (const [nextConfig, options] of [
    [{basePath: '../app'}, {cwd}],
    [{}, {base: '../maps', cwd}],
  ] as const) {
    const config = withTileflow(nextConfig, options);
    await assert.rejects(() => config.rewrites!(), /Invalid Tileflow base path/u);
  }

  const escaping = withTileflow({}, {cwd, publicDir: outside});
  await assert.rejects(
    () => escaping.rewrites!(),
    /artifact output escapes its working directory/u,
  );
  assert.equal(await readFile(join(outside, 'sentinel.txt'), 'utf8'), 'untouched\n');
  await assert.rejects(() => readFile(join(outside, 'tileflow', 'manifest.json')), {
    code: 'ENOENT',
  });
});

test('prepends Tileflow development rewrites without replacing user rewrites', async () => {
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = 'development';
    const config = withTileflow({
      async rewrites() {
        return [{destination: '/existing', source: '/original'}];
      },
    });

    assert.deepEqual(await config.rewrites!(), [
      {destination: '/api/tileflow', source: '/tileflow'},
      {destination: '/api/tileflow/:path*', source: '/tileflow/:path*'},
      {destination: '/existing', source: '/original'},
    ]);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('refreshes direct style requests after a config edit without requiring a manifest request', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-server-'));
  await linkWorkspacePackages(cwd);
  const configPath = join(cwd, 'tileflow.config.ts');
  let handlers: ReturnType<typeof createTileflowRouteHandlers> | undefined;
  try {
    await writeFile(configPath, configWithBackground('#112233'));
    handlers = createTileflowRouteHandlers({compileWaitMs: 60_000, cwd});
    const request = new Request('http://localhost/tileflow/styles/main/light.json');
    const first = await handlers.GET(request);
    const firstStyle = await first.json();
    assert.equal(backgroundColor(firstStyle), '#112233');
    assert.equal(vectorUrl(firstStyle), 'https://api.tileflow.dev/tiles/world/tiles.json');

    await writeFile(configPath, configWithBackground('#445566'));
    const deadline = Date.now() + 3_000;
    while (true) {
      const second = await handlers.GET(request);
      if (backgroundColor(await second.json()) === '#445566') break;
      if (Date.now() > deadline) throw new Error('Next watcher did not publish the config edit.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await handlers?.close();
    await rm(cwd, {force: true, recursive: true});
  }
});

function configWithBackground(background: string): string {
  return rootConfig(background);
}

function rootConfig(background?: string): string {
  const tokens = background
    ? `, tokens: {color: {'surface.background': ${JSON.stringify(background)}}}`
    : '';
  return `import {defineMap, defineTheme} from '@tileflow/core'; import {streetsIcons, streetsThemes} from '@tileflow/maps'; export default defineMap({id: 'main', version: 1, defaultTheme: 'light', systemThemes: {dark: 'dark', light: 'light'}, themes: {dark: streetsThemes.dark, light: defineTheme(streetsThemes.light, {id: 'fixture-light', version: 1, colorScheme: 'light'${tokens}})}, icons: [streetsIcons], glyphs: {kind: 'url', url: '${glyphUrl}', fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']}});\n`;
}

function createHostedManifest(): RuntimeManifest {
  return {
    apiUrl: 'https://api.example.test',
    maps: {
      main: {
        defaultTheme: 'light',
        environment: 'production',
        mapId: 'map_main',
        themes: {
          light: {
            colorScheme: 'light',
            styleId: 'style_main',
            styleUrl: 'https://styles.example.test/main/light.json',
          },
        },
      },
    },
    version: 1,
  };
}

function assertLocalManifest(manifest: RuntimeManifest): void {
  assert.equal(manifest.version, 3);
  assert.equal(manifest.apiUrl, undefined);
  assert.equal(Object.hasOwn(manifest, 'kind'), false);
  assert.equal(Object.hasOwn(manifest, 'styles'), false);
  const map = manifest.maps.main;
  assert.ok(map);
  assert.equal(map.environment, undefined);
  assert.equal(map.mapId, undefined);
  assert.equal(map.themes.light?.styleId, undefined);
  assert.match(
    map.themes.light?.styleUrl ?? '',
    /^\/tileflow\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
  );
}

function backgroundColor(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>}).layers;
  return layers?.find((layer) => layer.id === 'tileflow-background')?.paint?.['background-color'];
}

function vectorUrl(style: unknown): unknown {
  return (style as {sources?: {tileflow?: {url?: unknown}}}).sources?.tileflow?.url;
}

const glyphUrl = 'https://assets.example.test/base/exact/glyphs/{fontstack}/{range}.pbf';

type RuntimeManifest = {
  apiUrl?: string;
  maps: Record<
    string,
    {
      defaultTheme: string;
      familyUrl?: string;
      environment?: string;
      mapId?: string;
      systemThemes?: {dark: string; light: string};
      themes: Record<
        string,
        {
          colorScheme: 'dark' | 'light';
          styleId?: string;
          styleUrl: string;
        }
      >;
    }
  >;
  version: 1 | 2 | 3;
};

test('the Next production build and dev route serve the exact locked icon composition', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-icon-sets-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await createTileflowIconSetProject(cwd);
  const icons = {cacheRoot: cwd, offline: true} as const;
  const previousNodeEnv = process.env.NODE_ENV;

  const handlers = createTileflowRouteHandlers({compileWaitMs: 60_000, cwd, icons});
  t.after(() => handlers.close());
  let sprite = await handlers.GET(new Request('http://localhost/tileflow/icons/main/sprite.json'));
  for (let attempt = 0; attempt < 40 && sprite.status === 503; attempt += 1) {
    await new Promise((settle) => setTimeout(settle, 50));
    sprite = await handlers.GET(new Request('http://localhost/tileflow/icons/main/sprite.json'));
  }
  assert.equal(sprite.status, 200, await sprite.clone().text());
  assert.deepEqual(Object.keys((await sprite.json()) as Record<string, unknown>).sort(), [
    'bus',
    'hospital',
    'shop',
  ]);

  try {
    process.env.NODE_ENV = 'production';
    const config = withTileflow({}, {cwd, icons});
    await config.rewrites!();
    const buildManifest = JSON.parse(
      await readFile(join(cwd, 'public/tileflow/build-manifest.json'), 'utf8'),
    ) as {
      maps: Record<
        string,
        {
          mapRevisionSchemaVersion?: number;
          sourceAssets: {iconComposition?: {contributors: Array<{reference?: string}>}};
        }
      >;
    };
    assert.equal(buildManifest.maps.main?.mapRevisionSchemaVersion, 2);
    assert.deepEqual(
      buildManifest.maps.main?.sourceAssets.iconComposition?.contributors.map(
        (contributor) => contributor.reference ?? 'local',
      ),
      ['@acme/brand', '@acme/transport', 'local'],
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('answers 503 with Retry-After while the first compile runs, then serves the map', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-cold-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig());
  const handlers = createTileflowRouteHandlers({compileWaitMs: 0, cwd});
  t.after(() => handlers.close());
  const request = new Request('http://localhost/tileflow/manifest.json');

  const preparing = await handlers.GET(request);
  assert.equal(preparing.status, 503);
  assert.equal(preparing.headers.get('retry-after'), '2');
  assert.equal(preparing.headers.get('cache-control'), 'no-store');

  const deadline = Date.now() + 60_000;
  let response = await handlers.GET(request);
  while (response.status === 503 && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    response = await handlers.GET(request);
  }
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as RuntimeManifest).version, 3);
});

test('compiles the map while Next.js builds and serves it from the build output', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-snapshot-'));
  await linkWorkspacePackages(cwd, ['core', 'maps', 'next']);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig('#112233'));
  const previous = {nodeEnv: process.env.NODE_ENV, phase: process.env.NEXT_PHASE};
  t.after(() => {
    restoreEnvironment('NODE_ENV', previous.nodeEnv);
    restoreEnvironment('NEXT_PHASE', previous.phase);
  });
  const input = {
    basePath: '/api/tileflow',
    config: 'tileflow.config.ts',
    cwd,
    styleBaseUrl: '/api/tileflow',
  };

  process.env.NEXT_PHASE = 'phase-production-build';
  const built = createTileflowRouteHandlers({base: '/api/tileflow', cwd});
  assert.ok(findTileflowRouteSnapshot(input), 'the build leaves a snapshot');
  // A second worker loading the module finds the snapshot instead of compiling again.
  assert.equal(emitTileflowRouteSnapshot(input), 'exists');
  await built.close();

  delete process.env.NEXT_PHASE;
  process.env.NODE_ENV = 'production';
  const handlers = createTileflowRouteHandlers({base: '/api/tileflow', cwd, routeBase: '/map'});
  t.after(() => handlers.close());
  const manifest = await handlers.GET(new Request('http://localhost/map/manifest.json'));
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type') ?? '', /application\/json/u);
  const body = (await manifest.json()) as RuntimeManifest;
  const styleUrl = body.maps.main!.themes.light!.styleUrl;
  assert.ok(styleUrl.startsWith('/api/tileflow/'));
  const style = await handlers.GET(
    new Request(`http://localhost/map${styleUrl.slice('/api/tileflow'.length)}`),
  );
  assert.equal(style.status, 200);
  assert.equal(backgroundColor(await style.json()), '#112233');
  assert.equal(
    (await handlers.HEAD(new Request('http://localhost/map/manifest.json'))).status,
    200,
  );
  assert.equal(
    (await handlers.GET(new Request('http://localhost/map/../tileflow.config.ts'))).status,
    404,
  );
  assert.equal(
    (await handlers.GET(new Request('http://localhost/map/%2e%2e/tileflow.config.ts'))).status,
    404,
  );
  assert.equal((await handlers.GET(new Request('http://localhost/map/nothing.json'))).status, 404);
});

test('a failed build-time compile leaves no snapshot and the route compiles at run time', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-snapshot-failed-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), 'throw new Error("broken config");\n');
  const input = {
    basePath: '/tileflow',
    config: 'tileflow.config.ts',
    cwd,
    styleBaseUrl: '/tileflow',
  };
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const runner = {args: ['-e', 'process.exit(1)'], command: process.execPath};
    assert.equal(emitTileflowRouteSnapshot(input, runner), 'failed');
    assert.equal(emitTileflowRouteSnapshot(input, runner), 'failed');
  } finally {
    console.warn = warn;
  }
  assert.equal(findTileflowRouteSnapshot(input), undefined);
  assert.ok(existsSync(`${getTileflowRouteSnapshotDirectory(input)}.failed`));
});

test('keeps @tileflow/dev out of the route bundle without duplicating the application list', async (t) => {
  const cwd = await createProjectWithNext(t, '16.4.2');

  assert.deepEqual(withTileflow({}, {cwd}).serverExternalPackages, ['@tileflow/dev']);
  assert.deepEqual(
    withTileflow({serverExternalPackages: ['sharp']}, {cwd}).serverExternalPackages,
    ['sharp', '@tileflow/dev'],
  );
  assert.deepEqual(
    withTileflow({serverExternalPackages: ['@tileflow/dev', 'sharp']}, {cwd})
      .serverExternalPackages,
    ['@tileflow/dev', 'sharp'],
  );
});

test('keeps the files a route answers from in its file trace', async (t) => {
  const cwd = await createProjectWithNext(t, '15.0.0');

  assert.deepEqual(withTileflow({}, {cwd}).outputFileTracingIncludes, {
    '/api/tileflow/**': ['./.next/tileflow/**/*', './public/tileflow/**/*'],
  });
  assert.deepEqual(
    withTileflow(
      {
        distDir: 'build',
        outputFileTracingIncludes: {'/api/tileflow/**': ['./data/**/*'], '/other': ['./x']},
      },
      {base: '/maps', cwd, publicDir: join(cwd, 'static'), routeBase: '/maps-api'},
    ).outputFileTracingIncludes,
    {
      '/api/tileflow/**': ['./data/**/*'],
      '/maps-api/**': ['./build/tileflow/**/*', './static/maps/**/*'],
      '/other': ['./x'],
    },
  );
  assert.equal(withTileflow({}, {cwd, routeBase: false}).outputFileTracingIncludes, undefined);
  assert.deepEqual(
    withTileflow({outputFileTracingIncludes: {'/maps/**': ['./a']}}, {cwd, routeBase: '/maps'})
      .outputFileTracingIncludes,
    {'/maps/**': ['./a', './.next/tileflow/**/*', './public/tileflow/**/*']},
  );
});

test('uses the experimental options Next.js 14 reads', async (t) => {
  const cwd = await createProjectWithNext(t, '14.2.5');
  const config = withTileflow(
    {experimental: {serverComponentsExternalPackages: ['sharp']} as never},
    {cwd},
  );
  const experimental = config.experimental as unknown as Record<string, unknown>;

  assert.equal(config.serverExternalPackages, undefined);
  assert.equal(config.outputFileTracingIncludes, undefined);
  assert.deepEqual(experimental.serverComponentsExternalPackages, ['sharp', '@tileflow/dev']);
  assert.deepEqual(experimental.outputFileTracingIncludes, {
    '/api/tileflow/**': ['./.next/tileflow/**/*', './public/tileflow/**/*'],
  });
});

test('does not compile a second copy of a map the build already wrote as static files', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-static-'));
  await linkWorkspacePackages(cwd, ['core', 'maps', 'next']);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig('#112233'));
  const previous = {nodeEnv: process.env.NODE_ENV, phase: process.env.NEXT_PHASE};
  t.after(() => {
    restoreEnvironment('NODE_ENV', previous.nodeEnv);
    restoreEnvironment('NEXT_PHASE', previous.phase);
  });
  const input = {
    basePath: '/tileflow',
    config: 'tileflow.config.ts',
    cwd,
    styleBaseUrl: '/tileflow',
  };

  process.env.NODE_ENV = 'production';
  await withTileflow({}, {cwd}).rewrites!();
  assert.ok(existsSync(join(cwd, 'public/tileflow/manifest.json')));

  process.env.NEXT_PHASE = 'phase-production-build';
  createTileflowRouteHandlers({cwd});
  assert.equal(
    findTileflowRouteSnapshot(input),
    undefined,
    'the route compiles no copy of its own',
  );
  assert.equal(existsSync(`${getTileflowRouteSnapshotDirectory(input)}.lock`), false);

  // A running server then answers from the static files if a request reaches the route.
  delete process.env.NEXT_PHASE;
  const handlers = createTileflowRouteHandlers({cwd, routeBase: '/map'});
  t.after(() => handlers.close());
  const manifest = await handlers.GET(new Request('http://localhost/map/manifest.json'));
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(
    ((await manifest.json()) as RuntimeManifest).maps.main?.themes.light?.styleUrl.startsWith(
      '/tileflow/',
    ),
    true,
  );

  // Another public directory, or another base, holds no manifest: the route compiles its map.
  process.env.NEXT_PHASE = 'phase-production-build';
  createTileflowRouteHandlers({cwd, publicDir: 'elsewhere'});
  assert.ok(findTileflowRouteSnapshot(input), 'a different publicDir leaves the route to compile');
});

test('finds a snapshot after the project moves to another directory', async (t) => {
  const first = await mkdtemp(join(tmpdir(), 'tileflow-next-moved-a-'));
  const second = join(await mkdtemp(join(tmpdir(), 'tileflow-next-moved-b-')), 'app');
  t.after(() =>
    Promise.all([
      rm(first, {force: true, recursive: true}),
      rm(second, {force: true, recursive: true}),
    ]),
  );
  const input = (cwd: string) => ({
    basePath: '/tileflow',
    config: 'tileflow.config.ts',
    cwd,
    styleBaseUrl: '/tileflow',
  });
  const runner = {
    args: ['-e', "require('node:fs').mkdirSync(JSON.parse(process.argv[1]).outDir)"],
    command: process.execPath,
  };
  const directory = getTileflowRouteSnapshotDirectory(input(first));
  assert.equal(emitTileflowRouteSnapshot(input(first), runner), 'written');
  await writeFile(join(directory, 'manifest.json'), '{}\n');

  await cp(first, second, {recursive: true});
  assert.ok(findTileflowRouteSnapshot(input(second)), 'a standalone output carries the snapshot');
});

async function createProjectWithNext(t: test.TestContext, version: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-version-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await mkdir(join(cwd, 'node_modules', 'next'), {recursive: true});
  await writeFile(join(cwd, 'node_modules/next/package.json'), JSON.stringify({version}));
  return cwd;
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
