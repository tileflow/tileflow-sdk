import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  getTileflowArtifactFiles,
  type TileflowBuildArtifacts,
} from '../src/artifacts';
import {createTileflowDevRequestHandler} from '../src/server';
import type {TileflowArtifactSession} from '../src/session';

test('compiler inspection is opt-in, memory-only, and served from its bounded route', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-workbench-inspection-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id:'main', version:1, extends:streets, icons:[],
  glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold']},
  modules:{poi:{type:'poi',enabled:false},roads:{type:'roads',enabled:false}}
});
`,
  );

  const ordinary = await createTileflowBuildArtifacts({cwd});
  const inspected = await createTileflowBuildArtifacts({cwd, inspection: true});

  assert.equal(ordinary.styleInspections, undefined);
  assert.equal(JSON.stringify(inspected.styles), JSON.stringify(ordinary.styles));
  const sidecar = inspected.styleInspections?.main?.light;
  assert.equal(sidecar?.map, 'main');
  assert.equal(sidecar?.theme, 'light');
  assert.equal(sidecar?.layers.length, inspected.styles.main?.light?.layers.length);
  assert.ok(sidecar?.layers.every((layer) => layer.contributions.length > 0));
  assert.doesNotMatch(
    getTileflowArtifactFiles(inspected)
      .map(({fileName}) => fileName)
      .join('\n'),
    /inspection/u,
  );

  const handler = createTileflowDevRequestHandler({
    basePath: '/left',
    session: readySession(inspected),
  });
  const response = await handler(new Request('http://localhost/left/__inspection/main/light.json'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sidecar);

  const unavailable = createTileflowDevRequestHandler({
    basePath: '/left',
    session: readySession(ordinary),
  });
  assert.equal(
    (await unavailable(new Request('http://localhost/left/__inspection/main/light.json'))).status,
    404,
  );
});

test('artifact sessions preserve the inspection option through their build boundary', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-workbench-session-inspection-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id:'main', version:1, extends:streets, icons:[],
  glyphs:{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold']},
  modules:{poi:{type:'poi',enabled:false},roads:{type:'roads',enabled:false}}
});
`,
  );

  const session = await createTileflowArtifactSession({cwd, inspection: true, watch: false});
  t.after(() => session.close());

  assert.equal(session.getState().status, 'ready');
  assert.ok(session.getLastGoodArtifacts()?.styleInspections?.main?.light);
});

function readySession(artifacts: TileflowBuildArtifacts): TileflowArtifactSession {
  return {
    close: async () => {},
    getLastGoodArtifacts: () => artifacts,
    getState: () => ({
      artifacts,
      generation: 1,
      lastGoodGeneration: 1,
      status: 'ready',
    }),
    refresh: async () => {},
    subscribe: () => () => {},
  };
}
