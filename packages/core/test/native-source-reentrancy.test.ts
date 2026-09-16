import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTileflowNativeSourceController,
	type TileflowNativeManifestAcquire,
	type TileflowNativeManifestResponse,
	type TileflowNativeSourceState,
} from '../src/native';
import {deferred, source, transport} from './native-manifest-fixture';

function controlled() {
	const requests: Array<{
		response: ReturnType<typeof deferred<TileflowNativeManifestResponse>>;
		cancels: number;
	}> = [];
	const acquire: TileflowNativeManifestAcquire = () => {
		const request = {response: deferred<TileflowNativeManifestResponse>(), cancels: 0};
		requests.push(request);
		return {response: request.response.promise, cancel() { request.cancels++; }};
	};
	const controller = createTileflowNativeSourceController({acquire});
	const states: TileflowNativeSourceState[] = [];
	controller.subscribe((state) => { states.push(state); });
	return {controller, states, requests};
}

for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
	for (const staleRejects of [false, true]) {
		test(`invalid replacements do not revive superseded sources: ${order}; rejects=${staleRejects}`, async () => {
			const {controller, states, requests} = controlled();
			const first = controller.replace(source);
			await controller.replace({...source, manifestUrl: ''});
			const second = controller.replace(source, {theme: 'dark'});
			await controller.replace({...source, map: 'INVALID'});
			const third = controller.replace(source);
			assert.equal(requests.length, 3);
			assert.deepEqual(requests.map(({cancels}) => cancels), [1, 1, 0]);
			for (const index of order) {
				if (index < 2 && staleRejects) requests[index]!.response.reject(new Error('Remote private details.'));
				else requests[index]!.response.resolve(transport().response);
			}
			await Promise.all([first, second, third]);
			assert.deepEqual(states.filter((state) => state.status === 'ready').map((state) => state.generation), [5]);
			assert.deepEqual(states.filter((state) => state.status === 'error').map((state) => state.generation), [2, 4]);
			const last = controller.state;
			assert.ok(last?.status === 'ready');
			assert.equal(last.map.name, 'streets');
			assert.equal(last.theme.name, 'light');
			assert.equal(last.manifestUrl, source.manifestUrl);
		});
	}
}

test('source snapshots precede retired transport cleanup and loading observers', async () => {
	const input = {...source};
	const before = {...input};
	const requests: ReturnType<typeof deferred<TileflowNativeManifestResponse>>[] = [];
	const controller = createTileflowNativeSourceController({acquire: () => {
		const response = deferred<TileflowNativeManifestResponse>();
		requests.push(response);
		return {response: response.promise, cancel() { input.map = 'cleanup'; }};
	}});
	const pending = controller.replace(source);
	controller.subscribe((state) => {
		if (state.status === 'loading' && state.generation === 2) input.manifestUrl = 'invalid';
	});
	const replacement = controller.replace(input);
	requests[1]!.resolve(transport().response);
	requests[0]!.resolve(transport().response);
	await Promise.all([pending, replacement]);
	const ready = controller.state;
	assert.ok(ready?.status === 'ready');
	assert.deepEqual(ready.source, before);
	assert.ok(Object.isFrozen(ready.source));
	assert.equal(Object.isFrozen(input), false);
});

test('reentrant replacement suppresses older notifications and repeated disposal stays inert', async () => {
	const {controller, requests} = controlled();
	const observed: Array<[string, number]> = [];
	let replacement: Promise<void> | undefined;
	controller.subscribe((state) => {
		if (state.status === 'loading' && state.generation === 1) replacement = controller.replace(source);
	});
	controller.subscribe((state) => { observed.push([state.status, state.generation]); });
	const initial = controller.replace(source);
	assert.equal(requests.length, 1);
	requests[0]!.response.resolve(transport().response);
	await initial;
	await replacement;
	assert.deepEqual(observed, [['loading', 2], ['ready', 2]]);
	controller.dispose(); controller.dispose();
	await assert.rejects(controller.replace(source), {code: 'NATIVE_SOURCE_DISPOSED'});
	const last = controller.state;
	controller.subscribe(() => { throw new Error('Unexpected notification after disposal.'); });
	assert.equal(controller.state, last);
});

test('pre-abort and reentrant disposal cannot manufacture readiness or perform acquisition', async () => {
	const {controller, states, requests} = controlled();
	const abort = new AbortController();
	abort.abort('Private reason.');
	await controller.replace(source, {signal: abort.signal});
	const failure = controller.state;
	assert.ok(failure?.status === 'error');
	assert.equal(failure.error.code, 'NATIVE_SOURCE_ABORTED');
	assert.equal(failure.error.kind, 'cancelled');
	assert.equal(failure.error.message.includes('Private'), false);
	const next = controlled();
	let late = 0;
	next.controller.subscribe(() => next.controller.dispose());
	next.controller.subscribe(() => { late++; });
	await next.controller.replace(source);
	assert.equal(late, 0);
	assert.equal(next.controller.state?.status, 'loading');
	assert.equal(states.some(({status}) => status === 'ready'), false);
	assert.equal(requests.length, 0);
	assert.equal(next.requests.length, 0);
});
