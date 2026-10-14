import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  type TileflowCapture,
} from '@tileflow/capture';
import {normalizeTileflowCaptureScene, serializeCanonicalJson, sha256Hex} from '@tileflow/core';
import {captureRecordDirectory, readCaptureRecord, saveCaptureRecord} from '../src/capture-record';
import {boundJson, selectJsonPointer} from '../src/query-output';

const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const loader = import.meta.resolve('tsx');
async function run(args: string[], cwd?: string) {
  try {
    return {
      ...(await promisify(execFile)(process.execPath, ['--import', loader, cli, ...args], {cwd})),
      code: 0,
    };
  } catch (error) {
    const failure = error as {stdout: string; stderr: string; code: number};
    return failure;
  }
}

test('describe discovers generated domains and follows exact schema references without a config', async () => {
  const overview = await run(['describe', '--json']);
  assert.equal(overview.code, 0, overview.stderr);
  const document = JSON.parse(overview.stdout);
  assert.equal(document.command, 'describe');
  const roads = document.data.domains.find((domain: {name: string}) => domain.name === 'roads');
  const domain = await run(['describe', 'roads', '--json', '--limit', '12']);
  const reference = await run(['describe', '--ref', roads.schemaRef, '--json', '--limit', '12']);
  assert.equal(domain.code, 0, domain.stderr);
  assert.deepEqual(JSON.parse(domain.stdout).data, JSON.parse(reference.stdout).data);
  assert.equal(JSON.parse(domain.stdout).projection.truncated, true);
  const bad = await run(['describe', 'nonexistent', '--json']);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.equal(JSON.parse(bad.stderr).command, 'describe');
});

test('bounded projections report omissions and cannot read prototypes', () => {
  const value = {'a/b': {'~value': 3}, list: [1, 2, 3]};
  assert.equal(selectJsonPointer(value, '/a~1b/~0value'), 3);
  assert.throws(() => selectJsonPointer(value, '/constructor'), /No value/);
  assert.throws(() => selectJsonPointer(value, '/a~2b'), /JSON Pointer/);
  const result = boundJson(value, {limit: 2, depth: 2});
  assert.equal(result.projection.truncated, true);
  assert.deepEqual(result.projection.omitted, ['/list']);
  assert.deepEqual(result.data, {'a/b': {'~value': 3}});
});

test('saved capture comparison works without a config, preserves DPR, and rejects tampering', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-saved-captures-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const beforeCapture = await fixtureCapture(1);
  const afterCapture = await fixtureCapture(2);
  const before = await saveCaptureRecord(beforeCapture, cwd);
  const after = await saveCaptureRecord(afterCapture, cwd);
  assert.equal(await saveCaptureRecord(beforeCapture, cwd), before);
  const restored = await readCaptureRecord(before, join(cwd, captureRecordDirectory));
  assert.equal(restored.capture.width, 64);
  assert.equal(restored.capture.dpr, 2);
  const result = await run(['compare', '--before', before, '--after', after, '--json'], cwd);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.reused, true);
  assert.equal(document.review.status, 'comparable');
  assert.equal(document.review.exact.ratio, 1);
  const mismatch = await saveCaptureRecord(await fixtureCapture(2, 8), cwd);
  const invalidFrame = await run(
    ['compare', '--before', before, '--after', mismatch, '--json'],
    cwd,
  );
  assert.equal(invalidFrame.code, 1);
  assert.equal(JSON.parse(invalidFrame.stdout).review.status, 'frame-mismatch');
  const pngPath = join(cwd, captureRecordDirectory, `${before}.png`);
  const bytes = await readFile(pngPath);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(pngPath, bytes);
  const tampered = await run(['compare', '--before', before, '--after', after, '--json'], cwd);
  assert.equal(tampered.code, 1);
  assert.equal(tampered.stdout, '');
  assert.match(tampered.stderr, /does not match its receipt/);
  assert.equal(JSON.parse(tampered.stderr).command, 'compare');
});

test('canonical groups expose inspection and comparison without duplicating implementations', async () => {
  for (const command of [
    ['inspect', 'compiled'],
    ['inspect', 'icons'],
    ['inspect', 'tileset'],
    ['compare', 'configs'],
    ['compare', 'styles'],
    ['compare', 'reference'],
    ['compare', 'baseline'],
  ]) {
    const result = await run([...command, '--help']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
  const failed = await run([
    'compare',
    'reference',
    'scene',
    '--reference',
    'missing.png',
    '--json',
  ]);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, '');
  assert.equal(JSON.parse(failed.stderr).status, 'failed');
  const parserFailure = await run(['compare', 'reference', 'scene', '--json']);
  assert.equal(parserFailure.code, 1);
  assert.equal(parserFailure.stdout, '');
  assert.equal(JSON.parse(parserFailure.stderr).phase, 'command-validation');
});

async function fixtureCapture(color: number, zoom = 7): Promise<TileflowCapture> {
  const definition = normalizeTileflowCaptureScene({
    map: 'map',
    theme: 'light',
    camera: {type: 'center', center: [2, 41], zoom},
    viewport: {width: 64, height: 64, dpr: 2},
    target: {kind: 'map'},
  });
  const image = new PNG({width: 128, height: 128});
  for (let i = 0; i < image.data.length; i += 4) image.data.set([color * 90, 0, 0, 255], i);
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
      archiveSha256: 'd'.repeat(64),
      contractSha256: 'e'.repeat(64),
      dataContractSha256: 'f'.repeat(64),
      descriptorSha256: 'c'.repeat(64),
    },
    dpr: 2,
    height: 64,
    width: 64,
    map: 'map',
    theme: 'light',
    target: 'map',
    scene: 'view',
    networkDependent: false,
    pngSha256: await sha256Hex(png),
    renderer,
    sceneSha256: await sha256Hex(serializeCanonicalJson(definition)),
    styleSha256: String(color).repeat(64),
  });
  return {
    definition: {...definition, theme: 'light'},
    png,
    receipt,
    scene: 'view',
    map: 'map',
    theme: 'light',
    target: 'map',
    sha256: receipt.image.sha256,
    sceneSha256: receipt.scene.sha256,
    styleSha256: receipt.style.sha256,
    width: 64,
    height: 64,
    dpr: 2,
    networkDependent: false,
    renderer,
    warnings: [],
  };
}
