import assert from 'node:assert/strict';
import test from 'node:test';
import type {NativeAdmissionResource} from '../src/native-admission-contract';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, createClock, createIds, credential, deferred, mapId, response, success} from './session-fixture';

const tile: NativeAdmissionResource = {
	url: 'https://tiles.tileflow.test/world/{z}/{x}/{y}.pbf',
	scope: 'tile',
	tilesetId: 'world',
	template: 'tile',
};
const style: NativeAdmissionResource = {url: `${apiOrigin}/styles/main/style.json`, scope: 'style'};

class ExtendingBridge extends AdmissionBridgeDouble {
	gate: Promise<void> | undefined;
	calls = 0;
	async extendContext(_installation: string, context: string, resources: readonly NativeAdmissionResource[]) {
		this.calls++;
		await this.gate;
		const previous = this.registrations.get(context);
		if (!previous) throw new Error('Retired context.');
		const merged = new Map(previous.resources.map((entry) => [entry.url, entry]));
		for (const entry of resources) merged.set(entry.url, entry);
		this.registrations.set(context, {...previous, resources: [...merged.values()]});
		return {resources: merged.size};
	}
}

function fixture() {
	const bridge = new ExtendingBridge();
	let requests = 0;
	const owner = createNativeAdmissionOwner({bridge});
	const input = {
		binding: {kind: 'hosted' as const, apiOrigin, credential, mapId},
		now: createClock().now,
		sessionIdFactory: createIds(),
		fetch: async (_url: string, init: {body: string}) => {
			requests++;
			const body = JSON.parse(init.body);
			return response(201, success({sessionId: body.sessionId, surfaceId: body.surfaceId}));
		},
		resources: [style],
	};
	return {bridge, owner, input, requests: () => requests};
}

test('catalogs grow only after native acknowledgement and retain original resources', async () => {
	const f = fixture();
	const first = await f.owner.openMap(f.input);
	const second = await f.owner.openMap({...f.input, sessionIdFactory: createIds('other')});
	assert.deepEqual(first.scope, {installation: f.bridge.installation, context: first.context});
	const release = deferred<void>();
	f.bridge.gate = release.promise;
	const pending = first.extendResources([tile]);
	assert.throws(() => first.discriminate(tile.url));
	await assert.rejects(first.extendResources([tile]), {code: 'NATIVE_ADMISSION_UNAVAILABLE'});
	release.resolve();
	assert.deepEqual(await pending, {resources: 2});
	assert.match(first.discriminate(tile.url), /__tf_native_context=/u);
	assert.match(first.discriminate('https://tiles.tileflow.test/world/1/0/1.pbf'), /__tf_native_context=/u);
	assert.match(first.discriminate(style.url), /__tf_native_context=/u);
	assert.throws(() => second.discriminate(tile.url));
	await assert.rejects(first.extendResources([{...tile, tilesetId: 'other'}]), {code: 'NATIVE_ADMISSION_INVALID'});
	assert.deepEqual(await first.extendResources([tile]), {resources: 2});
	assert.equal(f.requests(), 0);
	await f.owner.dispose();
});

test('concrete template tickets each acquire independently and preserve ticket order', async () => {
	const f = fixture();
	const map = await f.owner.openMap({...f.input, resources: [tile]});
	const result = await f.bridge.batch(map.context, [
		'https://tiles.tileflow.test/world/1/0/0.pbf',
		'https://tiles.tileflow.test/world/1/0/1.pbf',
	]).promise;
	assert.deepEqual(result.map((item) => item.kind), ['grant', 'grant']);
	assert.notEqual(result[0].ticket, result[1].ticket);
	assert.equal(f.requests(), 1);
	await f.owner.dispose();
});

test('uncertain extension is retryable, but a late acknowledgement cannot revive a context', async () => {
	const f = fixture();
	const map = await f.owner.openMap(f.input);
	f.bridge.gate = Promise.reject(new Error('Untrusted native failure.'));
	await assert.rejects(map.extendResources([tile]), {code: 'NATIVE_ADMISSION_UNAVAILABLE'});
	f.bridge.gate = undefined;
	assert.deepEqual(await map.extendResources([tile]), {resources: 2});
	const release = deferred<void>();
	f.bridge.gate = release.promise;
	const pending = map.extendResources([{url: `${apiOrigin}/styles/other/style.json`, scope: 'style'}]);
	const rejected = assert.rejects(pending, {code: 'NATIVE_ADMISSION_CANCELLED'});
	await map.retire();
	release.resolve();
	await rejected;
	assert.throws(() => map.discriminate(style.url));
	await f.owner.dispose();
});

test('ambiguous template matches fail closed before bootstrapping', async () => {
	const f = fixture();
	const map = await f.owner.openMap({...f.input, resources: [tile, {
		url: 'https://tiles.tileflow.test/world/1/0/0.pbf', scope: 'tile', tilesetId: 'world',
	}]});
	assert.deepEqual(await f.bridge.batch(map.context, ['https://tiles.tileflow.test/world/1/0/0.pbf']).promise, []);
	assert.equal(f.requests(), 0);
	await f.owner.dispose();
});
