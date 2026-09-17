import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowInteractionLimits} from '@tileflow/interactions';
import {
	planNativeAnnotations,
	prepareNativeInteractionInputs,
} from '../src/native-interaction-input';

const marker = (id = 'one') => ({
	id,
	kind: 'marker' as const,
	ariaLabel: 'Place',
	coordinate: [1, 2] as [number, number],
	data: {name: 'Place'},
	popup: {content: {kind: 'text' as const, text: 'Details'}},
});
const binding = {id: 'places', target: {kind: 'semantic-feature', domain: 'poi'}};

 test('portable inputs start empty, snapshot caller data and retain the last valid documents', () => {
	const empty = prepareNativeInteractionInputs({});
	assert.deepEqual(empty.annotations, []);
	assert.deepEqual(empty.bindings, []);
	assert.deepEqual(empty.state, {popup: null});
	assert.equal(empty.ownership, 'uncontrolled');
	const annotation = marker();
	const prepared = prepareNativeInteractionInputs({annotations: [annotation], interactions: [binding]}, empty);
	annotation.coordinate[0] = 10;
	annotation.data.name = 'Changed';
	assert.deepEqual(prepared.annotations[0]?.coordinate, [1, 2]);
	assert.deepEqual(prepared.annotations[0]?.data, {name: 'Place'});
	assert.ok(Object.isFrozen(prepared.annotations[0]?.coordinate));
	assert.ok(Object.isFrozen(prepared.annotations[0]?.data));
	const invalid = prepareNativeInteractionInputs({
		annotations: [marker(), marker()],
		interactions: [{...binding, target: {kind: 'invalid'}}],
	}, prepared);
	assert.equal(invalid.annotations, prepared.annotations);
	assert.equal(invalid.bindings, prepared.bindings);
	assert.ok(invalid.diagnostics.some((value) => value.code === 'DUPLICATE_ANNOTATION_ID'));
	assert.ok(invalid.diagnostics.some((value) => value.code === 'INVALID_DOCUMENT'));
});

test('hostile documents fail without invoking accessors or reflecting their contents', () => {
	let reads = 0;
	const hostile = Object.defineProperty(marker(), 'data', {
		enumerable: true,
		get() { reads++; throw new Error('https://private.example.test/raw'); },
	});
	const cycle: unknown[] = [];
	cycle.push(cycle);
	for (const annotations of [[hostile], cycle, [new Date()], [NaN], new Proxy([], {
		getOwnPropertyDescriptor() { throw new Error('private native details'); },
	})]) {
		const result = prepareNativeInteractionInputs({annotations});
		assert.deepEqual(result.annotations, []);
		assert.ok(result.diagnostics.length > 0);
		assert.doesNotMatch(JSON.stringify(result.diagnostics), /private|https:|raw/u);
	}
	assert.equal(reads, 0);
	const sparse: unknown[] = [];
	sparse.length = tileflowInteractionLimits.maxAnnotations + 1;
	const overflow = prepareNativeInteractionInputs({annotations: sparse});
	assert.equal(overflow.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
});

test('state ownership is mount-stable and invalid replacements preserve the last valid state', () => {
	const state = {popup: {kind: 'annotation', id: 'one'}};
	const controlled = prepareNativeInteractionInputs({interactionState: state});
	assert.equal(controlled.ownership, 'controlled');
	for (const input of [
		{},
		{defaultInteractionState: {popup: null}},
		{interactionState: state, defaultInteractionState: {popup: null}},
		{interactionState: {popup: {kind: 'annotation', id: ''}}},
		{interactionState: {popup: null, unrecognized: 'sensitive'}},
	]) {
		const next = prepareNativeInteractionInputs(input, controlled);
		assert.equal(next.ownership, 'controlled');
		assert.equal(next.state, controlled.state);
		assert.ok(next.diagnostics.some((value) => value.code === 'INVALID_DOCUMENT'));
	}
	const initial = prepareNativeInteractionInputs({defaultInteractionState: state});
	const later = prepareNativeInteractionInputs({defaultInteractionState: {popup: null}}, initial);
	assert.equal(later.ownership, 'uncontrolled');
	assert.equal(later.state, initial.state);
	const switched = prepareNativeInteractionInputs({interactionState: {popup: null}}, initial);
	assert.equal(switched.state, initial.state);
	assert.equal(switched.diagnostics[0]?.code, 'INVALID_DOCUMENT');
	const both = prepareNativeInteractionInputs({interactionState: state, defaultInteractionState: state});
	assert.deepEqual(both.state, {popup: null});
	assert.equal(both.ownership, 'controlled');
	assert.equal(both.diagnostics[0]?.code, 'INVALID_DOCUMENT');
});

test('annotation plans retain compatible hosts, update by ID, and remove deterministically', () => {
	const previous = prepareNativeInteractionInputs({annotations: [marker('one'), marker('two'), marker('gone')]});
	const next = prepareNativeInteractionInputs({annotations: [
		{...marker('two'), data: {name: 'Updated'}, coordinate: [4, 5], popup: {content: {kind: 'view', name: 'details'}}},
		marker('one'),
		marker('new'),
	]}, previous);
	const plan = planNativeAnnotations(previous.annotations, next.annotations);
	assert.deepEqual(plan.order, ['two', 'one', 'new']);
	assert.deepEqual(plan.retain, ['one']);
	assert.deepEqual(plan.update.map((value) => value.id), ['two']);
	assert.deepEqual(plan.create.map((value) => value.id), ['new']);
	assert.deepEqual(plan.remove, ['gone']);
	assert.equal(plan.update[0]?.previous, previous.annotations[1]);
	assert.equal(plan.update[0]?.annotation, next.annotations[0]);
	assert.ok(Object.isFrozen(plan));
	assert.ok(Object.isFrozen(plan.update));
	const rejected = prepareNativeInteractionInputs({annotations: [marker('one'), marker('one')]}, next);
	const unchanged = planNativeAnnotations(next.annotations, rejected.annotations);
	assert.deepEqual(unchanged.create, []);
	assert.deepEqual(unchanged.update, []);
	assert.deepEqual(unchanged.remove, []);
	assert.deepEqual(unchanged.retain, ['two', 'one', 'new']);
});

test('the portable annotation count limit is exact and data key order does not recreate or update a host', () => {
	const annotations = Array.from({length: tileflowInteractionLimits.maxAnnotations}, (_, index) => ({
		id: `p${index}`, kind: 'marker', ariaLabel: 'P', coordinate: [0, 0],
	}));
	const full = prepareNativeInteractionInputs({annotations});
	assert.equal(full.annotations.length, 1000);
	assert.deepEqual(full.diagnostics, []);
	const tooMany = prepareNativeInteractionInputs({annotations: [...annotations, marker('overflow')]}, full);
	assert.equal(tooMany.annotations, full.annotations);
	assert.equal(tooMany.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
	const one = prepareNativeInteractionInputs({annotations: [{...marker(), data: {a: 1, b: 2}}]});
	const reordered = prepareNativeInteractionInputs({annotations: [{...marker(), data: {b: 2, a: 1}}]}, one);
	assert.equal(reordered.annotations, one.annotations);
	assert.deepEqual(planNativeAnnotations(one.annotations, reordered.annotations).retain, ['one']);
});
