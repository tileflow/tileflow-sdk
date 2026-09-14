import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  defineMap,
  hashTileflowIconComposition,
  iconSet,
  parseTileflowMap,
  type TileflowIconSetPin,
  type TileflowIconSource,
} from '@tileflow/core';
import {hashTileflowMapRevision} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {verifyTileflowIconArtifact} from '../src/icon-artifact';
import {storeTileflowIconSetArtifact} from '../src/icon-cache';
import {composeTileflowIconSources} from '../src/icon-composition';
import {compileTileflowIconPackages} from '../src/icons';
import {lockFor, renderedIcon, setFixture, withIconSetFixture} from './icon-set-fixtures';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#ff6600"/></svg>';
function mapFor(icons: readonly TileflowIconSource[]) {
  return parseTileflowMap(defineMap({id: 'main', version: 1, extends: streets, icons}));
}

test('the extracted packer preserves existing directory-only packages and source identities', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons', 'marker.svg'), svg);
    await writeFile(join(cwd, 'icons', 'hatch.pattern.svg'), svg.replaceAll('24', '8'));
    const legacy = await compileTileflowIconPackages(
      {maps: {main: mapFor(['./icons'])}},
      {cwd, target: 'hosted'},
    );
    const composed = await composeTileflowIconSources(['./icons'], {cwd, target: 'hosted'});
    assert.equal(composed.composition, null);
    assert.deepEqual(composed.package, legacy.packages[0]);
    assert.deepEqual(composed.sourceIdentities, legacy.sourceIdentities.main);
    assert.deepEqual(composed.watchPaths, legacy.watchPaths);
    const none = await composeTileflowIconSources([], {cwd});
    assert.equal(none.package, null);
    assert.deepEqual(none.sourceIdentities, []);
  });
});

test('multiple locked sets and local originals compose with exact last-wins pixels at both densities', async () => {
  await withIconSetFixture(async (cwd) => {
    const brand = await setFixture(1, [
      renderedIcon('hospital', [255, 0, 0, 255]),
      renderedIcon('shop', [0, 255, 0, 255]),
    ]);
    const transport = await setFixture(2, [
      renderedIcon('hospital', [10, 20, 30, 120], 4, 8, [80, 90, 100, 220]),
      renderedIcon('bus', [0, 0, 255, 255]),
    ]);
    for (const set of [brand, transport])
      await storeTileflowIconSetArtifact(set.pin, set.artifact, {cacheRoot: cwd});
    await mkdir(join(cwd, 'icons'));
    await writeFile(join(cwd, 'icons', 'shop.svg'), svg);
    const sources = [iconSet('@acme/brand'), iconSet('@acme/transport'), './icons'] as const;
    const result = await composeTileflowIconSources(sources, {
      cwd,
      cacheRoot: cwd,
      offline: true,
      lock: lockFor({'@acme/brand': brand.pin, '@acme/transport': transport.pin}),
    });
    assert.deepEqual(result.package!.manifest.iconNames, ['bus', 'hospital', 'shop']);
    assert.deepEqual(result.replacements, [
      {id: 'hospital', replaced: 0, winner: 1},
      {id: 'shop', replaced: 0, winner: 2},
    ]);
    assert.deepEqual(
      result.composition!.winners.map((winner) => [winner.id, winner.contributor]),
      [
        ['bus', 1],
        ['hospital', 1],
        ['shop', 2],
      ],
    );
    const expected = (await verifyTileflowIconArtifact(transport.artifact)).icons;
    const output = (await verifyTileflowIconArtifact(result.package!)).icons;
    for (const id of ['bus', 'hospital'])
      assert.deepEqual(
        output.find((icon) => icon.id === id),
        expected.find((icon) => icon.id === id),
      );
    assert.equal(
      result.sourceIdentities.find((source) => source.id === 'hospital')!.kind,
      'rendered-icon',
    );
    assert.equal(result.sourceIdentities.find((source) => source.id === 'shop')!.kind, 'icon');
    assert.equal(JSON.stringify(result.composition).includes(cwd), false);
    assert.equal(JSON.stringify(result.composition).includes('sourceSha256'), false);
  });
});

test('a sole shared set reuses exactly its published artifact without repacking', async () => {
  await withIconSetFixture(async (cwd) => {
    const set = await setFixture(1, [
      renderedIcon('marker', [10, 20, 30, 128], 4, 2, [40, 50, 60, 220]),
    ]);
    await storeTileflowIconSetArtifact(set.pin, set.artifact, {cacheRoot: cwd});
    const result = await composeTileflowIconSources([iconSet('@acme/brand')], {
      cwd,
      cacheRoot: cwd,
      offline: true,
      lock: lockFor({'@acme/brand': set.pin}),
    });
    assert.equal(result.package!.contentHash, set.artifact.contentHash);
    for (const [index, file] of result.package!.files.entries())
      assert.deepEqual(
        new Uint8Array(file.source),
        new Uint8Array(set.artifact.files[index]!.source),
      );
    assert.ok(
      result.sourceIdentities.every(
        (identity) =>
          identity.kind === 'rendered-icon' &&
          !Object.hasOwn(identity, 'sha256') &&
          !Object.hasOwn(identity, 'format'),
      ),
    );
  });
});

