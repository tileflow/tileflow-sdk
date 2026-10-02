import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  diffTileflowIconPackageManifests,
  hashTileflowIconPackageManifest,
  iconSet,
  sha256Hex,
} from '@tileflow/core';
import {storeTileflowIconSetArtifact} from '../src/icon-cache';
import {composeTileflowIconSources, verifyTileflowIconArtifact} from '../src/icons';
import {lockFor, renderedIcon, setFixture, withIconSetFixture} from './icon-set-fixtures';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="6" y="6" width="12" height="12" rx="2" fill="#245fe5"/></svg>';
const layout = {stretchX: [[9, 15]], stretchY: [[9, 15]], content: [7, 7, 17, 17]};

test('author layout reaches both native densities and changes identity without changing pixels', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/shield.svg'), svg);
    const metadata = {schemaVersion: 1, icons: {shield: {representation: 'rgba', layout}}};
    const sidecar = join(cwd, 'icons/tileflow.icons.json');
    await writeFile(sidecar, JSON.stringify(metadata));
    const first = await composeTileflowIconSources(['./icons'], {cwd});
    assert.equal(first.package!.manifest.format, 'tileflow-icon-package-v2');
    const verified = await verifyTileflowIconArtifact(first.package!);
    assert.deepEqual(verified.icons[0]!.layout, layout);
    const one = JSON.parse(new TextDecoder().decode(first.package!.files[0]!.source)).shield;
    const two = JSON.parse(new TextDecoder().decode(first.package!.files[2]!.source)).shield;
    assert.deepEqual(one.content, [7, 7, 17, 17]);
    assert.deepEqual(two.content, [14, 14, 34, 34]);
    assert.deepEqual(two.stretchX, [[18, 30]]);

    const changed = structuredClone(metadata);
    changed.icons.shield.layout.content = [8, 8, 16, 16];
    await writeFile(sidecar, JSON.stringify(changed));
    const next = await composeTileflowIconSources(['./icons'], {cwd});
    assert.notEqual(next.package!.contentHash, first.package!.contentHash);
    assert.notDeepEqual(next.sourceIdentities, first.sourceIdentities);
    assert.deepEqual(
      next.package!.manifest.renderedIcons[0]!.pixelSha256,
      first.package!.manifest.renderedIcons[0]!.pixelSha256,
    );
    assert.deepEqual(
      diffTileflowIconPackageManifests(first.package!.manifest, next.package!.manifest).modified,
      ['shield'],
    );

    const tampered = structuredClone(first.package!);
    const index = JSON.parse(new TextDecoder().decode(tampered.files[2]!.source));
    index.shield.content = [16, 16, 32, 32];
    tampered.files[2]!.source = new TextEncoder().encode(JSON.stringify(index));
    tampered.manifest.files[2].byteLength = tampered.files[2]!.source.length;
    tampered.manifest.files[2].sha256 = await sha256Hex(tampered.files[2]!.source);
    tampered.contentHash = await hashTileflowIconPackageManifest(tampered.manifest);
    await assert.rejects(verifyTileflowIconArtifact(tampered), {code: 'ICON_PACKAGE_INTEGRITY'});

    await writeFile(
      sidecar,
      JSON.stringify({
        schemaVersion: 1,
        icons: {shield: {representation: 'sdf', defaults: {color: '#245fe5'}, layout}},
      }),
    );
    const sdf = await composeTileflowIconSources(['./icons'], {cwd});
    assert.deepEqual((await verifyTileflowIconArtifact(sdf.package!)).icons[0]!.layout, layout);
    assert.equal(sdf.package!.manifest.renderedIcons[0]!.appearance?.representation, 'sdf');
  });
});

test('exact cached revisions preserve layout while local replacements own the effective geometry', async () => {
  await withIconSetFixture(async (cwd) => {
    const shared = await setFixture(1, [
      {...renderedIcon('shield', [10, 30, 50, 255], 24, 24), layout},
    ]);
    await storeTileflowIconSetArtifact(shared.pin, shared.artifact, {cacheRoot: cwd});
    const options = {
      cwd,
      cacheRoot: cwd,
      offline: true,
      lock: lockFor({'@acme/signs': shared.pin}),
    };
    const exact = await composeTileflowIconSources([iconSet('@acme/signs')], options);
    assert.deepEqual(exact.composition!.winners[0]!.layout, layout);
    assert.equal(exact.composition!.compositionVersion, 2);
    assert.deepEqual(exact.sourceIdentities[0], {
      kind: 'rendered-icon',
      id: 'shield',
      width: 24,
      height: 24,
      layout,
      pixelSha256: shared.artifact.manifest.renderedIcons[0]!.pixelSha256,
    });
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/shield.svg'), svg);
    const replaced = await composeTileflowIconSources([iconSet('@acme/signs'), './icons'], options);
    assert.equal(replaced.composition!.winners[0]!.layout, undefined);
    assert.equal(replaced.composition!.compositionVersion, 1);
  });
});

test('authoring diagnostics identify the icon with invalid layout or an insufficient SDF border', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons/shield.svg'), svg);
    const sidecar = join(cwd, 'icons/tileflow.icons.json');
    await writeFile(
      sidecar,
      JSON.stringify({
        schemaVersion: 1,
        icons: {shield: {representation: 'rgba', layout: {content: [7, 7, 25, 17]}}},
      }),
    );
    await assert.rejects(
      composeTileflowIconSources(['./icons'], {cwd}),
      /shield\.svg:.*layout.*cell/i,
    );
    await writeFile(join(cwd, 'icons/shield.svg'), svg.replace('x="6"', 'x="0"'));
    await writeFile(
      sidecar,
      JSON.stringify({
        schemaVersion: 1,
        icons: {shield: {representation: 'sdf', defaults: {color: '#245fe5'}}},
      }),
    );
    await assert.rejects(
      composeTileflowIconSources(['./icons'], {cwd}),
      /shield\.svg:.*six transparent/i,
    );
  });
});
