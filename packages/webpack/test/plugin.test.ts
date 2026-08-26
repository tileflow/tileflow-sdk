import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {TileflowWebpackPlugin} from '../src/index';

test('registers watch inputs and emits deterministic Webpack assets', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-webpack-'));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const configPath = join(cwd, 'tileflow.config.ts');
  await writeFile(configPath, streetsConfig);

  let afterCompile: ((compilation: any) => Promise<void>) | undefined;
  let thisCompilation: ((compilation: any) => void) | undefined;
  let processAssets: (() => Promise<void>) | undefined;
  const emitted = new Map<string, unknown>();
  class RawSource {
    constructor(readonly value: unknown) {}
  }
  const compiler = {
    context: cwd,
    hooks: {
      afterCompile: {
        tapPromise: (_name: string, callback: typeof afterCompile) => (afterCompile = callback),
      },
      thisCompilation: {
        tap: (_name: string, callback: typeof thisCompilation) => (thisCompilation = callback),
      },
      watchClose: {tap: () => undefined},
    },
    options: {output: {path: join(cwd, 'dist'), publicPath: '/app/'}},
    webpack: {
      Compilation: {PROCESS_ASSETS_STAGE_ADDITIONAL: 1},
      sources: {RawSource},
    },
  };

  new TileflowWebpackPlugin({base: '/maps'}).apply(compiler as never);
  const compilation = {
    contextDependencies: new Set<string>(),
    emitAsset: (name: string, source: unknown) => emitted.set(name, source),
    fileDependencies: new Set<string>(),
    hooks: {
      processAssets: {
        tapPromise: (_options: unknown, callback: () => Promise<void>) =>
          (processAssets = callback),
      },
    },
  };
  assert.ok(afterCompile);
  assert.ok(thisCompilation);
  await afterCompile(compilation);
  assert.equal(compilation.fileDependencies.has(configPath), true);
  thisCompilation(compilation);
  assert.ok(processAssets);
  await processAssets();

  const names = [...emitted.keys()].sort();
  assert.deepEqual(
    names.filter((name) => !name.includes('/generations/')),
    [
      'maps/build-manifest.json',
      'maps/icons/main/sprite.json',
      'maps/icons/main/sprite.png',
      'maps/icons/main/sprite@2x.json',
      'maps/icons/main/sprite@2x.png',
      'maps/manifest.json',
      'maps/styles/main.json',
    ],
  );
  const generated = names.filter((name) => name.includes('/generations/'));
  assert.equal(generated.length, 5);
  assert.ok(generated.every((name) => /^maps\/generations\/[a-f0-9]{64}\//.test(name)));
  const manifest = emitted.get('maps/manifest.json') as RawSource;
  assert.match(
    String(manifest.value),
    /"main": "\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json"/,
  );
});

test('preserves Webpack publicPath kinds while keeping relative manifests owner-relative', async (t) => {
  const cwd = await createFixture(t, 'tileflow-webpack-public-path-');
  const cases = [
    ['/app/', /^\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    [
      'https://cdn.example.test/app/',
      /^https:\/\/cdn\.example\.test\/app\/maps\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u,
    ],
    ['./', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    ['assets/', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
    ['../assets/', /^\.\/generations\/[a-f0-9]{64}\/styles\/main\.json$/u],
  ] as const;

  for (const [publicPath, expectedStyleUrl] of cases) {
    await t.test(publicPath, async () => {
      const outputPath = join(cwd, `dist-${cases.findIndex((item) => item[0] === publicPath)}`);
      const harness = createWebpackHarness(cwd, outputPath, publicPath);
      new TileflowWebpackPlugin({base: '/maps'}).apply(harness.compiler as never);
      const compilation = harness.createCompilation();
      harness.runThisCompilation(compilation.compilation);
      await compilation.runProcessAssets();
      const manifest = compilation.emitted.get('maps/manifest.json') as TestRawSource;
      const parsed = JSON.parse(String(manifest.value)) as {styles: {main: string}};
      assert.match(parsed.styles.main, expectedStyleUrl);
    });
  }
});

test('rejects traversal in the Webpack output and route base', async (t) => {
  const cwd = await createFixture(t, 'tileflow-webpack-base-traversal-');
  for (const base of ['../maps', '/app/../maps', '/app//maps']) {
    const harness = createWebpackHarness(cwd, join(cwd, 'dist'));
    assert.throws(
      () => new TileflowWebpackPlugin({base}).apply(harness.compiler as never),
      /Invalid Tileflow base path/u,
    );
  }
});

test('refuses to emit over a Hosted manifest on initial build and watch rebuild by default', async (t) => {
  const cwd = await createFixture(t, 'tileflow-webpack-hosted-guard-');
  const outputPath = join(cwd, 'dist');
  const manifestPath = join(outputPath, 'maps', 'manifest.json');
  const hostedManifest = createHostedManifest();
  await mkdir(join(outputPath, 'maps'), {recursive: true});
  await writeFile(manifestPath, `${JSON.stringify(hostedManifest)}\n`);

  const harness = createWebpackHarness(cwd, outputPath);
  new TileflowWebpackPlugin({base: '/maps'}).apply(harness.compiler as never);

  const initialCompilation = harness.createCompilation();
  harness.runThisCompilation(initialCompilation.compilation);
  await assert.rejects(initialCompilation.runProcessAssets, {
    code: 'HOSTED_MANIFEST_OVERWRITE_REFUSED',
  });
  assert.equal(initialCompilation.emitted.size, 0);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), hostedManifest);

  await rm(manifestPath);
  const successfulCompilation = harness.createCompilation();
  harness.runThisCompilation(successfulCompilation.compilation);
  await successfulCompilation.runProcessAssets();
  assert.ok(successfulCompilation.emitted.has('maps/manifest.json'));

  await writeFile(manifestPath, `${JSON.stringify(hostedManifest)}\n`);
  const rebuildCompilation = harness.createCompilation();
  harness.runThisCompilation(rebuildCompilation.compilation);
  await assert.rejects(rebuildCompilation.runProcessAssets, {
    code: 'HOSTED_MANIFEST_OVERWRITE_REFUSED',
  });
  assert.equal(rebuildCompilation.emitted.size, 0);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), hostedManifest);
});

