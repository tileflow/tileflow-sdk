import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readBoundedTileflowJsonResponse,
  readBoundedTileflowResponse,
} from '../src/bounded-response';
import {renderTileflowPreviewHtml} from '../src/preview-html';

test('embeds bounded tile comparison reads in preview HTML', () => {
  const preview = renderTileflowPreviewHtml(undefined, '', {generation: 1, status: 'ready'}, true);
  assert.match(preview, /readBoundedTileflowJsonResponse\(contractResponse, 64 \* 1024\)/);
  assert.match(preview, /remoteTileJsonResponse,[\s\S]*?256 \* 1024/);
  assert.match(preview, /comparisonTileMaximumBytes = 16 \* 1024 \* 1024/);
  assert.doesNotMatch(
    preview,
    /response\.arrayBuffer\(\)|contractResponse\.json\(\)|remoteTileJsonResponse\.json\(\)/,
  );
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
