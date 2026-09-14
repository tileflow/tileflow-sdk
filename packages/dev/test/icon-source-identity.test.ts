import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {defineMap, parseTileflowMap, sha256Hex} from '@tileflow/core';
import {hashTileflowAssetSet, hashTileflowMapRevision} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {compileTileflowIconPackages} from '../src/icons';

const originalSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
  '<rect width="24" height="24" fill="#2563eb"/></svg>';
const metadataOnlySvg = originalSvg.replace('<rect', '<!-- Artwork revision B. --><rect');
const changedPixelsSvg = originalSvg.replace('#2563eb', '#dc2626');

async function withIconFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-source-identity-'));
  try {
    await mkdir(join(cwd, 'icons'));
    await run(cwd);
  } finally {
    await rm(cwd, {recursive: true, force: true});
  }
}

async function compileIdentity(cwd: string, svg: string) {
  await writeFile(join(cwd, 'icons', 'marker.svg'), svg);
  const map = parseTileflowMap(
    defineMap({id: 'main', version: 1, extends: streets, icons: ['./icons']}),
  );
  const compiled = await compileTileflowIconPackages({maps: {main: map}}, {cwd, target: 'hosted'});
  assert.equal(compiled.packages.length, 1);
  const iconPackage = compiled.packages[0]!;
  const sourceIdentities = compiled.sourceIdentities.main;
  assert.ok(sourceIdentities);
  assert.deepEqual(sourceIdentities, [
    {format: 'svg', id: 'marker', kind: 'icon', sha256: await sha256Hex(svg)},
  ]);

  return {
    iconPackage,
    sourceIdentities,
    mapRevisionSha256: await hashTileflowMapRevision(map, {
      fonts: [],
      icons: sourceIdentities,
    }),
    assetSetSha256: await hashTileflowAssetSet(iconPackage.files),
  };
}

test('source-only SVG edits change map revision but not delivered icon package v1', async (t) => {
  await withIconFixture(async (cwd) => {
    const original = await compileIdentity(cwd, originalSvg);
    const edited = await compileIdentity(cwd, metadataOnlySvg);
    const repeated = await compileIdentity(cwd, metadataOnlySvg);

    // The generated-only artifact cannot distinguish these two original source identities.
    assert.deepEqual(original.iconPackage.files, edited.iconPackage.files);
    assert.deepEqual(original.iconPackage.manifest, edited.iconPackage.manifest);
    assert.equal(original.iconPackage.manifest.format, 'tileflow-icon-package-v1');
    assert.equal(original.iconPackage.contentHash, edited.iconPackage.contentHash);
    assert.equal(original.assetSetSha256, edited.assetSetSha256);
    assert.notDeepEqual(original.sourceIdentities, edited.sourceIdentities);
    assert.notEqual(original.mapRevisionSha256, edited.mapRevisionSha256);
    assert.deepEqual(edited, repeated);

    t.diagnostic(
      JSON.stringify({
        generatedPackageSha256: original.iconPackage.contentHash,
        originalMapRevisionSha256: original.mapRevisionSha256,
        metadataEditedMapRevisionSha256: edited.mapRevisionSha256,
      }),
    );
  });
});

test('a visible SVG edit changes both original source and generated icon identities', async () => {
  await withIconFixture(async (cwd) => {
    const original = await compileIdentity(cwd, originalSvg);
    const edited = await compileIdentity(cwd, changedPixelsSvg);

    assert.notEqual(original.mapRevisionSha256, edited.mapRevisionSha256);
    assert.notEqual(original.assetSetSha256, edited.assetSetSha256);
    assert.notEqual(original.iconPackage.contentHash, edited.iconPackage.contentHash);
    const originalPixels = original.iconPackage.manifest.renderedIcons[0]!.pixelSha256;
    const editedPixels = edited.iconPackage.manifest.renderedIcons[0]!.pixelSha256;
    assert.notEqual(originalPixels.oneX, editedPixels.oneX);
    assert.notEqual(originalPixels.twoX, editedPixels.twoX);
  });
});
