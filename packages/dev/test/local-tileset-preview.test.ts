import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  createTileflowDevRequestHandler,
  prepareTileflowLocalTilesets,
  writeTileflowBuildArtifacts,
} from '../src';

test('resolves one local hosted tileset for build, preview ranges, and the PMTiles protocol', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  const archive = createPmtiles();
  await writeFile(join(cwd, 'stores.pmtiles'), archive);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset, maplibreOverlay} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'stores-map', version: 1, extends: streets,
  sources: {
    stores: hostedTileset({tileset: 'stores', local: './stores.pmtiles', attribution: 'Store data © Example'})
  },
  overlays: {
    stores: maplibreOverlay({source: 'stores', placement: 'above-roads', layers: [
      {id: 'stores-points', type: 'circle', 'source-layer': 'store-locations', paint: {'circle-color': '#ef4444'}}
    ]})
  }
});
`,
  );

  const artifacts = await createTileflowBuildArtifacts({
    assetBaseUrl: 'http://127.0.0.1:3333',
    cwd,
  });
  t.after(() => artifacts.dispose?.());
  const canonicalArchivePath = await realpath(join(cwd, 'stores.pmtiles'));
  const localFile = artifacts.localTilesets?.[0];
  assert.ok(localFile);
  const snapshotPath = await realpath(localFile.sourcePath);
  assert.equal(localFile.byteLength, archive.byteLength);
  assert.equal(localFile.logicalId, 'stores');
  assert.equal(localFile.fileName, 'tilesets/stores.pmtiles');
  assert.match(localFile.etag, /^"snapshot-\d+-[a-f0-9]{32}-0"$/u);
  assert.equal('sha256' in localFile, false);
  assert.notEqual(artifacts.localTilesets?.[0]?.sourcePath, canonicalArchivePath);
  assert.deepEqual(await readFile(snapshotPath), Buffer.from(archive));
  assert.equal(
    artifacts.styles['stores-map']?.light?.sources.stores?.url,
    `tileflow-pmtiles://http://127.0.0.1:3333/${localFile.fileName}`,
  );
  assert.ok(artifacts.inputs.files.includes(canonicalArchivePath));

  const handler = createTileflowDevRequestHandler({cwd});
  t.after(() => handler.close());

  const style = (await (
    await handler(new Request('http://127.0.0.1:3333/styles/stores-map/light.json'))
  ).json()) as {sources: Record<string, {url?: string}>};
  const handlerFileName = /\/(tilesets\/[^/]+\.pmtiles)$/u.exec(
    style.sources.stores?.url ?? '',
  )?.[1];
  assert.ok(handlerFileName);
  const range = await handler(
    new Request(`http://127.0.0.1:3333/${handlerFileName}`, {
      headers: {Range: 'bytes=0-6'},
    }),
  );
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal(range.headers.get('content-range'), `bytes 0-6/${archive.byteLength}`);
  assert.match(range.headers.get('etag') ?? '', /^"snapshot-\d+-[a-f0-9]{32}-0"$/u);
  assert.equal(new TextDecoder().decode(await range.arrayBuffer()), 'PMTiles');
  const preview = await (await handler(new Request('http://127.0.0.1:3333/'))).text();
  assert.match(preview, /import \{registerTileflowPmtilesProtocol\}/u);
  assert.match(preview, /registerTileflowPmtilesProtocol\(\{addProtocol:/u);
  assert.doesNotMatch(preview, /new pmtilesModule\.Protocol/u);

  const configPath = join(cwd, 'tileflow.config.ts');
  const config = await readFile(configPath, 'utf8');
  await writeFile(
    configPath,
    config.replace("'source-layer': 'store-locations'", "'source-layer': 'missing'"),
  );
  await assert.rejects(
    () => createTileflowBuildArtifacts({cwd}),
    (error: unknown) => {
      const diagnostic = error as {code?: string; path?: string};
      assert.equal(diagnostic.code, 'TF_SOURCE_LAYER_NOT_FOUND');
      assert.equal(diagnostic.path, 'maps.stores-map.sources.stores.sourceLayers.missing');
      return true;
    },
  );
});

test('production build rejects an unresolved local PMTiles source before output mutation', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-production-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  await writeFile(join(cwd, 'stores.pmtiles'), createPmtiles());
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  await assert.rejects(
    () => writeTileflowBuildArtifacts({cwd, outDir: 'dist/tileflow'}),
    (error: unknown) =>
      (error as {code?: string}).code === 'TF_LOCAL_TILESET_PRODUCTION_UNRESOLVED',
  );
  await assert.rejects(stat(join(cwd, 'dist')), {code: 'ENOENT'});
});

