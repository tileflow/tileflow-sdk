import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashTileflowFontBundleManifest,
  serializeCanonicalJson,
  serializeTileflowFontBundleManifest,
  tileflowFontBundleLimits,
  type TileflowFontBundleManifest,
  tileflowFontBundleManifestSchema,
} from '../src/index';

const fontSha = '1'.repeat(64);
const licenseSha = '2'.repeat(64);
const manifest: TileflowFontBundleManifest = {
  files: [
    {
      byteLength: 100,
      contentType: 'font/ttf',
      kind: 'font',
      name: `fonts/example-medium-${fontSha}.ttf`,
      sha256: fontSha,
    },
    {
      byteLength: 200,
      contentType: 'text/plain; charset=utf-8',
      kind: 'license',
      name: `fonts/licenses/license-${licenseSha}.txt`,
      sha256: licenseSha,
    },
  ],
  fontFaces: [
    {
      family: 'Example Medium',
      file: `fonts/example-medium-${fontSha}.ttf`,
      licenseFile: `fonts/licenses/license-${licenseSha}.txt`,
      style: 'normal',
      weight: '500',
    },
  ],
  format: 'tileflow-font-bundle-v1',
};

test('font bundle manifest is one bounded canonical closure of faces, bytes, and licenses', async () => {
  assert.equal(tileflowFontBundleManifestSchema.safeParse(manifest).success, true);
  assert.equal(serializeTileflowFontBundleManifest(manifest), serializeCanonicalJson(manifest));
  assert.equal(
    await hashTileflowFontBundleManifest(manifest),
    'fc6bef3f28e5fa3cfe97d667319158310aefa078979a1e5e7d37c5c48b23be3e',
  );
  assert.equal(tileflowFontBundleLimits.maxFaceCount, 16);
  assert.equal(tileflowFontBundleLimits.maxFontFileBytes, 1024 * 1024);
});

test('font bundle manifest rejects claims without exact content-addressed license closure', () => {
  const invalid = [
    {...manifest, files: [...manifest.files].reverse()},
    {
      ...manifest,
      fontFaces: [
        {...manifest.fontFaces[0]!, licenseFile: `fonts/licenses/license-${'3'.repeat(64)}.txt`},
      ],
    },
    {...manifest, files: [...manifest.files, {...manifest.files[1]!, sha256: '3'.repeat(64)}]},
    {
      ...manifest,
      files: [{...manifest.files[0]!, contentType: 'font/woff2'}, manifest.files[1]],
    },
  ];
  for (const candidate of invalid) {
    assert.equal(tileflowFontBundleManifestSchema.safeParse(candidate).success, false);
  }
});
