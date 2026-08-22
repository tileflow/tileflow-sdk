import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {tileflow} from '../src/index';

test('emits manifest and style assets under the configured Vite base path', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-vite-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    "import {streets} from '@tileflow/core'; export default {maps:{main:{basemap:streets()}}};\n",
  );

  const plugin = tileflow({base: '/maps'});
  assert.equal(plugin.name, 'tileflow:vite');
  assert.equal(typeof plugin.configResolved, 'function');
  assert.equal(typeof plugin.generateBundle, 'function');

  (plugin.configResolved as (config: unknown) => void)({base: '/app/', root: cwd});
  const emitted: Array<{fileName?: string; source?: unknown; type: string}> = [];
  await (plugin.generateBundle as Function).call(
    {emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset)},
    {},
    {},
    false,
  );

  const names = emitted.map((asset) => asset.fileName).sort();
  assert.deepEqual(names, [
    'maps/icons/main/sprite.json',
    'maps/icons/main/sprite.png',
    'maps/icons/main/sprite@2x.json',
    'maps/icons/main/sprite@2x.png',
    'maps/manifest.json',
    'maps/styles/main.json',
  ]);
  const manifest = emitted.find((asset) => asset.fileName === 'maps/manifest.json');
  assert.match(String(manifest?.source), /"main": "\/app\/maps\/styles\/main\.json"/);
});

test('can disable build artifact emission', async () => {
  const plugin = tileflow({emitBuildArtifacts: false});
  let emitted = false;
  await (plugin.generateBundle as Function).call({emitFile: () => (emitted = true)}, {}, {}, false);
  assert.equal(emitted, false);
});
