import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {withTileflow} from '../src/index';
import {createTileflowRouteHandlers} from '../src/server';

test('reuses one watched generation across repeated mutable requests', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-next-watched-server-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), rootConfig('#112233'));
  const handlers = createTileflowRouteHandlers({cwd});
  t.after(() => handlers.close());
  const style = new Request('http://localhost/tileflow/styles/main/light.json');

  assert.equal((await handlers.GET(style)).status, 200);
  assert.equal((await handlers.GET(style)).status, 200);
  const status = (await (
    await handlers.GET(new Request('http://localhost/tileflow/__status'))
  ).json()) as {generation: number};

  assert.equal(status.generation, 1);
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
    assert.equal(manifest.version, 1);
    assert.equal(Object.hasOwn(manifest, 'kind'), false);
    assert.equal(Object.hasOwn(manifest, 'styles'), false);
    const map = manifest.maps.main;
    assert.ok(map);
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
    handlers = createTileflowRouteHandlers({cwd});
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
  assert.equal(manifest.version, 1);
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
  version: 1;
};
