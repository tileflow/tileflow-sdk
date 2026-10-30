import assert from 'node:assert/strict';
import test from 'node:test';
import {contentSchema} from '../src/content-contract';

const overlay = {
  id: 'selection',
  kind: 'circle',
  data: {id: 'AAAAAAAAAAAAAAAAAAAAAA', byteLength: 120, sha256: 'a'.repeat(64)},
};

test('application content refers to data and rejects duplicate or unbounded content', () => {
  assert.equal(contentSchema.safeParse({annotations: [], overlays: [overlay]}).success, true);
  for (const overlays of [
    [overlay, overlay],
    [{...overlay, id: '../style'}],
    [{...overlay, size: 65}],
    [{...overlay, color: 'url(https://example.org/tracker)'}],
    Array.from({length: 17}, (_, index) => ({...overlay, id: `layer-${index}`})),
    // Data never travels inline in a message.
    [{...overlay, data: {type: 'FeatureCollection', features: []}}],
    [{...overlay, data: {...overlay.data, id: 'short'}}],
    [{...overlay, data: {...overlay.data, byteLength: 0}}],
    [{...overlay, data: {...overlay.data, byteLength: 33_554_433}}],
    [{...overlay, data: {...overlay.data, sha256: 'A'.repeat(64)}}],
  ])
    assert.equal(
      contentSchema.safeParse({annotations: [], overlays}).success,
      false,
      JSON.stringify(overlays).slice(0, 120),
    );
});
