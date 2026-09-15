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

	await controller.acquire();
	assert.equal(controller.state.status, 'ready');
	assertSafeState(controller.state, [credential, grant]);
	assert.equal(JSON.stringify(controller.state).includes('requestCount'), false);
	assert.equal(JSON.stringify(controller.state).includes('expiresAt'), false);
});

test('a failed authority refresh does not consume the 10,000 admitted-resource rotation budget', async () => {
	const clock = createClock();
	const queue = createFetchQueue([
		response(201, success()),
		response(503, {code: 'MOBILE_SESSION_UNAVAILABLE'}),
		response(201, success({
			issuedAt: '2026-09-15T20:14:31.000Z',
			serverTime: '2026-09-15T20:14:31.000Z',
			expiresAt: '2026-09-15T20:29:31.000Z',
		})),
	]);
	const controller = createHostedNativeSessionController({binding: hosted(), fetch: queue.fetch, now: clock.now, sessionIdFactory: createIds()});
	await controller.acquire();
	for (let index = 1; index < 9_999; index += 1) await controller.acquire();
	clock.advance(14 * 60_000 + 31_000);
	assert.equal(await rejectedCode(controller.acquire()), 'NATIVE_SESSION_UNAVAILABLE');
	const authority = await controller.acquire();
	assert.equal(authority?.sessionId, 'ses_test_1');
	assert.equal(queue.calls.length, 3);
	assert.deepEqual(queue.calls.map((call) => JSON.parse(call.init.body).sessionId), ['ses_test_1', 'ses_test_1', 'ses_test_1']);
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
