import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createTileflowBuildArtifacts, getTileflowArtifactFiles} from '../src/artifacts';
import {
  compilePreviewControls,
  describePreviewControls,
  parsePreviewControls,
} from '../src/preview-controls';
import {createTileflowDevRequestHandler} from '../src/server';
import type {TileflowArtifactSession} from '../src/session';

test('controls reject arbitrary config, unknown keys, out-of-range numbers and oversized payloads', () => {
  for (const value of [
    'null',
    '[]',
    '{"roads":{"url":"https://example.test"}}',
    '{"vegetation":{"threeDimensional":{"heightScale":11}}}',
    '{"buildings":{"threeDimensional":{"lighting":"other"}}}',
    '{"__proto__":{}}',
    '{"roads":{"enabled":1}}',
    ' '.repeat(8193),
  ])
    assert.throws(() => parsePreviewControls(value));
  assert.deepEqual(parsePreviewControls('{"roads":{"enabled":false}}'), {roads: {enabled: false}});
});

test('controls recompile modules with matching inspection, reuse delivery assets and never edit source', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-controls-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  const config = `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets,icons:[],
glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic','DINish Medium,Noto Sans Regular','DINish Bold,Noto Sans Regular']},
modules:{roads:disable(),poi:disable(),vegetation:disable()}});`;
  await writeFile(join(cwd, 'tileflow.config.ts'), config);
  const artifacts = await createTileflowBuildArtifacts({cwd, inspection: true});
  t.after(() => artifacts.dispose?.());
  const before = JSON.stringify(artifacts.styles);
  const model = describePreviewControls(artifacts, 'main', 'light');
  assert.equal(model.modules.find((module) => module.id === 'vegetation')?.enabled, false);
  assert.equal(model.modules.length, 13);
  const representation = model.modules
    .find((module) => module.id === 'vegetation')
    ?.fields.find((field) => field.path === 'mode');
  assert.equal(representation?.inherit, true);
  assert.equal(representation?.value, '3d');
  const changed = compilePreviewControls(
    artifacts,
    'main',
    'light',
    JSON.stringify({
      water: {enabled: false},
      buildings: {threeDimensional: {shadows: true, lighting: 'sun'}},
    }),
    'https://api.tileflow.dev',
  );
  assert.ok(
    artifacts.styles.main!.light!.layers.some(
      (layer) => layer.metadata?.['tileflow:domain'] === 'water',
    ),
  );
  assert.ok(changed.style.layers.every((layer) => layer.metadata?.['tileflow:domain'] !== 'water'));
  assert.deepEqual(
    changed.inspection.layers.map((layer) => layer.id),
    changed.style.layers.map((layer) => layer.id),
  );
  assert.equal(
    (changed.style.metadata?.['tileflow:buildings'] as {shadows: boolean}).shadows,
    true,
  );
  assert.equal(changed.style.glyphs, artifacts.styles.main!.light!.glyphs);
  const trees = compilePreviewControls(
    artifacts,
    'main',
    'dark',
    '{"vegetation":{"enabled":true,"mode":"auto"}}',
    'https://api.tileflow.dev',
  );
  assert.equal(
    (trees.style.metadata?.['tileflow:vegetation-display'] as {mode: string}).mode,
    'auto',
  );
  assert.equal(JSON.stringify(artifacts.styles), before);
  assert.equal(await readFile(join(cwd, 'tileflow.config.ts'), 'utf8'), config);
  assert.ok(
    getTileflowArtifactFiles(artifacts).every((file) => !file.fileName.includes('controls')),
  );
  const session: TileflowArtifactSession = {
    acquireArtifacts: () => ({artifacts, generation: 1, release: async () => {}}),
    getLastGoodArtifacts: () => artifacts,
    getState: () => ({status: 'ready', generation: 1, lastGoodGeneration: 1, artifacts}),
    close: async () => {},
    refresh: async () => {},
    subscribe: () => () => {},
  };
  const handler = createTileflowDevRequestHandler({basePath: '/map', session});
  t.after(() => handler.close());
  const query = new URLSearchParams({controls: '{"water":{"enabled":false}}'});
  const response = await handler(
    new Request('http://localhost/map/styles/main/light.json?' + query),
  );
  assert.equal(response.status, 200);
  const style = (await response.json()) as {layers: {id: string}[]};
  const inspection = (await (
    await handler(new Request('http://localhost/map/__inspection/main/light.json?' + query))
  ).json()) as {layers: {id: string}[]};
  assert.deepEqual(
    inspection.layers.map((layer) => layer.id),
    style.layers.map((layer) => layer.id),
  );
  const invalid = await handler(
    new Request(
      'http://localhost/map/styles/main/light.json?controls=' +
        encodeURIComponent('{"roads":{"enabled":"no"}}'),
    ),
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (await handler(new Request('http://localhost/map/styles/main/light.json'))).status,
    200,
  );
});
