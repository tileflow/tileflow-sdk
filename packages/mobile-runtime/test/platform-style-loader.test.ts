import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadTileflowRuntimeStyle,
  loadTileflowRuntimeStyleFamily,
} from '../src/platform-style-loader';

test('an omitted native style loader cannot fall back to browser network access', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(loadTileflowRuntimeStyle({style: 'https://maps.example/styles/day.json'}), {
    code: 'resourceFailed',
    message: 'Theme resources require the native transport.',
  });
  await assert.rejects(loadTileflowRuntimeStyleFamily(), {
    code: 'resourceFailed',
    message: 'Theme resources require the native transport.',
  });
  assert.equal(fetch.mock.callCount(), 0);
});
