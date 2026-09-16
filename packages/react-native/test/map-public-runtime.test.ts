import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {inspectPublicMapRuntime} from './map-runtime-fixture';

test('the built root exports only a callable Map without native activation', async () => {
	assert.deepEqual(await inspectPublicMapRuntime(), {exports: ['Map'], callable: 'function'});
});

test('the component owns commit delivery, safe ref and a mount-stable pinned upstream camera seed', async () => {
	const source = await readFile(new URL('../src/map.tsx', import.meta.url), 'utf8');
	assert.match(source, /useLayoutEffect/u);
	assert.match(source, /useSyncExternalStore/u);
	assert.match(source, /useImperativeHandle/u);
	assert.match(source, /getSourceState/u);
	assert.match(source, /NativeCamera/u);
	assert.match(source, /type CameraProps as NativeCameraProps/u);
	assert.match(source, /useState<NonNullable<NativeCameraProps\['initialViewState'\]>>/u);
	assert.match(source, /Object\.freeze\(center\)/u);
	assert.match(source, /initialViewState=\{initialViewState\}/u);
	assert.match(source, /onDidFinishLoadingStyle/u);
	assert.match(source, /collapsable=\{false\}/u);
	assert.doesNotMatch(source, /initialViewState=\{scene\.initialView\}/u);
	assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval|\.acquire\(|completeBatch|fetchForContext|NativeModules/u);
	assert.doesNotMatch(source, /<NativeMap[^>]*\{\.\.\.props\}/u);
});
