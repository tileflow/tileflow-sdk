import assert from 'node:assert/strict';
import test from 'node:test';
import {hashTileflowIconPackageManifest, sha256Hex} from '@tileflow/core';
import {verifyTileflowIconArtifact} from '../src/icon-artifact';
import {
  createSpriteLayout,
  packTileflowRenderedIcons,
  type TileflowSpriteIndex,
} from '../src/icon-sprite';
import type {CompiledTileflowIconPackage} from '../src/icons';
import {renderedIcon, setFixture} from './icon-set-fixtures';

async function rewriteIndex(
  artifact: CompiledTileflowIconPackage,
  transform: (index: Record<string, Record<string, number>>) => void,
): Promise<CompiledTileflowIconPackage> {
  const result = structuredClone(artifact);
  const index = JSON.parse(new TextDecoder().decode(result.files[0]!.source)) as Record<
    string,
    Record<string, number>
  >;
  transform(index);
  result.files[0]!.source = new TextEncoder().encode(JSON.stringify(index));
  result.manifest.files[0].byteLength = result.files[0]!.source.length;
  result.manifest.files[0].sha256 = await sha256Hex(result.files[0]!.source);
  result.contentHash = await hashTileflowIconPackageManifest(result.manifest);
  return result;
}

test('verification preserves exact independent density cells, alpha and non-square geometry', async () => {
  const icons = [
    renderedIcon('hospital', [220, 10, 30, 127], 4, 8, [0, 90, 255, 210]),
    renderedIcon('bus', [100, 80, 60, 0]),
  ];
  const artifact = await packTileflowRenderedIcons(icons);
  const decoded = await verifyTileflowIconArtifact(artifact);
  for (const original of icons)
    assert.deepEqual(
      decoded.icons.find((icon) => icon.id === original.id),
      original,
    );
  const repacked = await packTileflowRenderedIcons(decoded.icons);
  assert.equal(repacked.contentHash, artifact.contentHash);
  assert.deepEqual(repacked.manifest, artifact.manifest);
  for (const [index, file] of repacked.files.entries())
    assert.deepEqual(new Uint8Array(file.source), new Uint8Array(artifact.files[index]!.source));
});

test('verification rejects byte corruption and forged rendered hashes independently', async () => {
  const {artifact} = await setFixture(1, [renderedIcon('marker', [30, 40, 50, 255])]);
  const badBytes = structuredClone(artifact);
  badBytes.files[1]!.source[0] = 0;
  await assert.rejects(verifyTileflowIconArtifact(badBytes), {code: 'ICON_PACKAGE_INTEGRITY'});
  const badPixels = structuredClone(artifact);
  badPixels.manifest.renderedIcons[0]!.pixelSha256.twoX = 'f'.repeat(64);
  badPixels.contentHash = await hashTileflowIconPackageManifest(badPixels.manifest);
  await assert.rejects(verifyTileflowIconArtifact(badPixels), {code: 'ICON_PACKAGE_INTEGRITY'});
});

test('mixed-size atlases preserve paired geometry and independently rendered pixels', async () => {
  const icons = [
    renderedIcon('large', [10, 20, 30, 127], 128, 128, [40, 50, 60, 210]),
    ...Array.from({length: 128}, (_, index) =>
      renderedIcon(`small-${index}`, [index, 10, 20, 255], 32, 32, [20, index, 10, 127]),
    ),
  ];

  const artifact = await packTileflowRenderedIcons(icons);
  const {oneX, twoX} = artifact.manifest.sprites;
  assert.equal(twoX.width, oneX.width * 2);
  assert.equal(twoX.height, oneX.height * 2);
  assert.ok(twoX.width <= 2048 && twoX.height <= 2048);

  const readIndex = (name: string): TileflowSpriteIndex =>
    JSON.parse(
      new TextDecoder().decode(artifact.files.find((file) => file.fileName === name)!.source),
    );
  const indexOneX = readIndex('sprite.json');
  const indexTwoX = readIndex('sprite@2x.json');
  for (const [name, cell] of Object.entries(indexOneX)) {
    assert.deepEqual(indexTwoX[name], {
      height: cell.height * 2,
      width: cell.width * 2,
      x: cell.x * 2,
      y: cell.y * 2,
      pixelRatio: 2,
    });
  }

  const decoded = await verifyTileflowIconArtifact(artifact);
  for (const original of icons) {
    assert.deepEqual(
      decoded.icons.find((icon) => icon.id === original.id),
      original,
    );
  }

  const reordered = await packTileflowRenderedIcons([...icons].reverse());
  assert.deepEqual(reordered, artifact);
});

