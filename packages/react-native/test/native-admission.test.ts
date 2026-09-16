import assert from 'node:assert/strict';
import test from 'node:test';
import {createHostedNativeSessionController} from '../src/session-controller';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {nativeAdmissionLimits} from '../src/native-admission-contract';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, credential, createClock, createIds, deferred, grant, mapId, response, success} from './session-fixture';

const resource = Object.freeze({url: 'https://tiles.tileflow.test/world/0/0/0.pbf?variant=a%2Fb&x=1', scope: 'tile' as const, tilesetId: 'world'});

function fixture(options: {direct?: boolean; holdAcquire?: Promise<void>; acquired?: () => void} = {}) {
	const clock = createClock();
	const bridge = new AdmissionBridgeDouble();
	let acquisitions = 0;
	const sessions: string[] = [];
	const bootstraps: string[] = [];
	const owner = createNativeAdmissionOwner({
		bridge,
		createController(input) {
			const controller = createHostedNativeSessionController(input);
			return {
				...controller,
				get state() { return controller.state; },
				async acquire() {
					acquisitions += 1;
					const result = await controller.acquire();
					if (result) sessions.push(result.sessionId);
					options.acquired?.();
					await options.holdAcquire;
					return result;
				},
			};
		},
	});
	const input = {
		binding: options.direct ? {kind: 'direct' as const} : {kind: 'hosted' as const, apiOrigin, credential, mapId, surfaceId: 'store-locator'},
		fetch: async (_url: string, init: {body: string}) => {
			const body = JSON.parse(init.body);
			bootstraps.push(body.sessionId);
			return response(201, success({
				sessionId: body.sessionId,
				surfaceId: body.surfaceId,
				issuedAt: clock.now().toISOString(),
				serverTime: clock.now().toISOString(),
				expiresAt: new Date(clock.value + 900000).toISOString(),
			}));
		},
		now: clock.now,
		sessionIdFactory: createIds(),
		resources: [resource],
	};
	return {owner, bridge, clock, input, sessions, bootstraps, get acquisitions() { return acquisitions; }};
}

test('one real acquire per ticket, with ordered results and no batch grant allocation', async () => {
	const f = fixture();
	const map = await f.owner.openMap(f.input);
	const batch = f.bridge.batch(map.context, Array.from({length: nativeAdmissionLimits.batchSize}, () => resource.url));
	const results = await batch.promise;
	assert.equal(f.acquisitions, nativeAdmissionLimits.batchSize);
	assert.deepEqual(results.map((result) => result.ticket), batch.tickets.map((ticket) => ticket.ticket));
	assert.ok(results.every((result) => result.kind === 'grant'));
	assert.equal(f.bootstraps.length, 1);
	await f.owner.dispose();
});

test('mixed scope results do not reuse a successful ticket or drop its neighbour', async () => {
	const f = fixture();
	const denied = {...resource, url: 'https://outside.test/world/0/0/0.pbf'};
	const map = await f.owner.openMap({...f.input, resources: [resource, denied]});
	const results = await f.bridge.batch(map.context, [resource.url, denied.url, resource.url]).promise;
	assert.deepEqual(results.map((result) => result.kind), ['grant', 'reject', 'grant']);
	assert.equal(f.acquisitions, 3);
	await f.owner.dispose();
});

test('direct contexts delegate without bootstrapping or acquiring commercial admission', async () => {
	const f = fixture({direct: true});
	const map = await f.owner.openMap(f.input);
	const results = await f.bridge.batch(map.context, [resource.url]).promise;
	assert.equal(results[0].kind, 'delegate');
	assert.equal(f.acquisitions, 0);
	assert.equal(f.bootstraps.length, 0);
	await f.owner.dispose();
});

test('expiry after acquire but before bridge delivery fails without a second acquire', async () => {
	const acquired = deferred<void>();
	const release = deferred<void>();
	const f = fixture({holdAcquire: release.promise, acquired: () => acquired.resolve()});
	const map = await f.owner.openMap(f.input);
	const batch = f.bridge.batch(map.context, [resource.url]);
	await acquired.promise;
	f.clock.advance(900000);
	release.resolve();
	const results = await batch.promise;
	assert.deepEqual(results, [{ticket: batch.tickets[0].ticket, kind: 'reject', code: 'NATIVE_ADMISSION_EXPIRED'}]);
	assert.equal(f.acquisitions, 1);
	await f.owner.dispose();
});

test('retirement during JS wait is acknowledged, idempotent and invalidates late admission', async () => {
	const acquired = deferred<void>();
	const release = deferred<void>();
	const f = fixture({holdAcquire: release.promise, acquired: () => acquired.resolve()});
	const map = await f.owner.openMap(f.input);
	const batch = f.bridge.batch(map.context, [resource.url]);
	await acquired.promise;
	const first = map.retire();
	const second = map.retire();
	assert.equal(first, second);
	assert.deepEqual(await first, {retired: true});
	release.resolve();
	assert.deepEqual(await batch.promise, []);
	assert.equal(f.bridge.completions.length, 0);
	assert.equal(f.bridge.retirements.filter((context) => context === map.context).length, 1);
	await f.owner.dispose();
});

