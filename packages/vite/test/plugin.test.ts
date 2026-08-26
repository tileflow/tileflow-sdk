import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
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
    'maps/styles/main.json',
  ];
  assert.deepEqual(
    names.filter((name) => !name?.includes('/generations/')),
    stableNames,
  );
  const generated = names.filter((name) => name?.includes('/generations/'));
  assert.equal(generated.length, 5);
  assert.ok(generated.every((name) => /^maps\/generations\/[a-f0-9]{64}\//.test(name ?? '')));
  const manifest = emitted.find((asset) => asset.fileName === 'maps/manifest.json');
  assert.match(
    String(manifest?.source),
    /"main": "\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json"/,
  );
});

test('preserves Vite public URL kinds while keeping relative manifests owner-relative', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-public-base-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core'; import {streetsIcons} from '@tileflow/maps'; export default defineRootMap({id:'main',version:1,root:{compiler:'streets',compilerVersion:1},icons:[streetsIcons],glyphs:${externalGlyphProvider}});\n`,
  );

  const cases = [
    ['/', /^\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    ['/app/', /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    [
      'https://cdn.example.test/app/',
      /^https:\/\/cdn\.example\.test\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u,
    ],
    ['./', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    ['../assets/', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
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
      ) as {styles: {main: string}};
      assert.match(manifest.styles.main, expectedStyleUrl);
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
  const manifest = (await manifestResponse.json()) as {styles: {main: string}};
  assert.match(
    manifest.styles.main,
    /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u,
  );
  assert.equal((await fetch(`${origin}${manifest.styles.main}`)).status, 200);
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
  ) as {fontFaces?: {night?: Array<{source: string}>}};
  assert.equal(manifest.fontFaces?.night?.length, 2);
  assert.ok(
    manifest.fontFaces?.night?.every((face) =>
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
  await writeFile(
    join(publicDir, 'maps', 'manifest.json'),
    JSON.stringify({
      apiUrl: 'https://api.example.test',
      kind: 'hosted',
      maps: {
        main: {
          environment: 'production',
          mapId: 'map_main',
          styleUrl: 'https://styles.example.test/main.json',
        },
      },
      styles: {main: 'https://styles.example.test/main.json'},
      version: 3,
    }),
  );

  const plugin = tileflow({base: '/maps'});
  (plugin.configResolved as (config: unknown) => void)({base: '/', publicDir, root: cwd});
  await assert.rejects(
    () => (plugin.generateBundle as Function).call({emitFile: () => undefined}, {}, {}, false),
    /Refusing to overwrite Hosted manifest/,
  );
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
    writeFile(join(cwd, 'tokens.ts'), "export const variant = {mode: 'light'} as const;\n"),
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
  return `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; import {variant} from './tokens'; export default defineMap({id:'main',version:1,extends:streets,theme:variant,glyphs:${externalGlyphProvider},icons:[${JSON.stringify(source)}],modules:{poi:{type:'poi',enabled:false},roads:{type:'roads',enabled:false}}});\n`;
}

function streetsConfig(): string {
  return `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'main',version:1,extends:streets,glyphs:${externalGlyphProvider}});\n`;
}

const externalGlyphProvider = JSON.stringify({
  kind: 'url',
  url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
  fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
});

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
