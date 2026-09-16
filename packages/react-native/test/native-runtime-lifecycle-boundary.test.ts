import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = () => readFile(new URL('../src/native-runtime.ts', import.meta.url), 'utf8');

test('the process installation relays native lifecycle only to live mounted owners', async () => {
	const value = await source();
	assert.match(value, /subscribeLifecycle/u);
	assert.match(value, /liveOwners/u);
	assert.match(value, /owner\.nativeLifecycle\(foreground\)/u);
	assert.match(value, /liveOwners\.delete\(owner\)/u);
	assert.doesNotMatch(value, /export\s+\{[^}]*nativeLifecycle|export\s+(?:const|function)\s+nativeLifecycle/u);
});