test('allows an explicit Webpack opt-in to replace a Hosted manifest', async (t) => {
  const cwd = await createFixture(t, 'tileflow-webpack-hosted-opt-in-');
  const outputPath = join(cwd, 'dist');
  const manifestPath = join(outputPath, 'maps', 'manifest.json');
  await mkdir(join(outputPath, 'maps'), {recursive: true});
  await writeFile(manifestPath, `${JSON.stringify(createHostedManifest())}\n`);

  const harness = createWebpackHarness(cwd, outputPath);
  new TileflowWebpackPlugin({
    base: '/maps',
    overwriteHostedManifest: true,
  }).apply(harness.compiler as never);

  const compilation = harness.createCompilation();
  harness.runThisCompilation(compilation.compilation);
  await compilation.runProcessAssets();
  const manifest = compilation.emitted.get('maps/manifest.json') as TestRawSource;
  assert.equal(JSON.parse(String(manifest.value)).kind, 'self-hosted');
});

type TestRawSource = {value: unknown};

async function createFixture(t: TestContext, prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(cwd);
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(join(cwd, 'tileflow.config.ts'), streetsConfig);
  return cwd;
}

const streetsConfig = `import {defineMap} from '@tileflow/core'; import {streets} from '@tileflow/maps'; export default defineMap({id:'main',version:1,extends:streets,glyphs:${JSON.stringify(
  {
    kind: 'url',
    url: 'https://fonts.example.test/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold'],
  },
)}});\n`;

function createHostedManifest() {
  return {
    apiUrl: 'https://api.example.test',
    kind: 'hosted',
    maps: {
      main: {
        environment: 'production',
        mapId: 'map_main',
        styleId: 'style_main',
        styleUrl: 'https://styles.example.test/main.json',
      },
    },
    styles: {main: 'https://styles.example.test/main.json'},
    version: 3,
  };
}

function createWebpackHarness(cwd: string, outputPath: string, publicPath = '/app/') {
  let thisCompilation: ((compilation: any) => void) | undefined;

  class RawSource {
    constructor(readonly value: unknown) {}
  }

  const compiler = {
    context: cwd,
    hooks: {
      afterCompile: {tapPromise: () => undefined},
      thisCompilation: {
        tap: (_name: string, callback: typeof thisCompilation) => (thisCompilation = callback),
      },
      watchClose: {tap: () => undefined},
    },
    options: {output: {path: outputPath, publicPath}},
    webpack: {
      Compilation: {PROCESS_ASSETS_STAGE_ADDITIONAL: 1},
      sources: {RawSource},
    },
  };

  return {
    compiler,
    createCompilation() {
      let processAssets: (() => Promise<void>) | undefined;
      const emitted = new Map<string, unknown>();
      const compilation = {
        emitAsset: (name: string, source: unknown) => emitted.set(name, source),
        hooks: {
          processAssets: {
            tapPromise: (_options: unknown, callback: () => Promise<void>) =>
              (processAssets = callback),
          },
        },
      };
      return {
        compilation,
        emitted,
        runProcessAssets: async () => {
          assert.ok(processAssets);
          await processAssets();
        },
      };
    },
    runThisCompilation(compilation: unknown) {
      assert.ok(thisCompilation);
      thisCompilation(compilation);
    },
  };
}