test('paired layouts accept the density boundary and reject overflow on either axis', () => {
  for (const ratio of [1, 2] as const) {
    const limit = 1024 * ratio;
    for (const [width, height] of [
      [limit, 1],
      [1, limit],
    ] as const) {
      const layout = createSpriteLayout([{name: 'boundary', width, height}], ratio);
      assert.equal(layout.width, width);
      assert.equal(layout.height, height);
    }

    for (const [width, height] of [
      [limit + 1, 1],
      [1, limit + 1],
    ] as const) {
      assert.throws(() => createSpriteLayout([{name: 'overflow', width, height}], ratio));
    }

    assert.throws(() =>
      createSpriteLayout(
        Array.from({length: 257}, (_, index) => ({
          name: `icon-${index}`,
          width: 64 * ratio,
          height: 64 * ratio,
        })),
        ratio,
      ),
    );
  }
});

test('verification rejects malformed, overlapping, mismatched and extra index metadata', async () => {
  const {artifact} = await setFixture(1, [
    renderedIcon('a', [1, 2, 3, 255]),
    renderedIcon('b', [4, 5, 6, 255]),
  ]);
  for (const transform of [
    (index: Record<string, Record<string, number>>) => {
      index.a!.x = 2048;
    },
    (index: Record<string, Record<string, number>>) => {
      index.b!.x = index.a!.x!;
    },
    (index: Record<string, Record<string, number>>) => {
      index.a!.pixelRatio = 2;
    },
    (index: Record<string, Record<string, number>>) => {
      index.a!.sdf = 1;
    },
    (index: Record<string, Record<string, number>>) => {
      delete index.b;
    },
  ])
    await assert.rejects(verifyTileflowIconArtifact(await rewriteIndex(artifact, transform)), {
      code: 'ICON_PACKAGE_INTEGRITY',
    });
});

test('strict index JSON is checked even when its compressed file checksum is correct', async () => {
  const {artifact} = await setFixture(1, [renderedIcon('a', [1, 2, 3, 255])]);
  const modified = structuredClone(artifact);
  const original = new TextDecoder().decode(modified.files[0]!.source).trim();
  const duplicate = `{${original.slice(1, -1)},${original.slice(1, -1)}}`;
  modified.files[0]!.source = new TextEncoder().encode(duplicate);
  modified.manifest.files[0].byteLength = modified.files[0]!.source.length;
  modified.manifest.files[0].sha256 = await sha256Hex(modified.files[0]!.source);
  modified.contentHash = await hashTileflowIconPackageManifest(modified.manifest);
  await assert.rejects(verifyTileflowIconArtifact(modified), {code: 'ICON_PACKAGE_INTEGRITY'});
});

test('packing enforces final count, density, ID and dimension limits', async () => {
  const icons = Array.from({length: 1_000}, (_, index) =>
    renderedIcon(`icon-${String(index).padStart(4, '0')}`, [1, 2, 3, 255], 1, 1),
  );
  assert.equal((await packTileflowRenderedIcons(icons)).manifest.iconNames.length, 1_000);
  await assert.rejects(
    packTileflowRenderedIcons([...icons, renderedIcon('extra', [1, 2, 3, 255])]),
  );
  await assert.rejects(packTileflowRenderedIcons([icons[0]!, icons[0]!]));
  const wrongDensity = renderedIcon('marker', [1, 2, 3, 255]);
  wrongDensity.twoX.width += 1;
  await assert.rejects(packTileflowRenderedIcons([wrongDensity]));
  assert.throws(() => createSpriteLayout([{name: 'marker', width: 2049, height: 1}], 1));
});
