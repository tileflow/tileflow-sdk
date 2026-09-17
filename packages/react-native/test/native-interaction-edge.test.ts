import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareNativeInteractionInputs} from '../src/native-interaction-input';
import {createNativePoiAdapter} from '../src/native-interaction-poi';
import {barrier, poiBinding, queryFixture, touch} from './native-interaction-fixture';

test('invalid initial controlled state preserves declared ownership without evaluating its accessor', () => {
	let reads = 0;
	const input = Object.defineProperty({}, 'interactionState', {
		enumerable: true,
		get() { reads++; throw new Error('private'); },
	});
	const initial = prepareNativeInteractionInputs(input);
	assert.equal(initial.ownership, 'controlled');
	assert.deepEqual(initial.state, {popup: null});
	assert.equal(initial.diagnostics[0]?.code, 'INVALID_DOCUMENT');
	assert.equal(reads, 0);
	const repaired = prepareNativeInteractionInputs({interactionState: {popup: {kind: 'annotation', id: 'one'}}}, initial);
	assert.deepEqual(repaired.state, {popup: {kind: 'annotation', id: 'one'}});
	assert.deepEqual(repaired.diagnostics, []);
});

test('a partially returned native operation is cancelled when its response accessor fails', async () => {
	let cancelled = 0;
	const native = queryFixture();
	native.setQuery(() => ({
		get result(): Promise<unknown> { throw new Error('private response'); },
		cancel() { cancelled++; },
	}));
	const adapter = createNativePoiAdapter(); adapter.replaceStyle(native.lease);
	const result = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(result.status, 'error');
	assert.equal(result.diagnostics[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
	assert.equal(cancelled, 1);
	assert.doesNotMatch(JSON.stringify(result), /private response/u);
	adapter.dispose();
	assert.equal(cancelled, 1);
});

test('retirement during a native response accessor cancels the same operation only once', async () => {
	let cancelled = 0;
	const raw = barrier<unknown>();
	const native = queryFixture();
	const adapter = createNativePoiAdapter(); adapter.replaceStyle(native.lease);
	native.setQuery(() => ({
		get result() { adapter.dispose(); return raw.promise; },
		cancel() { cancelled++; },
	}));
	assert.equal((await adapter.queryTouch(touch, [poiBinding])).status, 'stale');
	assert.equal(cancelled, 1);
	raw.reject(new Error('late native response'));
});