test('cancelled tickets keep their accounting but cannot carry authority', async () => {
	const acquired = deferred<void>();
	const release = deferred<void>();
	const f = fixture({holdAcquire: release.promise, acquired: () => acquired.resolve()});
	const map = await f.owner.openMap(f.input);
	const batch = f.bridge.batch(map.context, [resource.url]);
	await acquired.promise;
	f.bridge.listener({kind: 'cancel', installation: f.bridge.installation, context: map.context, generation: map.generation, tickets: batch.tickets.map((ticket) => ticket.ticket)});
	release.resolve();
	assert.equal((await batch.promise)[0].kind, 'reject');
	assert.equal(f.acquisitions, 1);
	await f.owner.dispose();
});

test('two contexts with identical original URLs never share a controller or callbacks', async () => {
	const f = fixture();
	const first = await f.owner.openMap(f.input);
	const second = await f.owner.openMap({...f.input, sessionIdFactory: createIds('ses_other')});
	assert.notEqual(first.context, second.context);
	assert.notEqual(first.discriminateForTest(resource.url), second.discriminateForTest(resource.url));
	const results = await Promise.all([f.bridge.batch(first.context, [resource.url]).promise, f.bridge.batch(second.context, [resource.url]).promise]);
	assert.ok(results.every((batch) => batch[0].kind === 'grant'));
	assert.deepEqual(new Set(f.sessions), new Set(['ses_test_1', 'ses_other_1']));
	await first.retire();
	assert.equal((await f.bridge.batch(second.context, [resource.url]).promise)[0].kind, 'grant');
	await f.owner.dispose();
});

test('unknown and stale contexts cannot spend admission; an oversized batch retires its context', async () => {
	const f = fixture();
	const map = await f.owner.openMap(f.input);
	f.bridge.batch('unknown.1', [resource.url]);
	f.bridge.batch(map.context, [resource.url], map.generation + 1);
	assert.equal(f.acquisitions, 0);
	const oversized = f.bridge.batch(map.context, Array.from({length: nativeAdmissionLimits.batchSize + 1}, () => resource.url));
	assert.deepEqual(await oversized.promise, []);
	assert.equal(f.acquisitions, 0);
	await f.owner.dispose();
});

test('install and removal promises acknowledge actual bridge completion, including disposal during install', async () => {
	const f = fixture();
	const installed = deferred<{installation: string}>();
	const removed = deferred<{removed: boolean; ownershipLost: boolean}>();
	f.bridge.installGate = installed.promise;
	f.bridge.removeGate = removed.promise;
	const install = f.owner.install();
	const rejection = assert.rejects(install, {code: 'NATIVE_ADMISSION_CANCELLED'});
	let settled = false;
	const disposal = f.owner.dispose().then((ack) => { settled = true; return ack; });
	assert.equal(settled, false);
	installed.resolve({installation: f.bridge.installation});
	await rejection;
	assert.equal(settled, false);
	removed.resolve({removed: true, ownershipLost: false});
	assert.deepEqual(await disposal, {removed: true, ownershipLost: false});
	assert.deepEqual(f.bridge.removals, [f.bridge.installation]);
});

test('bridge errors and owner snapshots cannot expose grant material', async () => {
	const f = fixture();
	f.bridge.installGate = Promise.reject(new Error(grant));
	await assert.rejects(f.owner.install(), (error: unknown) => {
		assert.equal(String(error).includes(grant), false);
		assert.equal(JSON.stringify(error).includes(grant), false);
		return true;
	});
	assert.equal(JSON.stringify(f.owner.state).includes(grant), false);
	await f.owner.dispose();
});

test('9999/10000/10001 rotate through the real controller and bounded batch boundary', async () => {
	const f = fixture();
	const map = await f.owner.openMap(f.input);
	for (let total = 0; total < 10001;) {
		const count = Math.min(nativeAdmissionLimits.batchSize, 10001 - total);
		const results = await f.bridge.batch(map.context, Array.from({length: count}, () => resource.url)).promise;
		assert.equal(results.length, count);
		assert.ok(results.every((result) => result.kind === 'grant'));
		total += count;
	}
	assert.equal(f.acquisitions, 10001);
	assert.equal(f.sessions[9998], 'ses_test_1');
	assert.equal(f.sessions[9999], 'ses_test_1');
	assert.equal(f.sessions[10000], 'ses_test_2');
	assert.deepEqual(f.bootstraps, ['ses_test_1', 'ses_test_2']);
	await f.owner.dispose();
});

test('six-hour concurrent admission rotates once without JS timers or sleeps', async () => {
	const f = fixture();
	const map = await f.owner.openMap(f.input);
	await f.bridge.batch(map.context, [resource.url]).promise;
	f.clock.advance(6 * 60 * 60 * 1000);
	await f.bridge.batch(map.context, Array.from({length: nativeAdmissionLimits.batchSize}, () => resource.url)).promise;
	assert.equal(f.acquisitions, nativeAdmissionLimits.batchSize + 1);
	assert.deepEqual(f.sessions, ['ses_test_1', ...Array.from({length: nativeAdmissionLimits.batchSize}, () => 'ses_test_2')]);
	assert.deepEqual(f.bootstraps, ['ses_test_1', 'ses_test_2']);
	await f.owner.dispose();
});
