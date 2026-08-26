import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTileflowLandmarkManifest,
  readBoundedTileflowJsonResponse,
  readBoundedTileflowResponse,
} from '../src/landmarks';
import {renderTileflowPreviewHtml} from '../src/preview-html';

test('normalizes the bounded v2 landmark archive contract', () => {
  const manifest = normalizeTileflowLandmarkManifest(
    validManifest(),
    'https://assets.example.test/manifests/madrid.json',
  );

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.maximumCachedModels, 16);
  assert.equal(manifest.archives[0]?.url, 'https://assets.example.test/models.pmtiles');
  assert.equal(manifest.landmarks[0]?.models[0]?.archive, manifest.archives[0]);
});

test('rejects unsafe archives, duplicate LOD thresholds and unbounded collections', () => {
  const unsafe = validManifest();
  unsafe.archives[0]!.url = 'https://user:secret@assets.example.test/models.pmtiles';
  assert.throws(
    () => normalizeTileflowLandmarkManifest(unsafe, 'https://assets.example.test/manifest.json'),
    /invalid landmark archive URL/,
  );

  const duplicate = validManifest();
  duplicate.landmarks[0]!.models.push({...duplicate.landmarks[0]!.models[0]!});
  assert.throws(
    () => normalizeTileflowLandmarkManifest(duplicate, 'https://assets.example.test/manifest.json'),
    /duplicate landmark LOD zoom/,
  );

  const tooMany = validManifest();
  tooMany.archives = Array.from({length: 65}, () => tooMany.archives[0]!);
  assert.throws(
    () => normalizeTileflowLandmarkManifest(tooMany, 'https://assets.example.test/manifest.json'),
    /invalid landmark manifest/,
  );
});

test('embeds the shared parser and bounded cancellable fetch in preview HTML', () => {
  const preview = renderTileflowPreviewHtml(undefined, '', {generation: 1, status: 'ready'}, true);
  assert.match(preview, /normalizeTileflowLandmarkManifest/);
  assert.match(preview, /landmarkManifestMaximumBytes = 1024 \* 1024/);
  assert.match(preview, /landmarkManifestTimeoutMs = 10000/);
  assert.match(preview, /readBoundedTileflowJsonResponse\(contractResponse, 64 \* 1024\)/);
  assert.match(preview, /remoteTileJsonResponse,[\s\S]*?256 \* 1024/);
  assert.match(preview, /comparisonTileMaximumBytes = 16 \* 1024 \* 1024/);
  assert.doesNotMatch(
    preview,
    /response\.arrayBuffer\(\)|contractResponse\.json\(\)|remoteTileJsonResponse\.json\(\)/,
  );
  assert.match(preview, /abortController\.signal/);
});

test('strictly decodes bounded JSON without accepting invalid UTF-8', async () => {
  const valid = await readBoundedTileflowJsonResponse(
    new Response(new TextEncoder().encode('{"ok":true}')),
    64,
  );
  assert.deepEqual(valid, {ok: true});

  await assert.rejects(
    () => readBoundedTileflowJsonResponse(new Response(Uint8Array.of(0xc3, 0x28)), 64),
    /encoded data was not valid|not valid for encoding/iu,
  );
});

test('cancels a streaming response before buffering beyond the byte limit', async () => {
  let pulls = 0;
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(600_000));
      },
    }),
  );

  await assert.rejects(() => readBoundedTileflowResponse(response, 1_048_576), /byte limit/);
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

function validManifest() {
  return {
    archives: [
      {
        bytes: 1_000_000,
        id: 'madrid-v1',
        sha256: 'a'.repeat(64),
        url: '../models.pmtiles',
      },
    ],
    id: 'madrid-2026',
    landmarks: [
      {
        bounds: [-3.7, 40.4, -3.6, 40.5] as [number, number, number, number],
        center: [-3.65, 40.45] as [number, number],
        id: 'cibeles',
        models: [
          {
            archiveId: 'madrid-v1',
            axisConvention: 'EUN_Y_UP',
            bytes: 10_000,
            minzoom: 16,
            sha256: 'b'.repeat(64),
            x: 0,
            y: 0,
            z: 0,
          },
        ],
        priority: 100,
      },
    ],
    maximumCachedModels: 16,
    maximumVisibleModels: 8,
    minzoom: 16,
    schemaVersion: 2,
  };
}
