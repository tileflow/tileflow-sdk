import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeInteractionStyleOwner} from '../src/native-interaction-style';

test('only an explicit native-backed publication creates a style proof', () => {
	const owner = createNativeInteractionStyleOwner(() => undefined);
	assert.equal(owner.get(), undefined);
	const style = Object.freeze({version: 8});
	let current = true;
	owner.publish('map-a', 'style_1', style, () => current);
	const proof = owner.get()!;
	assert.equal(proof.style, style);
	assert.equal(proof.key, 'map-a');
	assert.equal(proof.token, 'style_1');
	assert.equal(proof.isCurrent(), true);
	current = false;
	assert.equal(proof.isCurrent(), false);
	assert.equal(owner.get(), undefined);
});

test('retirement is permanent even when an equal style, token or foreground state returns', () => {
	let changes = 0;
	const owner = createNativeInteractionStyleOwner(() => { changes++; });
	const style = Object.freeze({version: 8});
	owner.publish('map-a', 'style_1', style, () => true);
	const old = owner.get()!;
	owner.retire();
	assert.equal(old.isCurrent(), false);
	owner.publish('map-a', 'style_1', style, () => true);
	assert.notEqual(owner.get(), old);
	assert.equal(old.isCurrent(), false);
	assert.equal(changes, 3);
});

test('each map owns its proof and observer failures cannot prevent retirement', () => {
	const left = createNativeInteractionStyleOwner(() => { throw new Error('observer'); });
	const right = createNativeInteractionStyleOwner(() => undefined);
	left.publish('left', 'style_1', {}, () => true);
	right.publish('right', 'style_1', {}, () => true);
	left.retire();
	assert.equal(left.get(), undefined);
	assert.equal(right.get()?.isCurrent(), true);
});
