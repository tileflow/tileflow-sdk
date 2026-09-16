import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {inspectPublicMapRuntime} from './map-runtime-fixture';

test('the built root exports only a callable Map without native activation', async () => {
  assert.deepEqual(await inspectPublicMapRuntime(), {exports: ['Map'], callable: 'function'});
});

test('the component owns commit delivery, the safe ref and the upstream camera without forwarding raw lifecycle props', async () => {
  const source = await readFile(new URL('../src/map.tsx', import.meta.url), 'utf8');
  assert.match(source, /useLayoutEffect/u);
  assert.match(source, /useSyncExternalStore/u);
  assert.match(source, /useImperativeHandle/u);
  assert.match(source, /getSourceState/u);
  assert.match(source, /NativeCamera/u);
  assert.match(source, /onDidFinishLoadingStyle/u);
  assert.match(source, /collapsable=\{false\}/u);
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|\.acquire\(|completeBatch|fetchForContext|NativeModules/u);
  assert.doesNotMatch(source, /<NativeMap[^>]*\{\.\.\.props\}/u);
});
