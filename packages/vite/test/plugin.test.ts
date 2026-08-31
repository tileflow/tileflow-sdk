import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {createServer as createViteServer} from 'vite';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflow} from '../src/index';

test('emits manifest and style assets under the configured Vite base path', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), streetsConfig());

  const plugin = tileflow({base: '/maps'});
  assert.equal(plugin.name, 'tileflow:vite');
  assert.equal(typeof plugin.configResolved, 'function');
  assert.equal(typeof plugin.generateBundle, 'function');

  (plugin.configResolved as (config: unknown) => void)({
    base: '/app/',
    publicDir: join(cwd, 'public'),
    root: cwd,
  });
  const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
  await (plugin.generateBundle as Function).call(
    {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
    {},
    {},
    false,
  );

  const names = emitted.map((asset) => asset.fileName).sort();
  const stableNames = [
    'maps/build-manifest.json',
    'maps/icons/main/sprite.json',
    'maps/icons/main/sprite.png',
    'maps/icons/main/sprite@2x.json',
    'maps/icons/main/sprite@2x.png',
    'maps/manifest.json',
    'maps/styles/main/dark.json',
    'maps/styles/main/light.json',
  ];
  assert.deepEqual(
    names.filter((name) => !name?.includes('/generations/')),
    stableNames,
  );
  const generated = names.filter((name) => name?.includes('/generations/'));
  assert.equal(generated.length, 6);
  assert.ok(generated.every((name) => /^maps\/generations\/[a-f0-9]{64}\//.test(name ?? '')));
  const manifest = JSON.parse(
    String(emitted.find((asset) => asset.fileName === 'maps/manifest.json')?.source),
  ) as RuntimeManifest;
  assert.equal(manifest.version, 1);
  assert.equal(Object.hasOwn(manifest, 'kind'), false);
  assert.equal(Object.hasOwn(manifest, 'styles'), false);
  assert.equal(manifest.maps.main?.defaultTheme, 'light');
  assert.deepEqual(manifest.maps.main?.systemThemes, {dark: 'dark', light: 'light'});
  assert.deepEqual(Object.keys(manifest.maps.main?.themes ?? {}).sort(), ['dark', 'light']);
  assert.match(
    manifest.maps.main?.themes.light?.styleUrl ?? '',
    /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
  );
  assert.match(
    manifest.maps.main?.themes.dark?.styleUrl ?? '',
    /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/dark\.json$/u,
  );
});

test('rejects a local PMTiles source before emitting Vite production assets', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-local-tileset-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const archive = createPmtiles();
  const outDir = join(cwd, 'dist');
  await writeFile(join(cwd, 'stores.pmtiles'), archive);
  await writeFile(join(cwd, 'tileflow.config.ts'), localTilesetConfig);
  const plugin = tileflow({base: '/maps'});
  (plugin.configResolved as (config: unknown) => void)({
    base: '/',
    build: {outDir},
    publicDir: join(cwd, 'public'),
    root: cwd,
  });
  const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
  const outputOptions = {dir: outDir};
  await assert.rejects(
    () =>
      (plugin.generateBundle as Function).call(
        {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
        outputOptions,
        {},
        false,
      ),
    {code: 'TF_LOCAL_TILESET_PRODUCTION_UNRESOLVED'},
  );
  assert.deepEqual(emitted, []);
  await assert.rejects(stat(outDir), {code: 'ENOENT'});
  await assert.rejects(stat(join(cwd, '.tileflow/cache/pmtiles-snapshots')), {code: 'ENOENT'});
});

test('preserves Vite public URL kinds while keeping relative manifests owner-relative', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-public-base-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core'; import {streetsIcons, streetsThemes} from '@tileflow/maps'; export default defineMap({id:'main',version:1,defaultTheme:'light',systemThemes:{dark:'dark',light:'light'},themes:streetsThemes,icons:[streetsIcons],glyphs:${externalGlyphProvider}});\n`,
  );

  const cases = [
    ['/', /^\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u],
    ['/app/', /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u],
    [
      'https://cdn.example.test/app/',
      /^https:\/\/cdn\.example\.test\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
    ],
    ['./', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u],
    ['../assets/', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u],
  ] as const;

  for (const [publicBase, expectedStyleUrl] of cases) {
    await t.test(publicBase, async () => {
      const plugin = tileflow({base: '/maps'});
      (plugin.configResolved as (config: unknown) => void)({
        base: publicBase,
        publicDir: join(cwd, 'public'),
        root: cwd,
      });
      const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
      await (plugin.generateBundle as Function).call(
        {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
        {},
        {},
        false,
      );
      const manifest = JSON.parse(
        String(emitted.find((asset) => asset.fileName === 'maps/manifest.json')?.source),
      ) as RuntimeManifest;
      assert.match(manifest.maps.main?.themes.light?.styleUrl ?? '', expectedStyleUrl);
    });
  }
});