test('equal pixels, fully shadowed pins and dependency order remain independent from artifact content', async () => {
  await withIconSetFixture(async (cwd) => {
    const a = await setFixture(1, [renderedIcon('marker', [10, 20, 30, 255])]);
    const b = await setFixture(2, [renderedIcon('marker', [10, 20, 30, 255])]);
    await storeTileflowIconSetArtifact(a.pin, a.artifact, {cacheRoot: cwd});
    const sources = [iconSet('@acme/brand'), iconSet('@acme/transport')];
    const lock = lockFor({'@acme/brand': a.pin, '@acme/transport': b.pin});
    const options = {cwd, cacheRoot: cwd, offline: true, lock};
    const initial = await composeTileflowIconSources(sources, options);
    const updatedLock = structuredClone(lock);
    updatedLock.sets['@acme/brand']!.version = 2;
    updatedLock.sets['@acme/brand']!.versionId = `icv_${'updated'.padStart(16, '0')}`;
    const updated = await composeTileflowIconSources(sources, {...options, lock: updatedLock});
    const reordered = await composeTileflowIconSources([...sources].reverse(), options);
    assert.equal(updated.package!.contentHash, initial.package!.contentHash);
    assert.equal(reordered.package!.contentHash, initial.package!.contentHash);
    assert.notEqual(
      await hashTileflowIconComposition(updated.composition!),
      await hashTileflowIconComposition(initial.composition!),
    );
    assert.notEqual(
      await hashTileflowIconComposition(reordered.composition!),
      await hashTileflowIconComposition(initial.composition!),
    );
    const map = mapFor(sources);
    const revision = (result: typeof initial) =>
      hashTileflowMapRevision(map, {
        fonts: [],
        icons: result.sourceIdentities,
        iconComposition: result.composition!,
      });
    assert.notEqual(await revision(updated), await revision(initial));
    assert.deepEqual(updatedLock.sets['@acme/transport'], lock.sets['@acme/transport']);
  });
});

test('source-only SVG edits do not become shared-set content or provenance changes', async () => {
  await withIconSetFixture(async (cwd) => {
    await mkdir(join(cwd, 'icons'));
    const path = join(cwd, 'icons', 'marker.svg');
    await writeFile(path, svg);
    const before = await composeTileflowIconSources(['./icons'], {cwd});
    await writeFile(path, svg.replace('</svg>', '<!-- source-only edit --></svg>'));
    const after = await composeTileflowIconSources(['./icons'], {cwd});
    assert.equal(before.package!.contentHash, after.package!.contentHash);
    assert.notDeepEqual(before.sourceIdentities, after.sourceIdentities);
    const delivered = await setFixture(
      1,
      (await verifyTileflowIconArtifact(before.package!)).icons,
    );
    await storeTileflowIconSetArtifact(delivered.pin, before.package!, {cacheRoot: cwd});
    const sources = [iconSet('@acme/brand')];
    const options = {
      cwd,
      cacheRoot: cwd,
      offline: true,
      lock: lockFor({'@acme/brand': delivered.pin}),
    };
    const first = await composeTileflowIconSources(sources, options);
    await storeTileflowIconSetArtifact(delivered.pin, after.package!, {cacheRoot: cwd});
    const second = await composeTileflowIconSources(sources, options);
    assert.deepEqual(second, first);
  });
});

test('32 independently pinned contributors are retained even when 31 are entirely shadowed', async () => {
  await withIconSetFixture(async (cwd) => {
    const set = await setFixture(0, [renderedIcon('marker', [10, 20, 30, 255])]);
    await storeTileflowIconSetArtifact(set.pin, set.artifact, {cacheRoot: cwd});
    const sets: Record<string, TileflowIconSetPin> = {};
    const sources = Array.from({length: 32}, (_, index) => {
      const reference = `@acme/set-${index}` as const;
      sets[reference] = {
        ...set.pin,
        setId: `ics_${String(index).padStart(16, '0')}`,
        versionId: `icv_${String(index).padStart(16, '0')}`,
      };
      return iconSet(reference);
    });
    const result = await composeTileflowIconSources(sources, {
      cwd,
      cacheRoot: cwd,
      offline: true,
      lock: lockFor(sets),
    });
    assert.equal(result.composition!.contributors.length, 32);
    assert.equal(result.composition!.winners[0]!.contributor, 31);
    assert.equal(result.replacements.length, 31);
    await assert.rejects(composeTileflowIconSources([...sources, './icons'], {cwd}), {
      code: 'ICON_SET_INVALID',
    });
  });
});

test('aggregate winner limits are enforced instead of clipping otherwise valid input sets', async () => {
  await withIconSetFixture(async (cwd) => {
    const a = await setFixture(
      1,
      Array.from({length: 256}, (_, index) => renderedIcon(`icon-${index}`, [1, 2, 3, 255], 1, 1)),
    );
    const b = await setFixture(2, [renderedIcon('extra', [1, 2, 3, 255], 1, 1)]);
    for (const set of [a, b])
      await storeTileflowIconSetArtifact(set.pin, set.artifact, {cacheRoot: cwd});
    await assert.rejects(
      composeTileflowIconSources([iconSet('@acme/brand'), iconSet('@acme/transport')], {
        cwd,
        cacheRoot: cwd,
        offline: true,
        lock: lockFor({'@acme/brand': a.pin, '@acme/transport': b.pin}),
      }),
      {code: 'ICON_COMPOSITION_INVALID'},
    );
  });
});
