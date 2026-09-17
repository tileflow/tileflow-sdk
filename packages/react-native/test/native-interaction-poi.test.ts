import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativePoiAdapter, nativePoiQueryLimit} from '../src/native-interaction-poi';
import {barrier, poiBinding, poiFeature, poiStyle, queryFixture, touch} from './native-interaction-fixture';

 test('queries only declared relevant layers and returns semantic targets without physical identities', async () => {
	const native = queryFixture();
	native.setFeatures([poiFeature(90, 'undeclared'), poiFeature(7, 'food-label'), poiFeature(8, 'hotel'), poiFeature(7, 'food-icon', {name: 'Preferred icon'})]);
	const adapter = createNativePoiAdapter();
	assert.deepEqual(adapter.replaceStyle(native.lease), []);
	const result = await adapter.queryTouch(touch, [{...poiBinding, target: {kind: 'semantic-feature', domain: 'poi', categories: ['food-drink']}}]);
	assert.equal(result.status, 'match');
	if (result.status !== 'match') assert.fail();
	assert.equal(result.match.target.feature.id, 7);
	assert.deepEqual(result.match.target.feature.properties, {name: 'Preferred icon'});
	assert.equal(result.match.target.feature.category, 'food-drink');
	assert.equal(result.match.target.bindingId, 'places');
	assert.deepEqual(result.match.target.coordinate, [1, 2]);
	assert.deepEqual(native.requests[0]?.layers, ['food-label', 'food-icon']);
	assert.equal(native.requests[0]?.limit, nativePoiQueryLimit);
	assert.doesNotMatch(JSON.stringify(result.match.target), /food-icon|food-label|world|sourceLayer|layerId/u);
	assert.ok(Object.isFrozen(result.match.target.feature.properties));
	adapter.dispose();
});

test('rendered order wins between identities and numeric and string IDs stay distinct', async () => {
	const native = queryFixture();
	const adapter = createNativePoiAdapter();
	adapter.replaceStyle(native.lease);
	native.setFeatures([poiFeature('7', 'food-label', {name: 'String'}), poiFeature(7, 'food-icon', {name: 'Number'})]);
	const result = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(result.status, 'match');
	if (result.status !== 'match') assert.fail();
	assert.equal(result.match.target.feature.id, '7');
	assert.equal(result.match.target.feature.properties.name, 'String');
	adapter.dispose();
});

