import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('telemetry opt-out cannot remove the hosted commercial transform', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /createTileflowSessionController/u);
  assert.match(source, /createTileflowTransformRequest/u);
  assert.match(source, /sessionController: session/u);
  assert.doesNotMatch(source, /analytics\.enabled === false/u);
});
