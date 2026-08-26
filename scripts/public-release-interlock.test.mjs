import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  assertPublicReleaseReady,
  PublicReleaseBlockedError,
  publicReleaseBlockersFileName,
  publicReleaseBlockersKind,
  readPublicReleaseBlockers,
} from './public-release-interlock.mjs';

test('an absent release-blocker file opens the interlock', async (t) => {
  const root = await fixture(t);
  assert.equal(await readPublicReleaseBlockers(root), null);
  await assert.doesNotReject(assertPublicReleaseReady(root));
});

test('a valid release-blocker file is machine-readable and blocks publication', async (t) => {
  const root = await fixture(t);
  await writeBlockers(root, {
    blockers: [{id: 'trusted-publisher', summary: 'Configure and verify npm OIDC trust.'}],
    kind: publicReleaseBlockersKind,
    schemaVersion: 1,
  });

  assert.deepEqual(await readPublicReleaseBlockers(root), {
    blockers: [{id: 'trusted-publisher', summary: 'Configure and verify npm OIDC trust.'}],
    kind: publicReleaseBlockersKind,
    schemaVersion: 1,
  });
  await assert.rejects(assertPublicReleaseReady(root), (error) => {
    assert.ok(error instanceof PublicReleaseBlockedError);
    assert.match(error.message, /trusted-publisher/u);
    return true;
  });
});

test('malformed or semantically invalid blocker files fail closed', async (t) => {
  const root = await fixture(t);
  const path = join(root, publicReleaseBlockersFileName);
  await writeFile(path, '{');
  await assert.rejects(readPublicReleaseBlockers(root), /must contain valid JSON/u);

  for (const document of [
    {blockers: [], kind: publicReleaseBlockersKind, schemaVersion: 1},
    {
      blockers: [
        {id: 'duplicate', summary: 'First.'},
        {id: 'duplicate', summary: 'Second.'},
      ],
      kind: publicReleaseBlockersKind,
      schemaVersion: 1,
    },
    {
      blockers: [{id: 'valid', summary: 'Valid.', unexpected: true}],
      kind: publicReleaseBlockersKind,
      schemaVersion: 1,
    },
  ]) {
    await writeBlockers(root, document);
    await assert.rejects(readPublicReleaseBlockers(root));
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-release-interlock-'));
  t.after(() => rm(root, {force: true, recursive: true}));
  await mkdir(root, {recursive: true});
  return root;
}

async function writeBlockers(root, document) {
  await writeFile(join(root, publicReleaseBlockersFileName), `${JSON.stringify(document)}\n`);
}