test('serves the production manifest URL in real Vite dev under a non-root base', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-dev-base-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), streetsConfig());

  const server = await createViteServer({
    base: '/app/',
    logLevel: 'silent',
    plugins: [tileflow({base: '/maps'})],
    root: cwd,
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  t.after(() => server.close());
  const address = server.httpServer?.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;

  const manifestResponse = await fetch(`${origin}/app/maps/manifest.json`);
  assert.equal(manifestResponse.status, 200);
  const manifest = (await manifestResponse.json()) as RuntimeManifest;
  const lightStyleUrl = manifest.maps.main?.themes.light?.styleUrl ?? '';
  const darkStyleUrl = manifest.maps.main?.themes.dark?.styleUrl ?? '';
  assert.match(
    lightStyleUrl,
    /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/light\.json$/u,
  );
  assert.match(darkStyleUrl, /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\/dark\.json$/u);
  assert.equal((await fetch(`${origin}${lightStyleUrl}`)).status, 200);
  assert.equal((await fetch(`${origin}${darkStyleUrl}`)).status, 200);
});

test('rejects traversal in the Vite output and route base', () => {
  for (const base of ['../maps', '/app/../maps', '/app//maps']) {
    assert.throws(() => tileflow({base}), /Invalid Tileflow base path/u);
  }
});

test('emits Cyberpunk web fonts from Maps with immutable runtime URLs', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-fonts-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',version:1,extends:cyberpunk});\n",
  );
  const plugin = tileflow({base: '/maps'});
  (plugin.configResolved as (config: unknown) => void)({
    base: '/app/',
    publicDir: join(cwd, 'public'),
    root: cwd,
  });
  const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
  await (plugin.generateBundle as Function).call(
    {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
    {},
    {},
    false,
  );

  const names = emitted.map((asset) => asset.fileName ?? '');
  const stableFontAssets = names.filter((name) => name.startsWith('maps/fonts/'));
  assert.equal(stableFontAssets.length, 3);
  assert.equal(
    stableFontAssets.filter((name) =>
      /^maps\/fonts\/oxanium-(?:medium|semibold)-[a-f0-9]{64}\.ttf$/u.test(name),
    ).length,
    2,
  );
  assert.equal(
    stableFontAssets.filter((name) =>
      /^maps\/fonts\/licenses\/license-[a-f0-9]{64}\.txt$/u.test(name),
    ).length,
    1,
  );
  assert.equal(
    names.filter((name) => /\/generations\/[a-f0-9]{64}\/fonts\//u.test(name)).length,
    3,
  );
  const manifest = JSON.parse(
    String(emitted.find((asset) => asset.fileName === 'maps/manifest.json')?.source),
  ) as RuntimeManifest;
  const fontFaces = manifest.maps.night?.themes.dark?.fontFaces;
  assert.equal(fontFaces?.length, 2);
  assert.ok(
    fontFaces?.every((face) =>
      /^\/app\/maps\/generations\/[a-f0-9]{64}\/fonts\/oxanium-(?:medium|semibold)-[a-f0-9]{64}\.ttf$/u.test(
        face.source,
      ),
    ),
  );
});

test('can disable build artifact emission', async () => {
  const plugin = tileflow({emitBuildArtifacts: false});
  let emitted = false;
  await (plugin.generateBundle as Function).call({emitFile: () => (emitted = true)}, {}, {}, false);
  assert.equal(emitted, false);
});

test('refuses to emit over a Hosted manifest copied from publicDir', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-hosted-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const publicDir = join(cwd, 'public');
  await mkdir(join(publicDir, 'maps'), {recursive: true});
  await writeFile(join(cwd, 'tileflow.config.ts'), streetsConfig());
  const hosted = createHostedManifest();
  const manifestPath = join(publicDir, 'maps', 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(hosted));

  const plugin = tileflow({base: '/maps'});
  (plugin.configResolved as (config: unknown) => void)({base: '/', publicDir, root: cwd});
  await assert.rejects(
    () => (plugin.generateBundle as Function).call({emitFile: () => undefined}, {}, {}, false),
    /Refusing to overwrite Hosted manifest/,
  );
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), hosted);
});

test('allows an explicit Vite opt-in to replace Hosted manifest metadata', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-hosted-opt-in-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const publicDir = join(cwd, 'public');
  await mkdir(join(publicDir, 'maps'), {recursive: true});
  await writeFile(join(cwd, 'tileflow.config.ts'), streetsConfig());
  await writeFile(
    join(publicDir, 'maps', 'manifest.json'),
    `${JSON.stringify(createHostedManifest())}\n`,
  );

  const plugin = tileflow({base: '/maps', overwriteHostedManifest: true});
  (plugin.configResolved as (config: unknown) => void)({base: '/', publicDir, root: cwd});
  const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
  await (plugin.generateBundle as Function).call(
    {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
    {},
    {},
    false,
  );

  const replacement = JSON.parse(
    String(emitted.find((asset) => asset.fileName === 'maps/manifest.json')?.source),
  ) as RuntimeManifest;
  assertLocalManifest(replacement, '/maps');
});

