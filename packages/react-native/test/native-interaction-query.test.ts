import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativePoiAdapter, nativePoiQueryLimit} from '../src/native-interaction-poi';
import {createNativeInteractionQuery} from '../src/native-interaction-query';
import {barrier, poiBinding, poiStyle, touch} from './native-interaction-fixture';

export function finalizedStyle() {
	const style = poiStyle();
	const manifest = style.metadata['tileflow:interaction-manifest'].domains.poi.layers;
	style.layers = [...style.layers].reverse();
	for (const layer of manifest) {
		layer.priority = style.layers.findIndex((physical) => physical.id === layer.layerId);
	}
	return style;
}
const hit = (id: number) => ({type: 'Feature', id, properties: {name: `Place ${id}`}});

test('single-layer filters reconstruct exact provenance and preserve layer and hit order', async () => {
	const style = finalizedStyle();
	const calls: {point: readonly number[]; layers: readonly string[]}[] = [];
	const port = createNativeInteractionQuery(style, () => true, async (point, options) => {
		calls.push({point, layers: options.layers});
		return options.layers[0] === 'food-label' ? [hit(7), hit(8)] : [hit(9)];
	});
	const request = {point: touch.point, layers: ['food-label', 'food-icon', 'hotel'], limit: 512};
	const result = await port.lease.query(request).result as {request: unknown; features: unknown[]};
	assert.equal(result.request, request);
	assert.deepEqual(calls.map((call) => call.layers), [['food-label'], ['food-icon'], ['hotel']]);
	assert.ok(calls.every((call) => call.point[0] === 10 && call.point[1] === 20));
	assert.deepEqual(result.features, [
		{id: 7, properties: {name: 'Place 7'}, layer: {id: 'food-label'}, source: 'world', sourceLayer: 'poi'},
		{id: 8, properties: {name: 'Place 8'}, layer: {id: 'food-label'}, source: 'world', sourceLayer: 'poi'},
		{id: 9, properties: {name: 'Place 9'}, layer: {id: 'food-icon'}, source: 'world', sourceLayer: 'poi'},
		{id: 9, properties: {name: 'Place 9'}, layer: {id: 'hotel'}, source: 'world', sourceLayer: 'poi'},
	]);
	const adapter = createNativePoiAdapter();
	assert.deepEqual(adapter.replaceStyle(port.lease), []);
	const selected = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(selected.status, 'match');
	if (selected.status === 'match') assert.equal(selected.match.target.feature.id, 7);
});

test('the composed global feature bound rejects overflow, including later layers', async () => {
	let calls = 0;
	const port = createNativeInteractionQuery(finalizedStyle(), () => true, async () => {
		calls++;
		return Array.from({length: calls === 1 ? nativePoiQueryLimit : 1}, (_, index) => hit(index));
	});
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(port.lease);
	const result = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(result.status, 'error');
	assert.equal(result.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
	assert.equal(calls, 2);
});

test('exactly 512 hits are accepted only after all remaining layers are checked', async () => {
	let calls = 0;
	const port = createNativeInteractionQuery(finalizedStyle(), () => true, async () => {
		calls++;
		return calls === 1 ? Array.from({length: 512}, (_, index) => hit(index)) : [];
	});
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(port.lease);
	assert.equal((await adapter.queryTouch(touch, [poiBinding])).status, 'match');
	assert.equal(calls, 3);
});

test('newer touch settles an older query stale before its upstream promise completes', async () => {
	const pending = barrier<unknown>();
	let calls = 0;
	const port = createNativeInteractionQuery(finalizedStyle(), () => true, async () => {
		calls++;
		return calls === 1 ? pending.promise : [];
	});
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(port.lease);
	const first = adapter.queryTouch(touch, [poiBinding]);
	await Promise.resolve();
	const second = adapter.queryTouch(touch, [poiBinding]);
	assert.equal((await first).status, 'stale');
	assert.equal((await second).status, 'miss');
	const issued = calls;
	pending.resolve([hit(1)]);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(calls, issued);
});

test('style retirement settles immediately and makes late results inert', async () => {
	const pending = barrier<unknown>();
	let calls = 0;
	const port = createNativeInteractionQuery(finalizedStyle(), () => true, () => {
		calls++;
		return pending.promise;
	});
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(port.lease);
	const query = adapter.queryTouch(touch, [poiBinding]);
	await Promise.resolve();
	port.retire();
	assert.equal(port.lease.isCurrent(), false);
	assert.equal((await query).status, 'stale');
	pending.resolve([hit(1)]);
	await Promise.resolve();
	assert.equal(calls, 1);
});

test('ownership is rechecked after each upstream promise, before issuing another layer', async () => {
	let current = true;
	let calls = 0;
	const port = createNativeInteractionQuery(finalizedStyle(), () => current, async () => {
		calls++;
		current = false;
		return [hit(1)];
	});
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(port.lease);
	assert.equal((await adapter.queryTouch(touch, [poiBinding])).status, 'stale');
	assert.equal(calls, 1);
});

test('undeclared, duplicate, wrong-order and mismatched physical layers never reach native queries', async () => {
	let calls = 0;
	const style = finalizedStyle();
	const port = createNativeInteractionQuery(style, () => true, async () => { calls++; return []; });
	for (const layers of [['undeclared'], ['food-label', 'food-label'], ['hotel', 'food-label']]) {
		await assert.rejects(port.lease.query({point: touch.point, layers, limit: 512}).result);
	}
	const wrong = finalizedStyle();
	wrong.layers.find((layer) => layer.id === 'food-label')!.source = 'different';
	const invalid = createNativeInteractionQuery(wrong, () => true, async () => { calls++; return []; });
	await assert.rejects(invalid.lease.query({point: touch.point, layers: ['food-label'], limit: 512}).result);
	assert.equal(calls, 0);
});

test('malformed hits and raw native errors produce only bounded diagnostics', async () => {
	for (const query of [async () => ({}), async () => { throw new Error('private transport detail'); }]) {
		const port = createNativeInteractionQuery(finalizedStyle(), () => true, query);
		const adapter = createNativePoiAdapter();
		adapter.replaceStyle(port.lease);
		const result = await adapter.queryTouch(touch, [poiBinding]);
		assert.equal(result.status, 'error');
		assert.equal(result.diagnostics[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
		assert.doesNotMatch(JSON.stringify(result), /private transport detail/);
	}
});

test('retiring one map does not cancel another map or share its physical attribution', async () => {
	const left = createNativeInteractionQuery(finalizedStyle(), () => true, async () => [hit(1)]);
	const right = createNativeInteractionQuery(finalizedStyle(), () => true, async () => [hit(2)]);
	left.retire();
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(right.lease);
	const result = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(result.status, 'match');
	if (result.status === 'match') assert.equal(result.match.target.feature.id, 2);
});
