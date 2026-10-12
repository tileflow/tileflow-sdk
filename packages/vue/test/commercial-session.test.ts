import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('telemetry opt-out cannot remove the hosted commercial transform', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /createTileflowSessionController/u);
  assert.match(source, /createTileflowTransformRequest/u);
  assert.match(source, /registerTileflowWorldRequestBridge/u);
  assert.match(source, /attachTileflowFairUseNotice/u);
  assert.match(source, /sessionController: session/u);
  assert.doesNotMatch(source, /analytics\.enabled === false/u);
});

test('analytics changes apply to later requests without recreating the map', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const recreation = /watch\(\s*\(\) => \[([^\]]*)\],\s*\(\) => void recreateMap\(\)/u.exec(source);

  assert.ok(recreation, 'map recreation watcher not found');
  assert.doesNotMatch(recreation[1]!, /analytics/u);
  assert.match(source, /getAnalytics: \(\) => resolvedAnalytics\.value/u);
});
