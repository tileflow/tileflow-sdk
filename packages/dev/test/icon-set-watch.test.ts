import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  hashTileflowIconComposition,
  serializeTileflowIconsLockfile,
  tileflowIconsLockfileName,
  type TileflowIconsLockfileV1,
} from '@tileflow/core';
import {createTileflowIconSetProject} from '../../../test-support/icon-set-project';
import {createTileflowArtifactSession, isTileflowArtifactInputPath} from '../src/artifacts';

async function fixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-set-watch-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  return {cwd, project: await createTileflowIconSetProject(cwd)};
}

test('a lock edit rebuilds from its new exact pins without any catalog lookup', async (t) => {
  const {cwd, project} = await fixture(t);
  let requests = 0;
  const session = await createTileflowArtifactSession({
    assetBaseUrl: '/tileflow',
    cwd,
    icons: {
      cacheRoot: project.cacheRoot,
      fetch: (async () => {
        requests += 1;
        return new Response(new Uint8Array(), {status: 200});
      }) as typeof globalThis.fetch,
    },
    styleBaseUrl: '/tileflow',
    watch: false,
  });
  t.after(() => session.close());

  const initial = session.getLastGoodArtifacts();
  assert.ok(initial);
  const initialReceipt = initial.buildManifest.maps.main!.sourceAssets.iconComposition;
  assert.ok(initialReceipt);
  assert.equal(
    initialReceipt.contributors[0]!.kind === 'icon-set' && initialReceipt.contributors[0]!.version,
    1,
  );
  assert.ok(
    isTileflowArtifactInputPath(
      (initial as unknown as {inputs: {directories: string[]; files: string[]}}).inputs,
      join(cwd, tileflowIconsLockfileName),
    ),
  );

  // Publishing a newer catalog revision changes nothing until the exact lock changes.
  const next = await project.publishNewerRevision('@acme/brand');
  await session.refresh('catalog publication');
  assert.deepEqual(
    session.getLastGoodArtifacts()?.buildManifest.maps.main!.sourceAssets.iconComposition,
    initialReceipt,
  );

  const lock = JSON.parse(
    await readFile(join(cwd, tileflowIconsLockfileName), 'utf8'),
  ) as TileflowIconsLockfileV1;
  lock.sets['@acme/brand'] = next;
  await writeFile(join(cwd, tileflowIconsLockfileName), await serializeTileflowIconsLockfile(lock));
  await session.refresh('lock edit');

  const updated = session.getLastGoodArtifacts()?.buildManifest.maps.main!.sourceAssets
    .iconComposition;
  assert.ok(updated);
  assert.equal(
    updated.contributors[0]!.kind === 'icon-set' && updated.contributors[0]!.version,
    next.version,
  );
  // `@acme/brand` is fully shadowed, so the effective bytes are unchanged while the exact
  // dependency vector — and therefore the map revision — is not.
  assert.equal(updated.packageHash, initialReceipt.packageHash);
  assert.notEqual(
    await hashTileflowIconComposition(updated),
    await hashTileflowIconComposition(initialReceipt),
  );
  assert.notEqual(
    session.getLastGoodArtifacts()?.buildManifest.maps.main!.mapRevisionSha256,
    initial.buildManifest.maps.main!.mapRevisionSha256,
  );
  assert.equal(requests, 0);
});

test('an invalid lock preserves the last good artifact for preview and capture', async (t) => {
  const {cwd, project} = await fixture(t);
  const session = await createTileflowArtifactSession({
    assetBaseUrl: '/tileflow',
    cwd,
    icons: {cacheRoot: project.cacheRoot, offline: true},
    styleBaseUrl: '/tileflow',
    watch: false,
  });
  t.after(() => session.close());
  const good = session.getLastGoodArtifacts();
  assert.ok(good);

  await writeFile(join(cwd, tileflowIconsLockfileName), '{"lockfileVersion":1,"sets":{}}\n');
  await session.refresh('invalid lock');

  const state = session.getState();
  assert.equal(state.status, 'invalid');
  assert.equal(session.getLastGoodArtifacts(), good);
});
