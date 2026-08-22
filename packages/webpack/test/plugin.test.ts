import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {TileflowWebpackPlugin} from '../src/index';

test('registers watch inputs and emits deterministic Webpack assets', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-webpack-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const configPath = join(cwd, 'tileflow.config.ts');
  await writeFile(
    configPath,
    "import {streets} from '@tileflow/core'; export default {maps:{main:{basemap:streets()}}};\n",
  );

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
    options: {output: {publicPath: '/app/'}},
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

  assert.deepEqual([...emitted.keys()].sort(), [
    'maps/icons/main/sprite.json',
    'maps/icons/main/sprite.png',
    'maps/icons/main/sprite@2x.json',
    'maps/icons/main/sprite@2x.png',
    'maps/manifest.json',
    'maps/styles/main.json',
  ]);
  const manifest = emitted.get('maps/manifest.json') as RawSource;
  assert.match(String(manifest.value), /"main": "\/app\/maps\/styles\/main\.json"/);
});
