import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowInteractionLimits, validateTileflowAnnotations} from '@tileflow/interactions';
import {
	nativeInteractionValuesEqual,
	planNativeAnnotations,
	prepareNativeInteractionInputs,
	snapshotNativeInteractionJson,
} from '../src/native-interaction-input';

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

test('validation snapshot and revalidation visit present indices without reading or expanding holes', () => {
	const prepare = (length: number) => {
		const raw = new Array<null | {name: string}>(length);
		raw[length - 1] = {name: 'Place'};
		let indexDescriptors = 0;
		let indexReads = 0;
		let enumerations = 0;
		const data = new Proxy(raw, {
			get(target, key, receiver) {
				if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key)) {
					indexReads++;
					throw new Error('Array values must be copied through data descriptors.');
				}
				return Reflect.get(target, key, receiver);
			},
			getOwnPropertyDescriptor(target, key) {
				if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key)) {
					indexDescriptors++;
					assert.ok(Object.hasOwn(target, key), 'A hole must not be visited as a node.');
				}
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			ownKeys(target) {
				enumerations++;
				return Reflect.ownKeys(target);
			},
		});
		const annotation = {id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [0, 0], data};
		const prepared = prepareNativeInteractionInputs({annotations: [annotation]});
		assert.deepEqual(prepared.diagnostics, []);
		assert.equal(validateTileflowAnnotations(prepared.annotations).ok, true);
		const copied = prepared.annotations[0]?.data;
		assert.ok(Array.isArray(copied));
		assert.equal(copied.length, length);
		assert.deepEqual(Object.keys(copied), [String(length - 1)]);
		assert.deepEqual(copied[length - 1], {name: 'Place'});
		assert.notEqual(copied[length - 1], raw[length - 1]);
		assert.ok(Object.isFrozen(copied[length - 1]));
		assert.equal(indexReads, 0);
		assert.ok(indexDescriptors > 0);
		return {indexDescriptors, enumerations};
	};
	assert.deepEqual(prepare(tileflowInteractionLimits.maxDocumentNodes + 1), prepare(4));
});

test('sparse equality includes length and exact occupied indices without treating holes as null', () => {
	const holes = new Array<null>(3);
	assert.equal(nativeInteractionValuesEqual(holes, new Array<null>(3)), true);
	assert.equal(nativeInteractionValuesEqual(holes, new Array<null>(4)), false);
	assert.equal(nativeInteractionValuesEqual([], new Array<null>(1)), false);
	assert.equal(nativeInteractionValuesEqual(new Array<null>(1), [null]), false);
	const left = new Array<null>(3);
	const right = new Array<null>(3);
	left[1] = null;
	right[2] = null;
	assert.equal(nativeInteractionValuesEqual(left, right), false);
	assert.equal(nativeInteractionValuesEqual({nested: left}, {nested: snapshotNativeInteractionJson(left)}), true);
	assert.equal(nativeInteractionValuesEqual({nested: holes}, {nested: new Array<null>(4)}), false);

	const annotation = {id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [0, 0], data: {nested: left}};
	const previous = prepareNativeInteractionInputs({annotations: [annotation]});
	const same = prepareNativeInteractionInputs({annotations: [{...annotation, data: {nested: snapshotNativeInteractionJson(left)}}]}, previous);
	assert.deepEqual(same.diagnostics, []);
	assert.equal(same.annotations, previous.annotations);
	assert.deepEqual(planNativeAnnotations(previous.annotations, same.annotations).retain, ['one']);
	left.length++;
	const changed = prepareNativeInteractionInputs({annotations: [annotation]}, same);
	assert.deepEqual(changed.diagnostics, []);
	assert.deepEqual(planNativeAnnotations(same.annotations, changed.annotations).update.map((entry) => entry.id), ['one']);
});

test('sparse copying preserves the aggregate property byte node and depth limits', () => {
	const maximum = new Array<null>(tileflowInteractionLimits.maxDocumentProperties);
	const copied = snapshotNativeInteractionJson(maximum);
	assert.ok(Array.isArray(copied));
	assert.equal(copied.length, maximum.length);
	assert.deepEqual(Object.keys(copied), []);
	let deep: unknown = new Array<null>(1);
	for (let index = 0; index < tileflowInteractionLimits.maxDocumentDepth; index++) deep = {child: deep};
	const invalid = [
		new Array<null>(tileflowInteractionLimits.maxDocumentProperties + 1),
		new Array<null>(tileflowInteractionLimits.maxDocumentNodes).fill(null),
		[new Array<null>(25_000), new Array<null>(25_000)],
		[new Array<null>(20_001), 'x'.repeat(tileflowInteractionLimits.maxDocumentBytes)],
		deep,
	];
	const annotation = {id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [0, 0], data: new Array<null>(3)};
	const previous = prepareNativeInteractionInputs({annotations: [annotation]});
	for (const data of invalid) {
		assert.throws(() => snapshotNativeInteractionJson(data));
		const annotations = [{...annotation, data}];
		assert.equal(validateTileflowAnnotations(annotations).ok, false);
		const rejected = prepareNativeInteractionInputs({annotations}, previous);
		assert.equal(rejected.annotations, previous.annotations);
		assert.ok(rejected.diagnostics.length > 0);
	}
});

test('oversized sparse arrays fail from their length before keys are enumerated', () => {
	let enumerations = 0;
	const data = new Proxy(new Array<null>(tileflowInteractionLimits.maxDocumentProperties + 1), {
		ownKeys() {
			enumerations++;
			throw new Error('Oversized arrays must be rejected before enumeration.');
		},
	});
	assert.throws(() => snapshotNativeInteractionJson(data));
	const result = prepareNativeInteractionInputs({annotations: [{id: 'one', kind: 'marker', ariaLabel: 'Place', coordinate: [0, 0], data}]});
	assert.equal(result.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
	assert.deepEqual(result.annotations, []);
	assert.equal(enumerations, 0);
});

test('array accessors extra keys aliases cycles and hidden indices remain invalid', () => {
	let reads = 0;
	const accessor = Object.defineProperty(new Array<null>(2), '1', {
		enumerable: true,
		get() { reads++; throw new Error('Private array detail.'); },
	});
	const hidden = Object.defineProperty(new Array<null>(2), '1', {value: null});
	const cycle: unknown[] = [];
	cycle.push(cycle);
	const shared = {value: null};
	const invalid = [
		accessor,
		hidden,
		cycle,
		[shared, shared],
		[undefined],
		...['01', '-0', '1e0', 'extra', '__proto__', 'constructor', Symbol('extra')].map((key) =>
			Object.defineProperty(new Array<null>(2), key, {value: null, enumerable: true}),
		),
	];
	for (const data of invalid) assert.throws(() => snapshotNativeInteractionJson(data));
	assert.equal(reads, 0);
});

test('the descriptor copy rejects array keys introduced after the first portable audit', () => {
	for (const key of ['extra', '01', Symbol('extra')]) {
		let enumerations = 0;
		const data = new Proxy([null], {
			ownKeys(target) {
				if (++enumerations === 2) Object.defineProperty(target, key, {value: null, enumerable: true});
				return Reflect.ownKeys(target);
			},
		});
		assert.throws(() => snapshotNativeInteractionJson(data));
		assert.equal(enumerations, 2);
	}
});