test('keeps the logical local PMTiles URL stable across physical snapshot generations', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-logical-url-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  await writeFile(join(cwd, 'stores.pmtiles'), createPmtiles());
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  const first = await createTileflowBuildArtifacts({
    assetBaseUrl: 'http://127.0.0.1:3333',
    cwd,
  });
  const second = await createTileflowBuildArtifacts({
    assetBaseUrl: 'http://127.0.0.1:3333',
    cwd,
  });
  t.after(() => Promise.all([first.dispose?.(), second.dispose?.()]));

  assert.notEqual(first.localTilesets?.[0]?.sourcePath, second.localTilesets?.[0]?.sourcePath);
  assert.equal(first.localTilesets?.[0]?.fileName, 'tilesets/stores.pmtiles');
  assert.equal(second.localTilesets?.[0]?.fileName, 'tilesets/stores.pmtiles');
  assert.deepEqual(first.styles, second.styles);
  assert.equal(
    first.styles['stores-map']?.light?.sources.stores?.url,
    'tileflow-pmtiles://http://127.0.0.1:3333/tilesets/stores.pmtiles',
  );
});

test('a validated local snapshot remains immutable when the original becomes invalid', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-snapshot-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  const archive = createPmtiles();
  const archivePath = join(cwd, 'stores.pmtiles');
  await writeFile(archivePath, archive);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})}});`,
  );
  const artifacts = await createTileflowBuildArtifacts({
    assetBaseUrl: 'http://127.0.0.1:3333',
    cwd,
  });
  const snapshot = artifacts.localTilesets?.[0];
  assert.ok(snapshot);

  await writeFile(archivePath, Buffer.alloc(archive.byteLength, 0x42));

  assert.deepEqual(await readFile(snapshot.sourcePath), Buffer.from(archive));
  const session = {
    acquireArtifacts: () => ({
      artifacts,
      generation: 1,
      release: async () => undefined,
    }),
    close: async () => undefined,
    getLastGoodArtifacts: () => artifacts,
    getState: () => ({diagnostics: [], generation: 2, lastGoodGeneration: 1, status: 'invalid'}),
    refresh: async () => undefined,
    subscribe: () => () => undefined,
  } as never;
  const handler = createTileflowDevRequestHandler({session});
  t.after(() => handler.close());
  const response = await handler(
    new Request(`http://127.0.0.1:3333/${snapshot.fileName}`, {
      headers: {Range: 'bytes=0-6'},
    }),
  );
  assert.equal(new TextDecoder().decode(await response.arrayBuffer()), 'PMTiles');
});

test('keeps equal bytes from distinct local sources as distinct generation snapshots', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-names-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  const archive = createPmtiles();
  await writeFile(join(cwd, 'upper.pmtiles'), archive);
  await writeFile(join(cwd, 'lower.pmtiles'), archive);
  const source = (tileset: string, local: string) => ({
    attribution: 'Example',
    kind: 'hosted-tileset',
    local,
    tileset,
    type: 'vector',
  });
  const style = (sourceId: string) => ({
    layers: [],
    metadata: {'tileflow:sourceRequirements': {schemaVersion: 1, sources: {}}},
    sources: {[sourceId]: {type: 'vector'}},
    version: 8,
  });
  const prepared = await prepareTileflowLocalTilesets(
    {
      maps: {
        lower: {sources: {lower: source('stores', './lower.pmtiles')}},
        upper: {sources: {upper: source('Stores', './upper.pmtiles')}},
      },
    } as never,
    {lower: {light: style('lower')}, upper: {light: style('upper')}} as never,
    {assetBaseUrl: '/tileflow', baseDirectory: cwd, cwd},
  );

  assert.equal(new Set(prepared.files.map(({fileName}) => fileName)).size, 2);
  assert.notEqual(
    prepared.styles.lower?.light?.sources.lower?.url,
    prepared.styles.upper?.light?.sources.upper?.url,
  );
  await prepared.dispose();
});

test('releases a local snapshot when later artifact preparation fails', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-failed-plan-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  const archive = createPmtiles();
  await writeFile(join(cwd, 'stores.pmtiles'), archive);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,fonts:['./missing-fonts'],sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  await assert.rejects(() => createTileflowBuildArtifacts({cwd}));

  const entries = await readdir(join(cwd, '.tileflow/cache/pmtiles-snapshots/v1'));
  assert.deepEqual(
    entries.filter((entry) => entry.startsWith('snapshot-')),
    [],
  );
});

