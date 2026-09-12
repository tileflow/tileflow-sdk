import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {iconSet, serializeTileflowIconsLockfile} from '@tileflow/core';
import {
  getTileflowIconCacheDirectory,
  loadTileflowIconSetArtifact,
  storeTileflowIconSetArtifact,
} from '../src/icon-cache';
import {readTileflowIconsLockfile, writeTileflowIconsLockfile} from '../src/icon-lockfile';
import {lockFor, renderedIcon, setFixture, withIconSetFixture} from './icon-set-fixtures';

test('cold hydration downloads exactly four bounded files without credentials; warm offline uses no network', async () => {
  await withIconSetFixture(async (cacheRoot) => {
    const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [0, 20, 255, 210])]);
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      assert.equal(options?.credentials, 'omit');
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).has('authorization'), false);
      const file = artifact.files.find((file) => String(url).endsWith(`/${file.fileName}`))!;
      return new Response(new Uint8Array(file.source).buffer, {
        headers: {'Content-Type': file.contentType, 'Content-Length': String(file.source.length)},
      });
    };
    const cold = await loadTileflowIconSetArtifact(pin, {cacheRoot, fetch});
    assert.equal(calls.length, 4);
    assert.ok(calls.every((url) => url.startsWith(pin.spriteUrl)));
    const warm = await loadTileflowIconSetArtifact(pin, {
      cacheRoot,
      offline: true,
      fetch: async () => {
        throw new Error('Network must not run');
      },
    });
    assert.deepEqual(warm, cold);
    assert.deepEqual(
      (await readdir(join(getTileflowIconCacheDirectory({cacheRoot}), pin.contentHash))).sort(),
      artifact.files.map((file) => file.fileName).sort(),
    );
  });
});

test('missing offline pins, untrusted origins and malformed responses fail without cache installation', async () => {
  await withIconSetFixture(async (cacheRoot) => {
    const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [0, 20, 255, 210])]);
    await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true}), {
      code: 'ICON_CACHE_MISS',
    });
    await assert.rejects(
      loadTileflowIconSetArtifact(
        {...pin, spriteUrl: pin.spriteUrl.replace('api.tileflow.dev', 'untrusted.example')},
        {
          cacheRoot,
          fetch: async () => {
            throw new Error('Must not fetch');
          },
        },
      ),
      {code: 'ICON_DOWNLOAD_FAILED'},
    );
    for (const response of [
      () => new Response('redirect', {status: 302}),
      () => new Response('wrong MIME', {headers: {'Content-Type': 'text/html'}}),
      () =>
        new Response(new Uint8Array(artifact.files[0]!.source.length + 1), {
          headers: {'Content-Type': 'application/json'},
        }),
      () => new Response(new Uint8Array(1), {headers: {'Content-Type': 'application/json'}}),
    ])
      await assert.rejects(
        loadTileflowIconSetArtifact(pin, {cacheRoot, fetch: async () => response()}),
        {code: 'ICON_DOWNLOAD_FAILED'},
      );
    await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true}), {
      code: 'ICON_CACHE_MISS',
    });
  });
});

test('concurrent writers converge and exact corrupted cache entries are safely repairable', async () => {
  await withIconSetFixture(async (cacheRoot) => {
    const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [0, 20, 255, 210])]);
    await Promise.all(
      Array.from({length: 8}, () => storeTileflowIconSetArtifact(pin, artifact, {cacheRoot})),
    );
    const path = join(getTileflowIconCacheDirectory({cacheRoot}), pin.contentHash, 'sprite.png');
    const damaged = new Uint8Array(artifact.files[1]!.source);
    damaged[0] = 0;
    await writeFile(path, damaged);
    await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true}), {
      code: 'ICON_PACKAGE_INTEGRITY',
    });
    await Promise.all(
      Array.from({length: 3}, () => storeTileflowIconSetArtifact(pin, artifact, {cacheRoot})),
    );
    assert.equal(
      (await loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true})).package.contentHash,
      artifact.contentHash,
    );
    assert.deepEqual(
      (await readdir(getTileflowIconCacheDirectory({cacheRoot}))).filter((name) =>
        name.startsWith('.'),
      ),
      [],
    );
  });
});

test('cache rejects symlinks rather than following or repairing them', async (t) => {
  await withIconSetFixture(async (cacheRoot) => {
    const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [0, 20, 255, 210])]);
    await storeTileflowIconSetArtifact(pin, artifact, {cacheRoot});
    const path = join(getTileflowIconCacheDirectory({cacheRoot}), pin.contentHash, 'sprite.png');
    const outside = join(cacheRoot, 'outside.png');
    await writeFile(outside, artifact.files[1]!.source);
    await rm(path);
    try {
      await symlink(outside, path, 'file');
    } catch (cause) {
      if (process.platform === 'win32') {
        t.skip(`Symlinks unavailable: ${String(cause)}`);
        return;
      }
      throw cause;
    }
    await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true}), {
      code: 'ICON_CACHE_UNSAFE',
    });
    await assert.rejects(storeTileflowIconSetArtifact(pin, artifact, {cacheRoot}), {
      code: 'ICON_CACHE_UNSAFE',
    });
    assert.deepEqual(
      new Uint8Array(await readFile(outside)),
      new Uint8Array(artifact.files[1]!.source),
    );
  });
});

test('lock writes are atomic compare-and-swap operations and preserve unrelated pins', async () => {
  await withIconSetFixture(async (cwd) => {
    const {pin} = await setFixture(1, [renderedIcon('marker', [0, 20, 255, 210])]);
    const lock = lockFor({'@acme/brand': pin});
    const results = await Promise.allSettled([
      writeTileflowIconsLockfile(cwd, lock, null),
      writeTileflowIconsLockfile(cwd, lock, null),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const encoded = await readFile(join(cwd, 'tileflow.icons.lock.json'), 'utf8');
    assert.equal(encoded, await serializeTileflowIconsLockfile(lock));
    assert.deepEqual(await readTileflowIconsLockfile(cwd, [iconSet('@acme/brand')]), lock);
    await assert.rejects(writeTileflowIconsLockfile(cwd, lock, null), {code: 'ICON_LOCK_CONFLICT'});
    await writeTileflowIconsLockfile(cwd, lock, encoded);
    await mkdir(join(cwd, '.tileflow.icons.lock.json.writing'));
    await assert.rejects(writeTileflowIconsLockfile(cwd, lock, encoded), {
      code: 'ICON_LOCK_CONFLICT',
    });
    assert.equal(await readFile(join(cwd, 'tileflow.icons.lock.json'), 'utf8'), encoded);
  });
});
