import assert from 'node:assert/strict';
import test from 'node:test';
import {snapshotNativeMapOptions} from '../src/native-map-options';

test('only the positive boolean allowlist crosses the renderer boundary', () => {
	const input = {dragPan: true, touchZoom: false, compass: true, scaleBar: undefined};
	const result = snapshotNativeMapOptions(input);
	assert.deepEqual(result, {dragPan: true, touchZoom: false, compass: true});
	assert.ok(Object.isFrozen(result));
	input.dragPan = false;
	assert.equal(result.dragPan, true);
	assert.deepEqual(snapshotNativeMapOptions(undefined), {});
});

test('forged style network callbacks camera and malformed fields fail without values', () => {
	for (const key of ['mapStyle', 'styleURL', 'requestHeaders', 'transformRequest', 'onDidFinishLoadingStyle', 'onRegionDidChange', 'ref', 'children', 'center', 'nativeID']) {
		assert.throws(() => snapshotNativeMapOptions({[key]: 'private-value'}), {
			message: 'Native map options are invalid.',
		});
	}
	for (const value of [null, [], true, 1, 'private-value', {dragPan: 1}, {touchZoom: null}, Object.create({dragPan: true}), {[Symbol('private')]: true}]) {
		assert.throws(() => snapshotNativeMapOptions(value));
	}
	let reads = 0;
	assert.throws(() => snapshotNativeMapOptions({get dragPan() { reads++; return true; }}));
	assert.equal(reads, 0);
});