test('retains a replaced snapshot only while an initiated operation references it', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-generation-closure-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  const archivePath = join(cwd, 'stores.pmtiles');
  const configPath = join(cwd, 'tileflow.config.ts');
  await writeFile(
    configPath,
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );
  const firstArchive = createPmtiles(0);
  const secondArchive = createPmtiles(1);
  await writeFile(archivePath, firstArchive);
  const session = await createTileflowArtifactSession({cwd});
  t.after(() => session.close());
  const first = session.acquireArtifacts(1);
  assert.ok(first);
  const firstPath = first.artifacts.localTilesets?.[0]?.sourcePath;
  const firstFileName = first.artifacts.localTilesets?.[0]?.fileName;
  const firstEtag = first.artifacts.localTilesets?.[0]?.etag;
  assert.ok(firstPath);
  assert.ok(firstFileName);
  assert.ok(firstEtag);
  const handler = createTileflowDevRequestHandler({session});
  t.after(() => handler.close());
  const startedResponse = await handler(
    new Request(`http://127.0.0.1:3333/${firstFileName}`, {
      headers: {Range: `bytes=${firstArchive.byteLength - 1}-${firstArchive.byteLength - 1}`},
    }),
  );

  await writeFile(archivePath, secondArchive);
  await session.refresh('new local PMTiles bytes');

  const second = session.acquireArtifacts(2);
  assert.ok(second);
  const secondPath = second.artifacts.localTilesets?.[0]?.sourcePath;
  const secondFileName = second.artifacts.localTilesets?.[0]?.fileName;
  const secondEtag = second.artifacts.localTilesets?.[0]?.etag;
  assert.ok(secondPath);
  assert.equal(secondFileName, firstFileName);
  assert.ok(secondEtag);
  assert.notEqual(secondEtag, firstEtag);
  assert.notEqual(firstPath, secondPath);
  assert.deepEqual(await readFile(firstPath), Buffer.from(firstArchive));
  assert.deepEqual(await readFile(secondPath), Buffer.from(secondArchive));
  assert.equal(session.acquireArtifacts(1), undefined);
  const currentResponse = await handler(
    new Request(`http://127.0.0.1:3333/${firstFileName}`, {
      headers: {Range: `bytes=${secondArchive.byteLength - 1}-${secondArchive.byteLength - 1}`},
    }),
  );
  assert.equal(currentResponse.status, 206);
  assert.equal(currentResponse.headers.get('etag'), secondEtag);
  assert.deepEqual(new Uint8Array(await currentResponse.arrayBuffer()), new Uint8Array([1]));
  assert.equal(startedResponse.headers.get('etag'), firstEtag);
  assert.deepEqual(new Uint8Array(await startedResponse.arrayBuffer()), new Uint8Array([0]));

  await first.release();
  await assert.rejects(stat(firstPath), {code: 'ENOENT'});
  await second.release();
  await session.close();
  await assert.rejects(stat(secondPath), {code: 'ENOENT'});
});

test('collects an abandoned snapshot generation without touching live generations', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-recovery-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  const archive = createPmtiles();
  const store = join(cwd, '.tileflow/cache/pmtiles-snapshots/v1');
  const abandoned = join(store, `snapshot-2147483647-${'f'.repeat(32)}`);
  await mkdir(abandoned, {recursive: true});
  await writeFile(join(abandoned, '0.pmtiles'), archive);
  await writeFile(join(cwd, 'stores.pmtiles'), archive);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  const artifacts = await createTileflowBuildArtifacts({cwd});
  const live = artifacts.localTilesets?.[0]?.sourcePath;
  assert.ok(live);
  await assert.rejects(stat(abandoned), {code: 'ENOENT'});
  assert.equal((await stat(live)).isFile(), true);
  await artifacts.dispose?.();
});

test('refuses to write snapshots through a symlinked .tileflow boundary', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-outside-'));
  t.after(() =>
    Promise.all([
      rm(cwd, {force: true, recursive: true}),
      rm(outside, {force: true, recursive: true}),
    ]),
  );
  await linkWorkspacePackages(cwd);
  await symlink(outside, join(cwd, '.tileflow'), 'dir');
  await writeFile(join(cwd, 'stores.pmtiles'), createPmtiles());
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  await assert.rejects(createTileflowBuildArtifacts({cwd}), /symbolic link|symlink/u);
  await assert.rejects(stat(join(outside, 'cache')), {code: 'ENOENT'});
});

test('initializes one snapshot store safely across concurrent builders', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-tileset-concurrent-store-'));
  t.after(() => rm(cwd, {force: true, recursive: true}));
  await linkWorkspacePackages(cwd);
  await writeFile(join(cwd, 'stores.pmtiles'), createPmtiles());
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, hostedTileset} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'stores-map',version:1,extends:streets,sources:{
  stores:hostedTileset({tileset:'stores',local:'./stores.pmtiles',attribution:'Example'})
}});`,
  );

  const artifacts = await Promise.all([
    createTileflowBuildArtifacts({cwd}),
    createTileflowBuildArtifacts({cwd}),
  ]);
  await Promise.all(artifacts.map((item) => item.dispose?.()));
});

function createPmtiles(tileValue = 0) {
  const headerLength = 127;
  const directory = new Uint8Array([1, 0, 1, 1, 1]);
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      vector_layers: [
        {fields: {category: 'String'}, id: 'store-locations', maxzoom: 0, minzoom: 0},
      ],
    }),
  );
  const tile = new Uint8Array([tileValue]);
  const bytes = new Uint8Array(
    headerLength + directory.byteLength + metadata.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadata.byteLength;
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, directory.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadata.byteLength);
  setUint64(view, 40, tileOffset);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, 1);
  setUint64(view, 80, 1);
  setUint64(view, 88, 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, 0);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  bytes.set(directory, rootOffset);
  bytes.set(metadata, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}