test('refreshes the shared input graph and unwatches retired asset directories', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-watch-'));
  await linkWorkspacePackages(cwd);
  const iconsA = join(cwd, 'icons-a');
  const iconsB = join(cwd, 'icons-b');
  const configPath = join(cwd, 'tileflow.config.ts');
  await Promise.all([mkdir(iconsA), mkdir(iconsB)]);
  await Promise.all([
    writeFile(join(iconsA, 'museum.svg'), icon),
    writeFile(join(iconsB, 'museum.svg'), icon),
    writeFile(join(cwd, 'tokens.ts'), "export const mapName = 'Watched map';\n"),
  ]);
  await writeFile(configPath, watchedConfig('./icons-a'));

  const added = new Set<string>();
  const unwatched = new Set<string>();
  const warnings: string[] = [];
  const callbacks = new Map<string, (file: string) => void>();
  let closeServer = () => undefined;
  const plugin = tileflow();
  (plugin.configureServer as Function)({
    config: {
      logger: {
        error() {},
        warn(message: string) {
          warnings.push(message);
        },
      },
      root: cwd,
    },
    httpServer: {
      once(_event: string, callback: () => void) {
        closeServer = callback;
      },
    },
    middlewares: {use() {}},
    watcher: {
      add(paths: string | string[]) {
        for (const path of Array.isArray(paths) ? paths : [paths]) added.add(resolve(path));
      },
      on(event: string, callback: (file: string) => void) {
        callbacks.set(event, callback);
      },
      async unwatch(paths: string | string[]) {
        for (const path of Array.isArray(paths) ? paths : [paths]) unwatched.add(resolve(path));
      },
    },
    ws: {send() {}},
  });
  t.after(async () => {
    closeServer();
    await rm(cwd, {force: true, recursive: true});
  });

  await waitFor(
    () => hasPathSuffix(added, '/icons-a'),
    () => `added=${JSON.stringify([...added])} warnings=${JSON.stringify(warnings)}`,
  );
  await writeFile(configPath, watchedConfig('./icons-b'));
  callbacks.get('change')?.(configPath);
  await waitFor(() => hasPathSuffix(added, '/icons-b') && hasPathSuffix(unwatched, '/icons-a'));
});

const icon =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#000" d="M2 20h20L12 2z"/></svg>';

function watchedConfig(source: string): string {
  return `import {defineMap,disable} from '@tileflow/core'; import {streets} from '@tileflow/maps'; import {mapName} from './tokens'; export default defineMap({id:'main',name:mapName,version:1,extends:streets,glyphs:${externalGlyphProvider},icons:[${JSON.stringify(source)}],modules:{poi:disable(),roads:disable()}});\n`;
}

function streetsConfig(): string {
  return `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'main',version:1,extends:streets,glyphs:${externalGlyphProvider}});\n`;
}

const localTilesetConfig = `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});\n`;

function createPmtiles() {
  const headerLength = 127;
  const directory = new Uint8Array([1, 0, 1, 1, 1]);
  const metadata = new TextEncoder().encode(
    JSON.stringify({vector_layers: [{fields: {}, id: 'store-locations'}]}),
  );
  const tile = new Uint8Array([0]);
  const bytes = new Uint8Array(
    headerLength + directory.byteLength + metadata.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadata.byteLength;
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  for (const [offset, value] of [
    [8, rootOffset],
    [16, directory.byteLength],
    [24, metadataOffset],
    [32, metadata.byteLength],
    [40, tileOffset],
    [48, 0],
    [56, tileOffset],
    [64, tile.byteLength],
    [72, 1],
    [80, 1],
    [88, 1],
  ] as const) {
    setUint64(view, offset, value);
  }
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  bytes.set(directory, rootOffset);
  bytes.set(metadata, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}

const externalGlyphProvider = JSON.stringify({
  kind: 'url',
  url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
});

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

function assertLocalManifest(manifest: RuntimeManifest, base: string): void {
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
    new RegExp(`^${base}/generations/[a-f0-9]{64}/styles/main/light\\.json$`, 'u'),
  );
}

function hasPathSuffix(paths: Set<string>, suffix: string): boolean {
  return [...paths].some((path) => path.replaceAll('\\', '/').endsWith(suffix));
}

async function waitFor(condition: () => boolean, describe = () => ''): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for Vite watcher state. ${describe()}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

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
          fontFaces?: Array<{source: string}>;
          styleId?: string;
          styleUrl: string;
        }
      >;
    }
  >;
  version: 1;
};
