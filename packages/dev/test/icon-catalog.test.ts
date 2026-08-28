import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {defineMap, parseTileflowMap, type TileflowMap} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {
  compileTileflowIconPackages,
  inspectTileflowIconCatalogs,
  type TileflowIconCatalog,
} from '../src/index';

function defineResolvedMap(input: TileflowMap) {
  return parseTileflowMap(defineMap(input));
}

test('inspection exposes exact directory order, winning sources, and later-wins history', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-icon-catalog-'));
  const cwd = join(parent, 'repo');

  try {
    const baseCafe = simpleSvg('#ef4444');
    const brandCafe = simpleSvg('#111827');
    const bicycle = simpleSvg('#16a34a');
    const photo = simpleSvg('#2563eb');
    await writeFileEnsured(join(cwd, 'icons', 'base', 'cafe.svg'), baseCafe);
    await writeFileEnsured(join(cwd, 'icons', 'base', 'photo.svg'), photo);
    await writeFileEnsured(join(cwd, 'icons', 'brand', 'bicycle.svg'), bicycle);
    await writeFileEnsured(join(cwd, 'icons', 'brand', 'cafe.svg'), brandCafe);
    await writeFileEnsured(join(cwd, 'icons', 'clone', 'bicycle.svg'), bicycle);
    await writeFileEnsured(join(cwd, 'icons', 'clone', 'cafe.svg'), brandCafe);
    await writeFileEnsured(join(cwd, 'icons', 'clone', 'photo.svg'), photo);
    const project: TileflowBuildCatalog = {
      maps: {
        zeta: defineResolvedMap({
          id: 'zeta',
          version: 1,
          extends: streets,
          icons: ['./icons/base', './icons/brand'],
        }),
        none: defineResolvedMap({id: 'none', version: 1, extends: streets, icons: []}),
        clone: defineResolvedMap({
          id: 'clone',
          version: 1,
          extends: streets,
          icons: ['./icons/clone'],
        }),
      },
    };
    const before = await compileTileflowIconPackages(project, {cwd, target: 'local'});
    const inspection = await inspectTileflowIconCatalogs(project, {cwd});
    const after = await compileTileflowIconPackages(project, {cwd, target: 'local'});

    assert.deepEqual(after, before);
    assert.deepEqual(
      inspection.maps.map((map) => map.name),
      ['clone', 'none', 'zeta'],
    );
    assert.deepEqual(
      inspection.catalogs.map((catalog) => catalog.directories),
      [['./icons/base', './icons/brand'], ['./icons/clone']],
    );
    assert.equal(
      requiredCatalog(inspection.catalogs, ['./icons/base', './icons/brand']).insideWorkingTree,
      true,
    );

    const composed = requiredCatalog(inspection.catalogs, ['./icons/base', './icons/brand']);
    const clone = requiredCatalog(inspection.catalogs, ['./icons/clone']);
    assert.equal(composed.compiledPackage.contentHash, clone.compiledPackage.contentHash);
    assert.deepEqual(
      composed.compiledPackage.files.map((file) => Buffer.from(file.source).toString('hex')),
      clone.compiledPackage.files.map((file) => Buffer.from(file.source).toString('hex')),
    );
    assert.deepEqual(
      composed.icons.map((icon) => ({id: icon.id, path: icon.source.path})),
      [
        {id: 'bicycle', path: './icons/brand/bicycle.svg'},
        {id: 'cafe', path: './icons/brand/cafe.svg'},
        {id: 'photo', path: './icons/base/photo.svg'},
      ],
    );
    assert.deepEqual(composed.replacements, [
      {
        id: 'cafe',
        replaced: './icons/base/cafe.svg',
        winner: './icons/brand/cafe.svg',
      },
    ]);
    assert.equal(
      composed.icons.find((icon) => icon.id === 'cafe')?.source.byteLength,
      (await readFile(join(cwd, 'icons', 'brand', 'cafe.svg'))).byteLength,
    );

    for (const catalog of inspection.catalogs) {
      const compiled = before.packages.find(
        (candidate) => candidate.contentHash === catalog.compiledPackage.contentHash,
      );
      assert.ok(compiled);
      assert.deepEqual(catalog.compiledPackage.manifest, compiled.manifest);
      const oneX = JSON.parse(
        new TextDecoder().decode(
          catalog.compiledPackage.files.find((file) => file.fileName === 'sprite.json')?.source,
        ),
      ) as Record<
        string,
        {height: number; pixelRatio: number; width: number; x: number; y: number}
      >;
      for (const icon of catalog.icons) {
        assert.deepEqual(icon.rendered.oneX.atlas, withoutPixelRatio(oneX[icon.id]));
      }
    }

    const zeta = inspection.maps.find((map) => map.name === 'zeta');
    assert.ok(zeta?.icons.kind === 'directories');
    assert.deepEqual(zeta.icons.directories, ['./icons/base', './icons/brand']);
    assert.deepEqual(zeta.icons.iconIds, ['bicycle', 'cafe', 'photo']);
    assert.equal(zeta.icons.packageHash, composed.compiledPackage.contentHash);
    assert.deepEqual(
      inspection.maps.find((map) => map.name === 'none'),
      {
        name: 'none',
        icons: {kind: 'none'},
      },
    );
  } finally {
    await rm(parent, {force: true, recursive: true});
  }
});

test('filters maps before touching an unselected missing directory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-catalog-filter-'));

  try {
    await writeFileEnsured(join(cwd, 'icons', 'good.svg'), simpleSvg('#111827'));
    const project: TileflowBuildCatalog = {
      maps: {
        broken: defineResolvedMap({
          id: 'broken',
          version: 1,
          extends: streets,
          icons: ['./does-not-exist'],
        }),
        good: defineResolvedMap({
          id: 'good',
          version: 1,
          extends: streets,
          icons: ['./icons'],
        }),
      },
    };
    const inspection = await inspectTileflowIconCatalogs(project, {cwd, mapNames: ['good']});

    assert.deepEqual(
      inspection.maps.map((map) => map.name),
      ['good'],
    );
    assert.deepEqual(
      inspection.catalogs.map((catalog) => catalog.directories),
      [['./icons']],
    );
    assert.deepEqual(
      inspection.catalogs[0]?.icons.map((icon) => icon.id),
      ['good'],
    );
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

function requiredCatalog(
  catalogs: readonly TileflowIconCatalog[],
  directories: readonly string[],
): TileflowIconCatalog {
  const catalog = catalogs.find(
    (candidate) =>
      candidate.directories.length === directories.length &&
      candidate.directories.every((directory, index) => directory === directories[index]),
  );
  assert.ok(catalog, `Expected catalog ${directories.join(', ')}`);
  return catalog;
}

function withoutPixelRatio(
  entry: {height: number; pixelRatio: number; width: number; x: number; y: number} | undefined,
) {
  assert.ok(entry);
  return {height: entry.height, width: entry.width, x: entry.x, y: entry.y};
}

async function writeFileEnsured(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, contents);
}

function simpleSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}" /></svg>`;
}
