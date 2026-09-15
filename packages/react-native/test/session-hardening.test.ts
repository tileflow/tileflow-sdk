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
	grant,
	mapId,
	response,
	success,
} from './session-fixture';

const hosted = (surfaceId: string | undefined = 'store-locator') => ({
	kind: 'hosted' as const,
	apiOrigin,
	credential,
	mapId,
	surfaceId,
});

async function rejectedCode(promise: Promise<unknown>) {
	try {
		await promise;
		assert.fail('expected rejection');
	} catch (error) {
		assert.ok(error instanceof HostedNativeSessionError);
		assert.equal(error.message.includes(credential), false);
		assert.equal(error.message.includes(grant), false);
		return error.code;
	}
}

test('safe observable state contains identities only and retains a bounded error across lifecycle changes', async () => {
	const queue = createFetchQueue([
		response(503, {code: 'MOBILE_SESSION_UNAVAILABLE', error: `${credential}${grant}`}),
		response(201, success()),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_UNAVAILABLE');
	assert.equal(controller.state.status, 'error');
	assertSafeState(controller.state, [credential, grant]);
	assert.equal(JSON.stringify(controller.state).includes('requestCount'), false);
	assert.equal(JSON.stringify(controller.state).includes('expiresAt'), false);

	controller.background();
	assert.equal(controller.state.status, 'error');
	assert.equal(controller.state.lifecycle, 'background');
	await controller.resume();
	assert.equal(controller.state.status, 'error');
	assert.equal(controller.state.lifecycle, 'foreground');

	const authority = await controller.acquire();
	assert.ok(authority);
	assert.equal(authority.grant, grant);
	assert.equal(Object.keys(authority).includes('grant'), false);
	assert.equal(JSON.stringify(authority).includes(grant), false);
	assert.equal(controller.state.status, 'ready');
	assertSafeState(controller.state, [credential, grant]);
	assert.equal(JSON.stringify(controller.state).includes('requestCount'), false);
	assert.equal(JSON.stringify(controller.state).includes('expiresAt'), false);
});

test('invalid Surface is normalized in the bootstrap body and response origins must be canonical origin strings', async () => {
	const normalizedQueue = createFetchQueue([response(201, success({surfaceId: 'default'}))]);
	const normalized = createHostedNativeSessionController({binding: hosted('INVALID SURFACE'), fetch: normalizedQueue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	await normalized.acquire();
	assert.deepEqual(JSON.parse(normalizedQueue.calls[0].init.body), {mapId, sessionId: 'ses_test_1', surfaceId: 'default'});

	const invalidOrigin = createHostedNativeSessionController({
		binding: hosted(),
		fetch: createFetchQueue([response(201, success({resourceOrigins: ['https://api.tileflow.test/']}))]).fetch,
		now: createClock().now,
		sessionIdFactory: createIds(),
	});
	assert.equal(await rejectedCode(invalidOrigin.acquire()), 'NATIVE_SESSION_RESPONSE_INVALID');
});

test('restart authority requires the exact bounded server shape rather than only matching code fields', async () => {
	const queue = createFetchQueue([
		response(409, {
			code: 'COMMERCIAL_SESSION_RESTART_REQUIRED',
			error: 'restart',
			retryWithNewSession: true,
			sessionId: 'ses_test_1',
			unexpected: true,
		}),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: createClock().now, sessionIdFactory: createIds()});
	assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_REJECTED');
	assert.equal(queue.calls.length, 1);
});

test('clock rollback after bootstrap completion still forces a fresh authority before acquire returns', async () => {
	const t0 = Date.parse('2026-09-15T20:00:00.000Z');
	const values = [t0, t0, t0, t0 - 3_600_000, t0 - 3_600_000, t0 - 3_600_000, t0 - 3_600_000];
	let index = 0;
	const now = () => new Date(values[Math.min(index++, values.length - 1)]);
	const queue = createFetchQueue([
		response(201, success()),
		response(201, success()),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now, sessionIdFactory: createIds()});
	const authority = await controller.acquire();
	assert.equal(authority?.sessionId, 'ses_test_1');
	assert.equal(queue.calls.length, 2);
});

test('injected clock and fetch failures are normalized without exposing causes or authority material', async () => {
	assert.throws(
		() => createHostedNativeSessionController({
			binding: hosted(),
			fetch: async () => { throw new Error(credential); },
			now: () => { throw new Error(grant); },
			sessionIdFactory: createIds(),
		}),
		(error: unknown) => error instanceof HostedNativeSessionError && error.code === 'NATIVE_SESSION_INPUT_INVALID' && !error.message.includes(grant),
	);

	const controller = createHostedNativeSessionController({
		binding: hosted(),
		fetch: async () => { throw new Error(`${credential}${grant}`); },
		now: createClock().now,
		sessionIdFactory: createIds(),
	});
	assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_UNAVAILABLE');
	assertSafeState(controller.state, [credential, grant]);
});
