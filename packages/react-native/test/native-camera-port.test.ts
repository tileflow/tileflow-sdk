import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeCameraPort} from '../src/native-camera-port';
import {deferred} from './session-fixture';

const view = {center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5};

test('a queued upstream command is not an application receipt', async () => {
	const receipt = deferred<{command: number; view: typeof view}>();
	const calls: number[] = [];
	const port = createNativeCameraPort({
		applyCamera(command) { calls.push(command); return receipt.promise; },
		async cancelCamera() { return {cancelled: true as const}; },
	});
	let applied = false;
	const operation = port.apply({token: {sequence: 1}, view});
	const finished = operation.finished.then(() => { applied = true; });
	await Promise.resolve();
	assert.deepEqual(calls, [1]);
	assert.equal(applied, false);
	receipt.resolve({command: 1, view});
	await finished;
	assert.equal(applied, true);
	port.dispose();
});

test('rapid replacement keeps only one native command and the last undispatched target', async () => {
	const first = deferred<{command: number; view: typeof view}>();
	const calls: number[] = [];
	const cancels: number[] = [];
	const port = createNativeCameraPort({
		applyCamera(command, target) {
			calls.push(command);
			return command === 1 ? first.promise : Promise.resolve({command, view: target});
		},
		async cancelCamera(command) { cancels.push(command); return {cancelled: true as const}; },
	});
	const initial = port.apply({token: {sequence: 1}, view});
	await Promise.resolve();
	let latest = initial;
	for (let sequence = 2; sequence <= 100; sequence++) {
		latest.cancel();
		latest = port.apply({token: {sequence}, view});
	}
	assert.deepEqual(calls, [1]);
	first.resolve({command: 1, view});
	await latest.finished;
	await port.whenIdle();
	assert.deepEqual(calls, [1, 100]);
	assert.deepEqual(cancels, [1]);
	await assert.rejects(initial.finished);
	port.dispose();
});

test('foreign tokens, partial or wrong views, and teardown never acknowledge application', async () => {
	for (const receipt of [{command: 2, view}, {command: 1, view: {...view, zoom: 4}}, {command: 1, view: {zoom: 3}}]) {
		const port = createNativeCameraPort({
			async applyCamera() { return receipt as {command: number; view: typeof view}; },
			async cancelCamera() { return {cancelled: true as const}; },
		});
		await assert.rejects(port.apply({token: {sequence: 1}, view}).finished, {message: 'Native camera operation failed.'});
		port.dispose();
	}
	const pending = deferred<{command: number; view: typeof view}>();
	const port = createNativeCameraPort({applyCamera: () => pending.promise, cancelCamera: async () => ({cancelled: true})});
	const operation = port.apply({token: {sequence: 1}, view});
	await Promise.resolve();
	port.dispose();
	pending.resolve({command: 1, view});
	await assert.rejects(operation.finished);
});
