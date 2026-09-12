import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {iconSet, serializeTileflowIconsLockfile, tileflowIconsLockfileName} from '@tileflow/core';
import {loadTileflowIconSetArtifact, storeTileflowIconSetArtifact} from '../src/icon-cache';
import {composeTileflowIconSources} from '../src/icon-composition';
import {lockFor, renderedIcon, setFixture, withIconSetFixture} from './icon-set-fixtures';

test('invalid manifest identity is rejected before any cache hydration or fetch', async () => {
  await withIconSetFixture(async (cwd) => {
    const set = await setFixture(1, [renderedIcon('marker', [1, 2, 3, 255])]);
    let calls = 0;
    await assert.rejects(
      loadTileflowIconSetArtifact(
        {...set.pin, contentHash: 'f'.repeat(64)},
        {
          cacheRoot: cwd,
          fetch: async () => {
            calls += 1;
            throw new Error('Must not fetch');
          },
        },
      ),
      {code: 'ICON_LOCK_INVALID'},
    );
    assert.equal(calls, 0);
  });
});

test('implicit lock reads are watchable and a changed pin is acquired as a new snapshot', async () => {
  await withIconSetFixture(async (cwd) => {
    const set = await setFixture(1, [renderedIcon('marker', [1, 2, 3, 255])]);
    await storeTileflowIconSetArtifact(set.pin, set.artifact, {cacheRoot: cwd});
    const lock = lockFor({'@acme/brand': set.pin});
    const path = join(cwd, tileflowIconsLockfileName);
    await writeFile(path, await serializeTileflowIconsLockfile(lock));
    const first = await composeTileflowIconSources([iconSet('@acme/brand')], {
      cwd,
      cacheRoot: cwd,
      offline: true,
    });
    assert.deepEqual(first.watchPaths, [path]);
    lock.sets['@acme/brand']!.version = 2;
    lock.sets['@acme/brand']!.versionId = `icv_${'revision-two'.padStart(16, '0')}`;
    await writeFile(path, await serializeTileflowIconsLockfile(lock));
    const second = await composeTileflowIconSources([iconSet('@acme/brand')], {
      cwd,
      cacheRoot: cwd,
      offline: true,
    });
    assert.equal(first.package!.contentHash, second.package!.contentHash);
    assert.notDeepEqual(first.composition, second.composition);
  });
});

test('oversized intrinsic patterns are rejected before allocating rendered output', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(
      join(cwd, 'icons', 'large.pattern.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="2048"><rect width="512" height="2048" fill="red"/></svg>',
    );
    await assert.rejects(
      composeTileflowIconSources(['./icons'], {cwd}),
      /paired sprite capacity before rasterization/u,
    );
  });
});
