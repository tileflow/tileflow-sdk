import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {streetsIcons} from '@tileflow/maps';
import {
  resolveTileflowAssetDirectories,
  TileflowAssetDirectoryError,
} from '../src/asset-directories';

test('resolves ordered local and imported package directories with explicit ownership', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-directories-'));
  try {
    await mkdir(join(cwd, 'icons'));
    const resolved = await resolveTileflowAssetDirectories(['./icons', streetsIcons], {
      configPath: 'map.icons',
      cwd,
      kind: 'icons',
      target: 'local',
    });

    assert.equal(resolved.length, 2);
    assert.equal(resolved[0]?.packageOwned, false);
    assert.equal(resolved[0]?.watch, true);
    assert.equal(resolved[1]?.packageOwned, true);
    assert.equal(resolved[1]?.watch, false);
    assert.match(resolved[1]?.realPath ?? '', /maps\/assets\/streets\/icons$/u);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

test('resolves local directories from an explicit nested config base inside cwd', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-directories-nested-'));
  const baseDirectory = join(cwd, 'apps', 'map');
  try {
    await mkdir(join(baseDirectory, 'icons'), {recursive: true});
    await mkdir(join(cwd, 'apps', 'shared'));

    const resolved = await resolveTileflowAssetDirectories(['./icons', '../shared'], {
      baseDirectory,
      configPath: 'map.icons',
      cwd,
      kind: 'icons',
      target: 'local',
    });

    assert.deepEqual(
      resolved.map(({realPath}) => realPath),
      [await realpath(join(baseDirectory, 'icons')), await realpath(join(cwd, 'apps', 'shared'))],
    );
    const realCwd = await realpath(cwd);
    assert.equal(
      resolved.every(({containmentRoot}) => containmentRoot === realCwd),
      true,
    );
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

test('rejects non-canonical local syntax even when normalization would find a directory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-directories-syntax-'));
  const baseDirectory = join(cwd, 'apps', 'map');
  try {
    await mkdir(join(baseDirectory, 'icons'), {recursive: true});
    await mkdir(join(baseDirectory, 'other'));
    await mkdir(join(cwd, 'apps', 'shared'));

    for (const directory of [
      './icons/',
      './icons//',
      '././icons',
      './icons/../other',
      '../shared/../map/icons',
      './icons\\nested',
      './icons\0nested',
    ]) {
      await assert.rejects(
        resolveTileflowAssetDirectories([directory] as never, {
          baseDirectory,
          configPath: 'map.icons',
          cwd,
          kind: 'icons',
          target: 'local',
        }),
        (error: unknown) =>
          error instanceof TileflowAssetDirectoryError && error.issues[0]?.path === 'map.icons.0',
      );
    }
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

test('rejects URL, bare, escaping, duplicate, and malformed package directories', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-directories-invalid-'));
  try {
    await mkdir(join(cwd, 'icons'));
    for (const directories of [
      ['icons'],
      ['https://assets.example.test/icons'],
      ['/absolute/icons'],
      ['./icons', './icons'],
      [{kind: 'package-directory', package: '@Bad/Name', path: 'icons'}],
      [{kind: 'package-directory', package: '@tileflow/core', path: '../icons'}],
    ] as const) {
      await assert.rejects(
        resolveTileflowAssetDirectories(directories as never, {
          configPath: 'map.icons',
          cwd,
          kind: 'icons',
          target: 'hosted',
        }),
        TileflowAssetDirectoryError,
      );
    }
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});
