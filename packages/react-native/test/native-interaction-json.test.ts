import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowInteractionLimits, validateTileflowAnnotations} from '@tileflow/interactions';
import {planNativeAnnotations, prepareNativeInteractionInputs} from '../src/native-interaction-input';

test('bounded sparse annotation data retains the portable validator semantics without inventing nodes', () => {
	const data = new Array<null>(tileflowInteractionLimits.maxDocumentNodes + 1);
	const annotation = {id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [0, 0], data};
	assert.equal(validateTileflowAnnotations([annotation]).ok, true);
	const prepared = prepareNativeInteractionInputs({annotations: [annotation]});
	assert.deepEqual(prepared.diagnostics, []);
	assert.equal(prepared.annotations.length, 1);
	const copied = prepared.annotations[0]?.data;
	assert.ok(Array.isArray(copied));
	assert.equal(copied.length, data.length);
	assert.equal(Object.hasOwn(copied, 0), false);
	assert.ok(Object.isFrozen(copied));
	data.length++;
	assert.notEqual(copied.length, data.length);
	const next = prepareNativeInteractionInputs({annotations: [{...annotation, data}]}, prepared);
	assert.deepEqual(next.diagnostics, []);
	assert.notEqual(next.annotations, prepared.annotations);
	const plan = planNativeAnnotations(prepared.annotations, next.annotations);
	assert.deepEqual(plan.create, []);
	assert.deepEqual(plan.remove, []);
	assert.deepEqual(plan.update.map((entry) => entry.id), ['one']);
});