test('metadata version fields namespaces and every declared physical layer are verified transactionally', async () => {
	const mutations: Array<(style: ReturnType<typeof poiStyle>) => void> = [
		(style) => { style.metadata['tileflow:interaction-manifest'].version = 1; },
		(style) => { style.metadata['tileflow:interaction-manifest'].version = 3; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.identity = 'properties-id'; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.deduplication.identity.reverse(); },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.deduplication.representationPriority = ['icon', 'icon', 'label', 'marker']; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.hitTesting.order = 'source'; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.fields.name = '__proto__'; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.layers[0]!.layerId = 'missing'; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.layers[0]!.category = 'not-a-category'; },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.layers[0]!.sourceLayer = 'another-namespace'; style.layers[0]!['source-layer'] = 'another-namespace'; },
		(style) => { style.layers[0]!.source = 'another-source'; },
		(style) => { style.layers.push({...style.layers[0]!}); },
		(style) => { style.metadata['tileflow:interaction-manifest'].domains.poi.layers.push({...style.metadata['tileflow:interaction-manifest'].domains.poi.layers[0]!}); },
	];
	for (const mutate of mutations) {
		const style = poiStyle(); mutate(style);
		const native = queryFixture(style);
		const adapter = createNativePoiAdapter();
		assert.equal(adapter.replaceStyle(native.lease)[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
		assert.equal((await adapter.queryTouch(touch, [poiBinding])).status, 'error');
		assert.deepEqual(native.requests, []);
		adapter.dispose();
	}
	for (const style of [{}, null, {version: 8, layers: [], metadata: {}}]) {
		const adapter = createNativePoiAdapter();
		assert.equal(adapter.replaceStyle(queryFixture(style).lease)[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
		adapter.dispose();
	}
});

test('feature source mismatch fails closed and unsafe properties are not evaluated or forwarded', async () => {
	const native = queryFixture();
	const adapter = createNativePoiAdapter(); adapter.replaceStyle(native.lease);
	for (const feature of [
		{...poiFeature(), source: 'foreign'},
		{...poiFeature(), source: undefined},
		{...poiFeature(), sourceLayer: 'foreign'},
	]) {
		native.setFeatures([feature, poiFeature(2)]);
		const result = await adapter.queryTouch(touch, [poiBinding]);
		assert.equal(result.status, 'error');
		assert.equal(result.diagnostics[0]?.code, 'SEMANTIC_MANIFEST_MISMATCH');
	}
	let reads = 0;
	const properties = Object.defineProperty({
		category: 'food-drink', filter_rank: 3, size_rank: 17, icon: 'coffee_shop', type: 'not safe', private: 'native-only',
	}, 'name', {enumerable: true, get() { reads++; throw new Error('secret'); }});
	native.setFeatures([poiFeature(1, 'food-icon', properties)]);
	const result = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(result.status, 'match');
	if (result.status !== 'match') assert.fail();
	assert.deepEqual(result.match.target.feature.properties, {category: 'food-drink', filter_rank: 3, icon: 'coffee_shop'});
	assert.equal(reads, 0);
	adapter.dispose();
});

test('missing feature identity is not invented, query payloads are bounded, and activation is touch only', async () => {
	const native = queryFixture();
	const adapter = createNativePoiAdapter(); adapter.replaceStyle(native.lease);
	for (const id of [null, '', 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, 'a'.repeat(129)]) {
		native.setFeatures([poiFeature(id)]);
		const result = await adapter.queryTouch(touch, [poiBinding]);
		assert.equal(result.status, 'match');
		if (result.status !== 'match') assert.fail();
		assert.equal(result.match.target.feature.id, undefined);
	}
	native.setFeatures(Array.from({length: nativePoiQueryLimit + 1}, (_, id) => poiFeature(id)));
	const overflow = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(overflow.status, 'error');
	assert.equal(overflow.diagnostics[0]?.code, 'LIMIT_EXCEEDED');
	const count = native.requests.length;
	for (const inputModality of ['pointer', 'keyboard', 'programmatic', 'hover', 'long-press']) {
		const result = await adapter.queryTouch({...touch, inputModality}, [poiBinding]);
		assert.equal(result.diagnostics[0]?.code, 'UNSUPPORTED_MODE');
	}
	assert.equal(native.requests.length, count);
	assert.equal((await adapter.queryTouch({...touch, point: [NaN, 0]}, [poiBinding])).status, 'error');
	adapter.dispose();
});

test('replacement and disposal settle cancelled queries without waiting for late native completion', async () => {
	const old = queryFixture();
	const late = barrier<unknown>();
	let cancelled = 0;
	old.setQuery(() => ({result: late.promise, cancel() { cancelled++; }}));
	const adapter = createNativePoiAdapter(); adapter.replaceStyle(old.lease);
	const pending = adapter.queryTouch(touch, [poiBinding]);
	const replacement = queryFixture(); replacement.setFeatures([poiFeature(2)]);
	adapter.replaceStyle(replacement.lease);
	assert.equal((await pending).status, 'stale');
	assert.equal(cancelled, 1);
	late.resolve({request: old.requests[0], features: [poiFeature(1)]});
	assert.equal((await adapter.queryTouch(touch, [poiBinding])).status, 'match');
	const never = barrier<unknown>();
	replacement.setQuery(() => ({result: never.promise, cancel() { cancelled++; }}));
	const disposed = adapter.queryTouch(touch, [poiBinding]);
	adapter.dispose(); adapter.dispose();
	assert.equal((await disposed).status, 'stale');
	assert.equal(cancelled, 2);
	never.reject(new Error('private native failure'));
});

test('latest touch and other-map receipts cannot satisfy a current query', async () => {
	const native = queryFixture(); const other = queryFixture();
	const adapter = createNativePoiAdapter(); const second = createNativePoiAdapter();
	adapter.replaceStyle(native.lease); second.replaceStyle(other.lease);
	const firstResult = barrier<unknown>();
	native.setQuery(() => ({result: firstResult.promise, cancel() {}}));
	const first = adapter.queryTouch(touch, [poiBinding]);
	const nextResult = barrier<unknown>();
	native.setQuery(() => ({result: nextResult.promise, cancel() {}}));
	const next = adapter.queryTouch(touch, [poiBinding]);
	assert.equal((await first).status, 'stale');
	await second.queryTouch(touch, [poiBinding]);
	nextResult.resolve({request: other.requests[0], features: [poiFeature(3)]});
	assert.equal((await next).status, 'error');
	firstResult.resolve({request: native.requests[0], features: [poiFeature(1)]});
	adapter.dispose(); second.dispose();
});

test('current-style ownership and native failures are checked again after asynchronous results', async () => {
	const native = queryFixture(); const adapter = createNativePoiAdapter();
	adapter.replaceStyle(native.lease);
	const result = barrier<unknown>();
	native.setQuery(() => ({result: result.promise, cancel() { throw new Error('private'); }}));
	const pending = adapter.queryTouch(touch, [poiBinding]);
	native.retire(); result.resolve({request: native.requests[0], features: [poiFeature(1)]});
	assert.equal((await pending).status, 'stale');
	const broken = queryFixture();
	broken.setQuery(() => { throw new Error('https://native.example.test/secret'); });
	adapter.replaceStyle(broken.lease);
	const failed = await adapter.queryTouch(touch, [poiBinding]);
	assert.equal(failed.status, 'error');
	assert.doesNotMatch(JSON.stringify(failed), /https:|secret|native.example/u);
	adapter.dispose();
});
