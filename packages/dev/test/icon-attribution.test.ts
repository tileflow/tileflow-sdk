import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {defineMap, parseTileflowMap, type TileflowIconDirectory} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {prepareTileflowCatalogIcons, TileflowIconCompilationError} from '../src/icons';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="4" y="4" width="16" height="16" fill="#e8112d"/></svg>';
const attribution = {
  credit: 'Example Author',
  source: 'https://commons.wikimedia.org/wiki/File:Example.svg',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  licenseFile: 'LICENSE-CC-BY-SA-4.0.txt',
  changes: 'Scaled into a 24px map icon cell.',
};

function catalog(icons: TileflowIconDirectory[]): TileflowBuildCatalog {
  return {
    maps: {main: parseTileflowMap(defineMap({id: 'main', version: 1, extends: streets, icons}))},
  };
}

async function withDirectory(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-attribution-'));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
}

async function writeIcons(
  directory: string,
  icons: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<void> {
  await mkdir(directory, {recursive: true});
  for (const id of Object.keys(icons)) await writeFile(join(directory, `${id}.svg`), svg);
  await writeFile(
    join(directory, 'tileflow.icons.json'),
    JSON.stringify({schemaVersion: 1, icons: Object.fromEntries(Object.entries(icons))}),
  );
  for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
}

test('writes the credit and complete license beside the sprite for each attributed winner', async () => {
  await withDirectory(async (cwd) => {
    await writeIcons(
      join(cwd, 'icons'),
      {'city-metro': {representation: 'rgba', attribution}, plain: {representation: 'rgba'}},
      {'LICENSE-CC-BY-SA-4.0.txt': 'Full license text.\n\nSecond paragraph.\n\n'},
    );

    const prepared = await prepareTileflowCatalogIcons(catalog(['./icons']), {
      assetBaseUrl: '/assets',
      cwd,
    });

    const notices = prepared.assets.filter((asset) => asset.fileName.includes('/licenses/'));
    assert.deepEqual(notices, [
      {
        contentType: 'text/plain; charset=utf-8',
        fileName: 'icons/main/licenses/city-metro.txt',
        source: [
          'Icon: city-metro',
          'Credit: Example Author',
          'Source: https://commons.wikimedia.org/wiki/File:Example.svg',
          'License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
          'Changes: Scaled into a 24px map icon cell.',
          '',
          'Full license text.',
          '',
          'Second paragraph.',
          '',
        ].join('\n'),
      },
    ]);
  });
});

test('a later contributor that replaces an attributed icon drops its credit', async () => {
  await withDirectory(async (cwd) => {
    await writeIcons(
      join(cwd, 'third-party'),
      {'city-metro': {representation: 'rgba', attribution}},
      {'LICENSE-CC-BY-SA-4.0.txt': 'Full license text.\n'},
    );
    await writeIcons(join(cwd, 'own'), {'city-metro': {representation: 'rgba'}});

    const prepared = await prepareTileflowCatalogIcons(catalog(['./third-party', './own']), {
      assetBaseUrl: '/assets',
      cwd,
    });

    assert.deepEqual(
      prepared.assets.map((asset) => asset.fileName),
      [
        'icons/main/sprite.json',
        'icons/main/sprite.png',
        'icons/main/sprite@2x.json',
        'icons/main/sprite@2x.png',
      ],
    );
  });
});

test('an attribution fails closed without its license text inside the icon directory', async () => {
  await withDirectory(async (cwd) => {
    await writeIcons(join(cwd, 'missing'), {'city-metro': {representation: 'rgba', attribution}});
    await assert.rejects(
      prepareTileflowCatalogIcons(catalog(['./missing']), {assetBaseUrl: '/assets', cwd}),
      (error: unknown) =>
        error instanceof TileflowIconCompilationError &&
        error.issues.some((issue) => issue.path.endsWith('/LICENSE-CC-BY-SA-4.0.txt')),
    );

    await writeFile(join(cwd, 'outside.txt'), 'Outside license.\n');
    await writeIcons(join(cwd, 'escaping'), {'city-metro': {representation: 'rgba', attribution}});
    await symlink(join(cwd, 'outside.txt'), join(cwd, 'escaping/LICENSE-CC-BY-SA-4.0.txt'));
    await assert.rejects(
      prepareTileflowCatalogIcons(catalog(['./escaping']), {assetBaseUrl: '/assets', cwd}),
      (error: unknown) =>
        error instanceof TileflowIconCompilationError &&
        error.issues.some((issue) => issue.message.includes('escapes its icon directory')),
    );

    await writeIcons(
      join(cwd, 'empty'),
      {'city-metro': {representation: 'rgba', attribution}},
      {'LICENSE-CC-BY-SA-4.0.txt': '  \n'},
    );
    await assert.rejects(
      prepareTileflowCatalogIcons(catalog(['./empty']), {assetBaseUrl: '/assets', cwd}),
      TileflowIconCompilationError,
    );
  });
});

test('attribution metadata rejects license paths outside the icon directory', async () => {
  await withDirectory(async (cwd) => {
    await writeIcons(join(cwd, 'icons'), {
      'city-metro': {
        representation: 'rgba',
        attribution: {...attribution, licenseFile: '../LICENSE.txt'},
      },
    });
    await assert.rejects(
      prepareTileflowCatalogIcons(catalog(['./icons']), {assetBaseUrl: '/assets', cwd}),
      (error: unknown) =>
        error instanceof TileflowIconCompilationError &&
        error.issues.some((issue) => issue.message.startsWith('Invalid icon metadata')),
    );
  });
});
