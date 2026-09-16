import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, createClock, createIds, credential, deferred, mapId, response, success} from './session-fixture';

test('context preparation returns policy only and shares neither readiness nor retirement across Maps', async () => {
	const bridge = new AdmissionBridgeDouble();
	const entered = deferred<void>();
	const release = deferred<void>();
	let calls = 0;
	const owner = createNativeAdmissionOwner({bridge});
	const input = {
		binding: {kind: 'hosted' as const, apiOrigin, credential, mapId},
		resources: [], now: createClock().now,
		sessionIdFactory: createIds(),
		fetch: async (_url: string, init: {body: string}) => {
			calls++;
			entered.resolve();
			await release.promise;
			const body = JSON.parse(init.body);
			return response(201, success({sessionId: body.sessionId, surfaceId: body.surfaceId}));
		},
	};
	const first = await owner.openMap(input);
	const second = await owner.openMap({...input, sessionIdFactory: createIds('second')});
	assert.equal(calls, 0);
	const firstPolicy = first.prepare();
	const rejected = assert.rejects(firstPolicy);
	await entered.promise;
	const secondPolicy = second.prepare();
	await first.retire();
	release.resolve();
	await rejected;
	assert.equal((await secondPolicy)!.mapId, mapId);
	assert.equal(calls, 2);
	assert.deepEqual(bridge.completions, []);
	assert.equal(second.state.status, 'active');
	await owner.dispose();
});

test('direct context preparation never evaluates bootstrap or identity factories', async () => {
	const owner = createNativeAdmissionOwner({bridge: new AdmissionBridgeDouble()});
	const context = await owner.openMap({
		binding: {kind: 'direct'}, resources: [], now: createClock().now,
		sessionIdFactory: () => { throw new Error('Unexpected identity.'); },
	});
	assert.equal(await context.prepare(), null);
	await context.retire();
	await assert.rejects(context.prepare(), {code: 'NATIVE_ADMISSION_CANCELLED'});
	await owner.dispose();
});
