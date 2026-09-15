import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostedNativeSessionController, HostedNativeSessionError} from '../src/session-controller';
import {
	apiOrigin,
	assertSafeState,
	createClock,
	createFetchQueue,
	createIds,
	credential,
	deferred,
	grant,
	mapId,
	response,
	success,
} from './session-fixture';

const hosted = () => ({kind: 'hosted' as const, apiOrigin, credential, mapId, surfaceId: 'default'});

async function code(promise: Promise<unknown>) {
	try {
		await promise;
		assert.fail('expected rejection');
	} catch (error) {
		assert.ok(error instanceof HostedNativeSessionError);
		return error.code;
	}
}

test('9,999/10,000 eligible-request races rotate atomically at the transport boundary', async () => {
	const queue = createFetchQueue([
		response(201, success()),
		response(201, success({sessionId: 'ses_test_2'})),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	await controller.acquire();
	for (let index = 1; index < 9_999; index += 1) await controller.acquire();
	assert.equal(queue.calls.length, 1);

	const [tenThousandth, rotated] = await Promise.all([controller.acquire(), controller.acquire()]);
	assert.equal(tenThousandth?.sessionId, 'ses_test_1');
	assert.equal(rotated?.sessionId, 'ses_test_2');
	assert.equal(queue.calls.length, 2);
	assert.deepEqual(queue.calls.map((call) => JSON.parse(call.init.body).sessionId), ['ses_test_1', 'ses_test_2']);
});

test('six-hour rotation is checked synchronously before admission and concurrent callers share the replacement bootstrap', async () => {
	const clock = createClock();
	const next = deferred<ReturnType<typeof response>>();
	const queue = createFetchQueue([
		response(201, success()),
		() => next.promise,
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: clock.now, sessionIdFactory: createIds()});
	await controller.acquire();
	clock.advance(6 * 60 * 60 * 1000);
	const one = controller.acquire();
	const two = controller.acquire();
	assert.equal(queue.calls.length, 2);
	next.resolve(response(201, success({
		sessionId: 'ses_test_2',
		issuedAt: '2026-09-16T02:00:00.000Z',
		serverTime: '2026-09-16T02:00:00.000Z',
		expiresAt: '2026-09-16T02:15:00.000Z',
	})));
	const results = await Promise.all([one, two]);
	assert.equal(results.every((value) => value?.sessionId === 'ses_test_2'), true);
});

test('background preserves identity; resume refreshes near-expiry/expired authority but does not depend on timers', async () => {
	const clock = createClock();
	const queue = createFetchQueue([
		response(201, success()),
		response(201, success({issuedAt: '2026-09-15T20:15:00.000Z', serverTime: '2026-09-15T20:15:00.000Z', expiresAt: '2026-09-15T20:30:00.000Z'})),
		response(201, success({issuedAt: '2026-09-15T20:30:00.000Z', serverTime: '2026-09-15T20:30:00.000Z', expiresAt: '2026-09-15T20:45:00.000Z'})),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: clock.now, sessionIdFactory: createIds()});
	await controller.acquire();
	controller.background();
	assert.equal(controller.state.lifecycle, 'background');
	clock.advance(10 * 60_000);
	await controller.resume();
	assert.equal(queue.calls.length, 1);
	assert.equal(controller.state.lifecycle, 'foreground');

	controller.background();
	clock.advance(4 * 60_000 + 31_000);
	await controller.resume();
	assert.equal(queue.calls.length, 2);
	assert.equal(JSON.parse(queue.calls[1].init.body).sessionId, 'ses_test_1');

	controller.background();
	clock.advance(15 * 60_000);
	await controller.resume();
	assert.equal(queue.calls.length, 3);
	assert.equal(JSON.parse(queue.calls[2].init.body).sessionId, 'ses_test_1');
});

test('two controllers with identical inputs never share session identity, work, counters or authority', async () => {
	const clock = createClock();
	const aFetch = createFetchQueue([response(201, success({sessionId: 'ses_a_1'}))]);
	const bFetch = createFetchQueue([response(201, success({sessionId: 'ses_b_1', grant: `${grant}b`}))]);
	const a = createHostedNativeSessionController({binding: hosted(), fetch: aFetch.fetch, now: clock.now, sessionIdFactory: createIds('ses_a')});
	const b = createHostedNativeSessionController({binding: hosted(), fetch: bFetch.fetch, now: clock.now, sessionIdFactory: createIds('ses_b')});
	const [aa, bb] = await Promise.all([a.acquire(), b.acquire()]);
	assert.equal(aa?.sessionId, 'ses_a_1');
	assert.equal(bb?.sessionId, 'ses_b_1');
	assert.notEqual(aa?.grant, bb?.grant);
	assert.equal(aFetch.calls.length, 1);
	assert.equal(bFetch.calls.length, 1);
});

test('dispose aborts owned work, is idempotent, and late completion cannot revive state', async () => {
	const pending = deferred<ReturnType<typeof response>>();
	const queue = createFetchQueue([() => pending.promise]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	const states: unknown[] = [];
	controller.subscribe((state) => states.push(state));
	const acquisition = controller.acquire();
	assert.equal(queue.calls.length, 1);
	assert.equal(queue.calls[0].init.signal.aborted, false);
	controller.dispose();
	controller.dispose();
	assert.equal(queue.calls[0].init.signal.aborted, true);
	assert.equal(await code(acquisition), 'NATIVE_SESSION_DISPOSED');
	pending.resolve(response(201, success()));
	await Promise.resolve();
	assert.equal(controller.state.status, 'disposed');
	assertSafeState(controller.state, [credential, grant]);
	for (const state of states) assertSafeState(state as never, [credential, grant]);
	assert.equal(await code(controller.acquire()), 'NATIVE_SESSION_DISPOSED');
});

test('replacement retires late bootstrap and observer reentrancy cannot publish obsolete authority', async () => {
	const pending = deferred<ReturnType<typeof response>>();
	const queue = createFetchQueue([
		() => pending.promise,
		response(201, success({mapId: 'map_replacement', sessionId: 'ses_test_2'})),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	let replaced = false;
	controller.subscribe((state) => {
		if (!replaced && state.status === 'loading') {
			replaced = true;
			controller.replaceBinding({...hosted(), mapId: 'map_replacement'});
		}
	});
	const old = controller.acquire();
	assert.equal(await code(old), 'NATIVE_SESSION_REPLACED');
	pending.resolve(response(201, success()));
	const next = await controller.acquire();
	assert.equal(next?.mapId, 'map_replacement');
	assert.equal(next?.sessionId, 'ses_test_2');
	assertSafeState(controller.state, [credential, grant]);
});

test('mutation attempts cannot alter retained authority or safe snapshots', async () => {
	const queue = createFetchQueue([response(201, success())]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	const authority = await controller.acquire();
	assert.ok(authority);
	assert.throws(() => (authority.resourceScopes as string[]).push('admin'));
	assert.throws(() => (authority.resourceOrigins as string[])[0] = 'https://evil.test');
	const snapshot = controller.state;
	assert.equal(Object.isFrozen(snapshot), true);
	assert.throws(() => Object.assign(snapshot, {status: 'disposed'}));
	const again = await controller.acquire();
	assert.deepEqual(again?.resourceScopes, ['style', 'tilejson', 'tile', 'sprite', 'glyph', 'font']);
	assert.equal(again?.resourceOrigins[0], 'https://api.tileflow.test');
	assertSafeState(controller.state, [credential, grant]);
});
