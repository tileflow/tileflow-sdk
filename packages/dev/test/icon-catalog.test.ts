import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import type {TileflowProjectConfig} from '@tileflow/core';
import {
  compileTileflowIconPackages,
  inspectTileflowIconCatalogs,
  type TileflowIconCatalog,
} from '../src/index';

test('inspects resolved catalogs once while preserving compiler bytes and map-specific mappings', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-icon-catalog-'));
  const cwd = join(parent, 'repo');
  const outside = join(parent, 'outside-icons');

  try {
    const shared = join(cwd, 'icons', 'shared');
    const clone = join(cwd, 'icons', 'clone');
    const vector = simpleSvg('#ef4444');
    const raster = await sharp({
      create: {background: '#2563eb', channels: 4, height: 8, width: 10},
    })
      .jpeg()
      .toBuffer();

    for (const directory of [shared, clone]) {
      await writeFileEnsured(join(directory, 'alpha.svg'), vector);
      await writeFileEnsured(join(directory, 'photo.jpeg'), raster);
      await writeFileEnsured(join(directory, 'portrait.jpg'), raster);
    }
    await writeFileEnsured(join(outside, 'outside.svg'), simpleSvg('#22c55e'));

    const project: TileflowProjectConfig = {
      icons: {
        alias: {
          extends: 'base',
          mapping: {alternate: 'photo'},
          source: './icons/../icons/shared',
        },
        base: {
          mapping: {missing: 'ghost', primary: 'alpha'},
          source: './icons/shared',
        },
        clone: {source: './icons/clone'},
        remote: {
          mapping: {remote: 'remote-id'},
          sprite: 'https://example.invalid/private/sprite?signature=secret',
        },
      },
      maps: {
        zeta: {icons: {extends: 'base', mapping: {primary: 'photo'}}},
        outside: {icons: {mapping: {outside: 'outside'}, source: '../outside-icons'}},
        none: {},
        external: {icons: 'remote'},
        clone: {icons: 'clone'},
        alpha: {icons: 'alias'},
      },
    };
    const before = await compileTileflowIconPackages(project, {cwd, target: 'local'});
    const inspection = await inspectTileflowIconCatalogs(project, {cwd});
    const after = await compileTileflowIconPackages(project, {cwd, target: 'local'});

    assert.deepEqual(after, before);
    assert.deepEqual(
      inspection.maps.map((map) => map.name),
      ['alpha', 'clone', 'external', 'none', 'outside', 'zeta'],
    );
    assert.deepEqual(
      inspection.catalogs.map((catalog) => catalog.sourcePath),
      ['../outside-icons', 'icons/clone', 'icons/shared'],
    );
    assert.equal(inspection.catalogs[0]?.insideWorkingTree, false);
    assert.equal(inspection.catalogs[1]?.insideWorkingTree, true);
    assert.equal(inspection.catalogs[2]?.insideWorkingTree, true);
    assert.ok(
      inspection.catalogs.every(
        (catalog) => !catalog.sourcePath.startsWith('/') && !catalog.sourcePath.includes('\\'),
      ),
    );

    const sharedCatalog = requiredCatalog(inspection.catalogs, 'icons/shared');
    const cloneCatalog = requiredCatalog(inspection.catalogs, 'icons/clone');
    assert.equal(
      sharedCatalog.compiledPackage.contentHash,
      cloneCatalog.compiledPackage.contentHash,
    );
    assert.deepEqual(
      sharedCatalog.compiledPackage.files.map((file) => Buffer.from(file.source).toString('hex')),
      cloneCatalog.compiledPackage.files.map((file) => Buffer.from(file.source).toString('hex')),
    );

    for (const catalog of inspection.catalogs) {
      const compiled = before.packages.find(
        (candidate) => candidate.contentHash === catalog.compiledPackage.contentHash,
      );
      assert.ok(compiled);
      assert.deepEqual(catalog.compiledPackage.manifest, compiled.manifest);
      assert.deepEqual(
        catalog.compiledPackage.files.map((file) => ({
          bytes: Buffer.from(file.source).toString('hex'),
          contentType: file.contentType,
          fileName: file.fileName,
        })),
        compiled.files.map((file) => ({
          bytes: Buffer.from(file.source).toString('hex'),
          contentType: file.contentType,
          fileName: file.fileName,
        })),
      );
    }

    assert.deepEqual(
      sharedCatalog.icons.map((icon) => ({
        dimensions: icon.source.dimensions,
        format: icon.source.format,
        id: icon.id,
        path: icon.source.path,
      })),
      [
        {
          dimensions: {height: 16, width: 16},
          format: 'svg',
          id: 'alpha',
          path: 'icons/shared/alpha.svg',
        },
        {
          dimensions: {height: 8, width: 10},
          format: 'jpeg',
          id: 'photo',
          path: 'icons/shared/photo.jpeg',
        },
        {
          dimensions: {height: 8, width: 10},
          format: 'jpeg',
          id: 'portrait',
          path: 'icons/shared/portrait.jpg',
        },
      ],
    );
    assert.equal(
      sharedCatalog.icons[0]?.source.byteLength,
      (await readFile(join(shared, 'alpha.svg'))).byteLength,
    );
    assert.equal(
      sharedCatalog.icons[1]?.source.byteLength,
      (await readFile(join(shared, 'photo.jpeg'))).byteLength,
    );

    const oneXIndex = JSON.parse(
      new TextDecoder().decode(
        sharedCatalog.compiledPackage.files.find((file) => file.fileName === 'sprite.json')?.source,
      ),
    ) as Record<string, {height: number; pixelRatio: number; width: number; x: number; y: number}>;
    const twoXIndex = JSON.parse(
      new TextDecoder().decode(
        sharedCatalog.compiledPackage.files.find((file) => file.fileName === 'sprite@2x.json')
          ?.source,
      ),
    ) as Record<string, {height: number; pixelRatio: number; width: number; x: number; y: number}>;

    for (const [index, icon] of sharedCatalog.icons.entries()) {
      const manifestIcon = sharedCatalog.compiledPackage.manifest.renderedIcons[index];
      assert.equal(icon.rendered.oneX.pixelSha256, manifestIcon?.pixelSha256.oneX);
      assert.equal(icon.rendered.twoX.pixelSha256, manifestIcon?.pixelSha256.twoX);
      assert.deepEqual(icon.rendered.oneX.atlas, withoutPixelRatio(oneXIndex[icon.id]));
      assert.deepEqual(icon.rendered.twoX.atlas, withoutPixelRatio(twoXIndex[icon.id]));
    }

    const alphaMap = inspection.maps.find((map) => map.name === 'alpha');
    const zetaMap = inspection.maps.find((map) => map.name === 'zeta');
    assert.equal(alphaMap?.icons.kind, 'local');
    assert.equal(zetaMap?.icons.kind, 'local');
    if (alphaMap?.icons.kind !== 'local' || zetaMap?.icons.kind !== 'local') {
      assert.fail('Expected local map bindings');
    }
    assert.equal(alphaMap.icons.catalogSourcePath, 'icons/shared');
    assert.equal(zetaMap.icons.catalogSourcePath, 'icons/shared');
    assert.deepEqual(alphaMap.icons.mappings, [
      {iconId: 'photo', semantic: 'alternate', targetStatus: 'present'},
      {iconId: 'ghost', semantic: 'missing', targetStatus: 'missing'},
      {iconId: 'alpha', semantic: 'primary', targetStatus: 'present'},
    ]);
    assert.deepEqual(zetaMap.icons.mappings, [
      {iconId: 'ghost', semantic: 'missing', targetStatus: 'missing'},
      {iconId: 'photo', semantic: 'primary', targetStatus: 'present'},
    ]);
    assert.deepEqual(sharedCatalog.icons[0]?.mappedFrom, [{map: 'alpha', semantic: 'primary'}]);
    assert.deepEqual(sharedCatalog.icons[1]?.mappedFrom, [
      {map: 'alpha', semantic: 'alternate'},
      {map: 'zeta', semantic: 'primary'},
    ]);

    const externalMap = inspection.maps.find((map) => map.name === 'external');
    const noneMap = inspection.maps.find((map) => map.name === 'none');
    assert.deepEqual(externalMap, {
      name: 'external',
      icons: {
        inspectable: false,
        kind: 'external',
        mappings: [{iconId: 'remote-id', semantic: 'remote', targetStatus: 'unknown'}],
      },
    });
    assert.deepEqual(noneMap, {
      name: 'none',
      icons: {inspectable: false, kind: 'none', mappings: []},
    });
  } finally {
    await rm(parent, {force: true, recursive: true});
  }
});

