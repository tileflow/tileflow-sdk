import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {hashTileflowIconPackageManifest, sha256Hex} from '@tileflow/core';
import {composeTileflowIconSources, verifyTileflowIconArtifact} from '../src/icons';
import {withIconSetFixture} from './icon-set-fixtures';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="red" fill-rule="evenodd" d="M6 6H18V18H6Z M10 10V14H14V10Z"/></svg>';
const metadata = {
  schemaVersion: 1,
  icons: {health: {representation: 'sdf', defaults: {color: '#c43d35'}}},
};

test('ordinary SVG names generate verified SDF at both densities with semantic identity', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/health.svg'), svg);
    await writeFile(join(cwd, 'icons/tileflow.icons.json'), JSON.stringify(metadata));
    const result = await composeTileflowIconSources(['./icons'], {cwd});
    assert.equal(result.package!.manifest.format, 'tileflow-icon-package-v2');
    const verified = await verifyTileflowIconArtifact(result.package!);
    assert.equal(
      (verified.icons[0] as unknown as {appearance: {representation: string}}).appearance
        .representation,
      'sdf',
    );
    const repeat = await composeTileflowIconSources(['./icons'], {cwd});
    assert.equal(repeat.package!.contentHash, result.package!.contentHash);
    for (const file of result.package!.files.filter((file) => file.fileName.endsWith('.json'))) {
      const index = JSON.parse(new TextDecoder().decode(file.source));
      assert.equal(index.health.sdf, true);
      assert.equal(index.health.tileflow.defaults.color, '#c43d35');
    }
    const changed = structuredClone(metadata);
    changed.icons.health.defaults.color = '#20a050';
    await writeFile(join(cwd, 'icons/tileflow.icons.json'), JSON.stringify(changed));
    const next = await composeTileflowIconSources(['./icons'], {cwd});
    assert.notEqual(next.package!.contentHash, result.package!.contentHash);
    assert.notDeepEqual(next.sourceIdentities, result.sourceIdentities);
    assert.deepEqual(
      next.package!.manifest.renderedIcons[0]!.pixelSha256,
      result.package!.manifest.renderedIcons[0]!.pixelSha256,
    );

    const corrupt = structuredClone(result.package!);
    const index = JSON.parse(new TextDecoder().decode(corrupt.files[0]!.source));
    index.health.tileflow.defaults.color = '#ffffff';
    corrupt.files[0]!.source = new TextEncoder().encode(JSON.stringify(index));
    corrupt.manifest.files[0].byteLength = corrupt.files[0]!.source.length;
    corrupt.manifest.files[0].sha256 = await sha256Hex(corrupt.files[0]!.source);
    corrupt.contentHash = await hashTileflowIconPackageManifest(corrupt.manifest);
    await assert.rejects(verifyTileflowIconArtifact(corrupt), {code: 'ICON_PACKAGE_INTEGRITY'});
  });
});

test('unknown metadata IDs and edge-touching silhouettes fail before generation', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/health.svg'), svg);
    await writeFile(
      join(cwd, 'icons/tileflow.icons.json'),
      JSON.stringify({schemaVersion: 1, icons: {unknown: metadata.icons.health}}),
    );
    await assert.rejects(composeTileflowIconSources(['./icons'], {cwd}), /unknown/i);
    await writeFile(join(cwd, 'icons/tileflow.icons.json'), JSON.stringify(metadata));
    await writeFile(join(cwd, 'icons/health.svg'), svg.replace('M6 6H18V18H6Z', 'M0 0H24V24H0Z'));
    await assert.rejects(composeTileflowIconSources(['./icons'], {cwd}), /padding|border/i);
  });
});

test('the fixed SDF profile retains a resolved one-pixel stroke and rejects an unresolved silhouette', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/tileflow.icons.json'), JSON.stringify(metadata));
    await writeFile(
      join(cwd, 'icons/health.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="red" d="M11 6H12V18H11Z"/></svg>',
    );
    const result = await composeTileflowIconSources(['./icons'], {cwd});
    const verified = await verifyTileflowIconArtifact(result.package!);
    for (const [cell, ratio] of [
      [verified.icons[0]!.oneX, 1],
      [verified.icons[0]!.twoX, 2],
    ] as const) {
      assert.equal(cell.width, 24 * ratio);
      assert.ok(cell.rgba[(12 * ratio * cell.width + 11 * ratio) * 4 + 3]! > 191);
    }
    await writeFile(
      join(cwd, 'icons/health.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect fill="red" x="11.4" y="6" width="0.1" height="12"/></svg>',
    );
    await assert.rejects(composeTileflowIconSources(['./icons'], {cwd}), /interior|visible/);
  });
});
