import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {createHostedNativeSessionController} from '../src/session-controller';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, credential, createClock, createIds, deferred, mapId, response, success} from './session-fixture';

const resource = {url: 'https://tiles.tileflow.test/world/0/0/0.pbf', scope: 'tile' as const, tilesetId: 'world'};

function fixture() {
	const clock = createClock();
	const bridge = new AdmissionBridgeDouble();
	const acquired: string[] = [];
	const started = deferred<void>();
	const release = deferred<void>();
	let hold = false;
	let creations = 0;
	const owner = createNativeAdmissionOwner({bridge, createController(input) {
		creations++;
		const controller = createHostedNativeSessionController(input);
		return {...controller, get state() { return controller.state; }, async acquire() {
			const result = await controller.acquire();
			if (result) acquired.push(result.sessionId);
			return result;
		}};
	}});
	const input = {
		binding: {kind: 'hosted' as const, apiOrigin, credential, mapId, surfaceId: 'default'},
		resources: [resource], now: clock.now, sessionIdFactory: createIds(),
		fetch: async (_url: string, init: {body: string}) => {
			const body = JSON.parse(init.body);
			if (hold) { started.resolve(); await release.promise; }
			return response(201, success({sessionId: body.sessionId, surfaceId: body.surfaceId,
				issuedAt: clock.now().toISOString(), serverTime: clock.now().toISOString(), expiresAt: new Date(clock.value + 900000).toISOString()}));
		},
	};
	return {clock, bridge, owner, input, acquired, started, release, hold() { hold = true; }, get creations() { return creations; }};
}

test('9999/10000/10001 crosses a held bootstrap inside one logical batch without sharing admissions', async () => {
	const f = fixture(); const map = await f.owner.openMap(f.input);
	for (let count = 0; count < 9999;) {
		const size = Math.min(8, 9999 - count);
		await f.bridge.batch(map.context, Array.from({length: size}, () => resource.url)).promise;
		count += size;
	}
	f.hold();
	const boundary = f.bridge.batch(map.context, [resource.url, resource.url]);
	await f.started.promise;
	// The old session can admit ticket 10000 while 10001 waits for its own
	// new-session bootstrap. No native batch can mint one shared acquire.
	assert.equal(f.acquired[9998], 'ses_test_1');
	f.release.resolve();
	const results = await boundary.promise;
	assert.deepEqual(results.map((item) => item.kind), ['grant', 'grant']);
	assert.equal(f.acquired.length, 10001);
	assert.equal(f.acquired[9999], 'ses_test_1');
	assert.equal(f.acquired[10000], 'ses_test_2');
	await f.owner.dispose();
});

test('six-hour rotation uses one held bootstrap and eight separately accounted admissions', async () => {
	const f = fixture(); const map = await f.owner.openMap(f.input);
	await f.bridge.batch(map.context, [resource.url]).promise;
	f.clock.advance(21600000); f.hold();
	const boundary = f.bridge.batch(map.context, Array.from({length: 8}, () => resource.url));
	await f.started.promise;
	assert.deepEqual(f.acquired, ['ses_test_1']);
	f.release.resolve(); await boundary.promise;
	assert.deepEqual(f.acquired, ['ses_test_1', ...Array.from({length: 8}, () => 'ses_test_2')]);
	await f.owner.dispose();
});

test('retirement during a held bootstrap leaves another context and its callbacks isolated', async () => {
	const f = fixture(); const first = await f.owner.openMap(f.input);
	const second = await f.owner.openMap({...f.input, sessionIdFactory: createIds('ses_second')});
	f.hold();
	const pending = f.bridge.batch(first.context, [resource.url]);
	await f.started.promise;
	await first.retire();
	f.release.resolve();
	assert.deepEqual(await pending.promise, []);
	assert.equal((await f.bridge.batch(second.context, [resource.url]).promise)[0].kind, 'grant');
	assert.equal(f.bridge.completions.some((item) => item.context === first.context), false);
	await f.owner.dispose();
});

test('a registration completing after disposal is retired rather than installed into public state', async () => {
	const f = fixture();
	await f.owner.install();
	const gate = deferred<void>(); f.bridge.registerGate = gate.promise;
	const pending = f.owner.openMap(f.input);
	// A controller factory is a deterministic barrier before registerContext.
	await Promise.resolve();
	assert.equal(f.creations, 1);
	const rejected = assert.rejects(pending, {code: 'NATIVE_ADMISSION_CANCELLED'});
	await f.owner.dispose();
	gate.resolve(); await rejected;
	assert.equal(f.bridge.registrations.size, 0);
	assert.equal(f.owner.state.contexts, 0);
	assert.equal(f.owner.state.pendingRegistrations, 0);
});

test('a duplicate completed batch and a retired context cannot reacquire authority', async () => {
	const f = fixture(); const map = await f.owner.openMap(f.input);
	const batch = f.bridge.batch(map.context, [resource.url]); await batch.promise;
	const event = {kind: 'batch' as const, installation: f.bridge.installation, context: map.context, generation: map.generation, batch: batch.batch, tickets: batch.tickets};
	f.bridge.listener(event);
	assert.equal(f.acquired.length, 1);
	await map.retire(); f.bridge.listener({...event, batch: '999'});
	assert.equal(f.acquired.length, 1);
	await f.owner.dispose();
});
