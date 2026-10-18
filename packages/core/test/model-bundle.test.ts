import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashTileflowModelBundleManifest,
  serializeCanonicalJson,
  serializeTileflowModelBundleManifest,
  tileflowModelBundleFileName,
  tileflowModelBundleLimits,
  type TileflowModelBundleManifest,
  tileflowModelBundleManifestSchema,
} from '../src/index';

const annexSha = 'a'.repeat(64);
const towerSha = '0123456789abcdef'.repeat(4);
const manifest: TileflowModelBundleManifest = {
  format: 'tileflow-model-bundle-v1',
  models: [
    {
      byteLength: 1200,
      contentType: 'model/gltf-binary',
      file: `annex-${'a'.repeat(16)}.glb`,
      id: 'annex',
      sha256: annexSha,
    },
    {
      byteLength: 91548,
      contentType: 'model/gltf-binary',
      file: 'tower-0123456789abcdef.glb',
      id: 'tower',
      sha256: towerSha,
    },
  ],
};

test('a model bundle manifest is canonical JSON whose SHA-256 is its identity', async () => {
  assert.equal(tileflowModelBundleManifestSchema.safeParse(manifest).success, true);
  assert.equal(serializeTileflowModelBundleManifest(manifest), serializeCanonicalJson(manifest));
  // Locked: the API rebuilds the same identity from the bytes it receives.
  assert.equal(
    await hashTileflowModelBundleManifest(manifest),
    'a4c42872741568db83a93e426012068ce29362e47a151dd6909b2b8bd5b252de',
  );
  assert.equal(tileflowModelBundleFileName('tower', towerSha), 'tower-0123456789abcdef.glb');
  assert.equal(tileflowModelBundleLimits.maxModelCount, 64);
});

test('a model bundle manifest rejects unsorted, duplicate, misnamed or oversized models', () => {
  const [annex, tower] = manifest.models as [
    TileflowModelBundleManifest['models'][number],
    TileflowModelBundleManifest['models'][number],
  ];
  const invalid: unknown[] = [
    {...manifest, models: [tower, annex]},
    {...manifest, models: [annex, annex]},
    {...manifest, models: [annex, {...tower, file: 'tower-ffffffffffffffff.glb'}]},
    {...manifest, models: [annex, {...tower, id: 'Tower'}]},
    {...manifest, models: [annex, {...tower, contentType: 'application/octet-stream'}]},
    {...manifest, models: []},
    {...manifest, extra: true},
    {
      ...manifest,
      models: [annex, {...tower, byteLength: tileflowModelBundleLimits.maxModelFileBytes + 1}],
    },
    {
      ...manifest,
      models: [
        {...annex, byteLength: tileflowModelBundleLimits.maxModelFileBytes},
        {...tower, byteLength: tileflowModelBundleLimits.maxModelFileBytes},
        {
          byteLength: 1,
          contentType: 'model/gltf-binary',
          file: `wing-${'b'.repeat(16)}.glb`,
          id: 'wing',
          sha256: 'b'.repeat(64),
        },
      ],
    },
  ];
  for (const candidate of invalid)
    assert.equal(tileflowModelBundleManifestSchema.safeParse(candidate).success, false);
});
