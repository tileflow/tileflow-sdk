import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {PNG} from 'pngjs';
import {
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  type TileflowCaptureSession,
} from '@tileflow/capture';
import {normalizeTileflowCaptureScene, serializeCanonicalJson, sha256Hex} from '@tileflow/core';
import {
  createTileflowArtifactSession,
  type TileflowArtifactSessionState,
} from '@tileflow/dev/artifacts';
import {createTileflowDevRequestHandler} from '@tileflow/dev/server';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {createWorkbenchService} from '../src/workbench-service';
import {tileflowMapFixture} from './map-fixture';

test('Workbench reuses pinned artifacts, saves verified history and compares without rendering again', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-workbench-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'map',
      fields: `scenes:{proof:{theme:'light',camera:{type:'center',center:[2,41],zoom:7},viewport:{width:64,height:64,dpr:1}}}`,
    }),
  );
  const session = await createTileflowArtifactSession({cwd});
  t.after(() => session.close());
  assert.equal(session.getState().status, 'ready');
  let renders = 0;
  let releases = 0;
  let rejectCapture = false;
  let finishCapture: (() => void) | undefined;
  let blocked = false;
  const originalAcquire = session.acquireArtifacts.bind(session);
  session.acquireArtifacts = (generation) => {
    const lease = originalAcquire(generation);
    return (
      lease && {
        ...lease,
        release: async () => {
          releases++;
          await lease.release();
        },
      }
    );
  };
  const captureSession = {
    async captureArtifacts(artifacts, names) {
      renders++;
      if (blocked)
        await new Promise<void>((done) => {
          finishCapture = done;
        });
      if (rejectCapture) throw new Error('Fixture renderer failed');
      assert.equal(artifacts.styles, session.getLastGoodArtifacts()!.styles);
      const definition = {
        ...normalizeTileflowCaptureScene(artifacts.project.scenes![names[0]!]!),
        theme: 'light',
      };
      const image = new PNG({width: 64, height: 64});
      for (let i = 0; i < image.data.length; i += 4) image.data.set([renders * 40, 0, 0, 255], i);
      const png = PNG.sync.write(image);
      const renderer = createTileflowCaptureRendererIdentity();
      const receipt = createTileflowCaptureReceipt({
        data: {
          kind: 'tileflow-world',
          product: 'world-v1',
          releaseId: 'world-v1-fixture',
          schema: 'openmaptiles',
          schemaVersion: 1,
          semantics: {parkLayer: 'protected-only'},
          sourceId: 'tileflow',
          archiveSha256: 'a'.repeat(64),
          contractSha256: 'b'.repeat(64),
          dataContractSha256: 'c'.repeat(64),
          descriptorSha256: 'd'.repeat(64),
        },
        dpr: 1,
        width: 64,
        height: 64,
        map: 'map',
        theme: 'light',
        target: 'map',
        scene: names[0]!,
        networkDependent: false,
        pngSha256: await sha256Hex(png),
        renderer,
        sceneSha256: await sha256Hex(serializeCanonicalJson(definition)),
        styleSha256: 'e'.repeat(64),
      });
      return {
        schemaVersion: 1,
        captures: [
          {
            definition,
            png,
            receipt,
            renderer,
            scene: names[0]!,
            map: 'map',
            theme: 'light',
            target: 'map',
            sha256: receipt.image.sha256,
            sceneSha256: receipt.scene.sha256,
            styleSha256: receipt.style.sha256,
            width: 64,
            height: 64,
            dpr: 1,
            networkDependent: false,
            warnings: [],
          },
        ],
      };
    },
    async close() {},
  } as TileflowCaptureSession;
  const service = createWorkbenchService({
    cwd,
    origin: 'http://localhost:3333',
    sides: {left: {session, basePath: '/map'}},
    captureSession,
  });
  t.after(() => service.close());
  const request = (path: string, body?: unknown, headers?: HeadersInit) =>
    service.handle(
      new Request('http://localhost:3333/__workbench' + path, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        headers: {'Content-Type': 'application/json', 'X-Tileflow-Workbench': '1', ...headers},
      }),
    );
  const catalog = await (await request('')).json();
  assert.deepEqual(catalog.sides.left.timeOfDay.map.light, {
    day: 'light',
    dawn: 'dawn',
    dusk: 'dusk',
    night: 'dark',
  });
  assert.ok(catalog.sides.left.selections.some((item: {id: string}) => item.id === 'scene:proof'));
  const generation = session.getState().generation;
  const input = {
    generation,
    name: 'proof',
    definition: session.getLastGoodArtifacts()!.project.scenes!.proof,
  };
  assert.equal(
    (await request('/capture', input, {Origin: 'https://unrelated.example'})).status,
    403,
  );
  assert.equal((await request('/capture', input, {'X-Tileflow-Workbench': ''})).status, 400);
  assert.equal((await request('/capture', {...input, generation: generation + 1})).status, 409);
  assert.equal(renders, 0);
  const first = await (await request('/capture', input)).json();
  const second = await (await request('/capture', input)).json();
  assert.match(first.captureId, /^[a-f0-9]{64}$/u);
  assert.equal(releases, 2);
  const history = await (await request('/captures')).json();
  assert.equal(history.records.length, 2);
  const image = await request('/captures/' + first.captureId + '.png');
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await image.arrayBuffer()).byteLength > 0, true);
  const review = await (
    await request('/compare', {before: first.captureId, after: second.captureId})
  ).json();
  assert.equal(review.review.status, 'comparable');
  assert.equal(review.review.exact.ratio, 1);
  assert.match(review.diff, /^data:image\/png;base64,/u);
  assert.equal(renders, 2);
  const moved = await (
    await request('/capture', {
      ...input,
      definition: {...input.definition, camera: {type: 'center', center: [2, 41], zoom: 8}},
    })
  ).json();
  const mismatch = await (
    await request('/compare', {before: first.captureId, after: moved.captureId})
  ).json();
  assert.equal(mismatch.review.status, 'frame-mismatch');
  assert.equal(mismatch.review.exact, null);
  assert.equal(mismatch.diff, null);

  blocked = true;
  const running = request('/capture', input);
  while (!finishCapture) await new Promise((done) => setTimeout(done, 1));
  assert.equal((await request('/capture', input)).status, 409);
  assert.equal((await request('/captures/delete', {id: first.captureId})).status, 409);
  finishCapture();
  await running;
  blocked = false;
  rejectCapture = true;
  assert.equal((await request('/capture', input)).status, 400);
  assert.equal(releases, renders);

  const deletion = {id: first.captureId};
  assert.equal(
    (await request('/captures/delete', deletion, {Origin: 'https://unrelated.example'})).status,
    403,
  );
  assert.equal(
    (await request('/captures/delete', deletion, {'X-Tileflow-Workbench': ''})).status,
    400,
  );
  assert.equal((await request('/captures/delete', {id: '../other-file'})).status, 400);
  assert.equal((await request('/captures/delete', deletion)).status, 200);
  assert.equal((await request('/captures/delete', deletion)).status, 200);
  const remaining = await readdir(join(cwd, '.tileflow/captures/records'));
  assert.ok(!remaining.some((name) => name.startsWith(first.captureId)));
  assert.ok(remaining.includes(second.captureId + '.json'));
  assert.ok(remaining.includes(second.captureId + '.png'));
  assert.ok(
    !(await (await request('/captures')).json()).records.some(
      (record: {id: string}) => record.id === first.captureId,
    ),
  );
  assert.equal((await request('/captures/' + first.captureId + '.png')).status, 400);

  await request('/context', {
    client: 'test-client',
    side: 'left',
    generation,
    context: {displayedGeneration: generation, selection: {owner: 'roads'}},
  });
  const context = await (await request('/context')).json();
  assert.equal(context.contexts[0].stale, false);
  assert.equal(context.contexts[0].context.selection.owner, 'roads');
  const state = session.getState.bind(session);
  session.getState = () =>
    ({
      status: 'invalid',
      generation: generation + 1,
      diagnostics: [],
      lastGoodGeneration: generation,
    }) as TileflowArtifactSessionState;
  assert.equal((await (await request('/context')).json()).contexts[0].stale, true);
  assert.equal((await request('/capture', input)).status, 409);
  session.getState = state;
  assert.equal(
    (
      await request('/context', {
        client: 'large',
        side: 'left',
        generation,
        context: {value: 'x'.repeat(70000)},
      })
    ).status,
    400,
  );

  const preview = createTileflowDevRequestHandler({
    basePath: '/map',
    session,
    map: 'map',
    theme: 'dark',
  });
  const scene = await preview(new Request('http://localhost:3333/map/?scene=proof'));
  assert.equal(scene.status, 200);
  assert.match(await scene.text(), /map \/ light \/ proof/u);
  const fitted = createTileflowDevRequestHandler({basePath: '/map', session, fitViewport: true});
  const fittedScene = await fitted(new Request('http://localhost:3333/map/?scene=proof'));
  const fittedHtml = await fittedScene.text();
  assert.match(fittedHtml, /html, body, #map \{ height: 100%/u);
  assert.doesNotMatch(fittedHtml, /width: 64px;/u);

  assert.equal(
    (await preview(new Request('http://localhost:3333/map/?scene=proof&scene=proof'))).status,
    400,
  );
});