test('filters maps before icon source access and emits only the selected catalog', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-catalog-filter-'));

  try {
    await writeFileEnsured(join(cwd, 'icons', 'good.svg'), simpleSvg('#111827'));
    const project: TileflowProjectConfig = {
      maps: {
        broken: {icons: {source: './does-not-exist'}},
        good: {icons: {source: './icons'}},
      },
    };
    const inspection = await inspectTileflowIconCatalogs(project, {
      cwd,
      mapNames: ['good'],
    });

    assert.deepEqual(
      inspection.maps.map((map) => map.name),
      ['good'],
    );
    assert.deepEqual(
      inspection.catalogs.map((catalog) => catalog.sourcePath),
      ['icons'],
    );
    assert.deepEqual(
      inspection.catalogs[0]?.icons.map((icon) => icon.id),
      ['good'],
    );
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

test('does not fetch external sprites and succeeds without local catalogs', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('Unexpected fetch');
  };

  try {
    const inspection = await inspectTileflowIconCatalogs(
      {
        maps: {
          external: {
            icons: {
              mapping: {zeta: 'z-pin', Alpha: 'a-pin'},
              sprite: 'https://example.invalid/signed/sprite?token=secret',
            },
          },
          none: {},
          Zulu: {},
        },
      },
      {cwd: '/path/that/does/not/need/to/exist'},
    );

    assert.equal(requests, 0);
    assert.deepEqual(inspection.catalogs, []);
    assert.deepEqual(
      inspection.maps.map((map) => [map.name, map.icons.kind]),
      [
        ['Zulu', 'none'],
        ['external', 'external'],
        ['none', 'none'],
      ],
    );
    assert.deepEqual(inspection.maps[1]?.icons.mappings, [
      {iconId: 'a-pin', semantic: 'Alpha', targetStatus: 'unknown'},
      {iconId: 'z-pin', semantic: 'zeta', targetStatus: 'unknown'},
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function requiredCatalog(
  catalogs: readonly TileflowIconCatalog[],
  sourcePath: string,
): TileflowIconCatalog {
  const catalog = catalogs.find((candidate) => candidate.sourcePath === sourcePath);
  assert.ok(catalog, `Expected catalog ${sourcePath}`);
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
