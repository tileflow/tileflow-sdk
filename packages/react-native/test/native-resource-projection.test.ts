import assert from 'node:assert/strict';
import test from 'node:test';
import {projectNativeResources} from '../src/native-resource-projection';
import type {NativeAdmissionResource} from '../src/native-admission-contract';
import {apiOrigin, mapId} from './session-fixture';

const styleUrl = `${apiOrigin}/maps/${mapId}/light.json`;
const policy = Object.freeze({
	mapId, resourceOrigins: [apiOrigin, 'https://tiles.tileflow.test'],
	resourceScopes: ['style', 'tilejson', 'tile', 'sprite', 'glyph', 'font'] as const,
	tilesetIds: ['world'],
});
function fixture(style: Record<string, unknown>, tileJson: Record<string, unknown> = {}) {
	const calls: string[] = [];
	const accepted = new Map<string, NativeAdmissionResource>();
	const documents: Record<string, Record<string, unknown>> = {
		[styleUrl]: style,
		[`${apiOrigin}/tiles/world/tiles.json`]: tileJson,
	};
	const ports = {
		policy, styleUrl,
		current: () => true,
		async accept(resources: readonly NativeAdmissionResource[]) {
			for (const resource of resources) accepted.set(resource.url, resource);
		},
		discriminate(url: string) { return `${url}${url.includes('?') ? '&' : '?'}__tf_native_context=one`; },
		async read(url: string, _maximumBytes: number, resource: NativeAdmissionResource | null) {
			if (resource) assert.ok(accepted.has(url), 'Admission must precede document acquisition.');
			calls.push(url);
			const value = documents[url];
			assert.ok(value, 'Expected a declared document.');
			return {url, value: JSON.parse(JSON.stringify(value)), bytes: JSON.stringify(value).length};
		},
	};
	return {ports, calls, accepted};
}

test('projects exact style TileJSON tile sprite glyph and font closure without a second document fetch', async () => {
	const source = {
		version: 8,
		sources: {
			first: {type: 'vector', url: '/tiles/world/tiles.json'},
			second: {type: 'vector', url: '/tiles/world/tiles.json'},
		},
		layers: [{id: 'label', type: 'symbol', source: 'first', 'source-layer': 'place', layout: {'text-field': 'A', 'text-font': ['Noto Sans Regular']}}],
		sprite: '/sprites/icp_example/sprite?revision=one',
		glyphs: '/fonts/{fontstack}/{range}.pbf',
		'font-faces': {'Noto Sans Regular': '/fonts/fb_example/regular.ttf'},
	};
	const before = JSON.stringify(source);
	const f = fixture(source, {tilejson: '3.0.0', tiles: ['https://tiles.tileflow.test/tiles/world/release/{z}/{x}/{y}.pbf?revision=one'], minzoom: 0, maxzoom: 14});
	const result = await projectNativeResources(f.ports);
	assert.deepEqual(f.calls, [styleUrl, `${apiOrigin}/tiles/world/tiles.json`]);
	const sources = result.style.sources as Record<string, Record<string, unknown>>;
	assert.equal(sources.first.url, undefined);
	assert.equal(sources.first.maxzoom, 14);
	assert.match((sources.first.tiles as string[])[0], /revision=one&__tf_native_context=one$/u);
	assert.deepEqual(sources.first.tiles, sources.second.tiles);
	assert.match(String(result.style.sprite), /revision=one&__tf_native_context=one$/u);
	assert.ok(f.accepted.has(`${apiOrigin}/sprites/icp_example/sprite@2x.png?revision=one`));
	assert.ok(f.accepted.has(`${apiOrigin}/sprites/icp_example/sprite.json?revision=one`));
	assert.equal(f.accepted.get(`${apiOrigin}/fonts/{fontstack}/{range}.pbf`)!.template, 'glyphs');
	assert.deepEqual(f.accepted.get(`${apiOrigin}/fonts/{fontstack}/{range}.pbf`)!.fontStacks, ['Noto Sans Regular']);
	assert.equal(JSON.stringify(source), before);
	assert.ok(Object.isFrozen(result.style));
});

test('foreign resources retain all URL identity without receiving authority', async () => {
	const url = 'https://outside.example.test/{z}/{x}/{y}.pbf?x=%2F&x=2';
	const f = fixture({version: 8, sources: {foreign: {type: 'vector', tiles: [url]}}, layers: [], sprite: 'https://outside.example.test/sprite?x=2'});
	const result = await projectNativeResources(f.ports);
	assert.deepEqual((result.style.sources as Record<string, Record<string, unknown>>).foreign.tiles, [url]);
	assert.equal(result.style.sprite, 'https://outside.example.test/sprite?x=2');
	assert.deepEqual([...f.accepted.keys()], [styleUrl]);
});

test('owned origin does not authorize unknown paths other Maps or foreign tilesets', async () => {
	for (const tiles of [
		[`${apiOrigin}/admin/{z}/{x}/{y}.pbf`],
		[`${apiOrigin}/tiles/other/{z}/{x}/{y}.pbf`],
		[`${apiOrigin}/tiles/world/{z}/{x}/{y}.pbf?__tf_native_context=foreign`],
	]) {
		const f = fixture({version: 8, sources: {bad: {type: 'vector', tiles}}, layers: []});
		await assert.rejects(projectNativeResources(f.ports), {message: 'Native style preparation failed.'});
	}
	const f = fixture({version: 8, sources: {}, layers: []});
	await assert.rejects(projectNativeResources({...f.ports, styleUrl: `${apiOrigin}/maps/map_fedcba9876543210/light.json`}));
	assert.deepEqual(f.calls, []);
});

test('rejects recursive ambiguous oversized or dynamically unbounded graph inputs', async () => {
	for (const source of [
		{type: 'vector', url: '/tiles/world/tiles.json', tiles: ['/tiles/world/{z}/{x}/{y}.pbf']},
		{type: 'video', urls: ['https://outside.example.test/movie.mp4']},
	]) {
		const f = fixture({version: 8, sources: {bad: source}, layers: []});
		await assert.rejects(projectNativeResources(f.ports));
	}
	const f = fixture({version: 8, sources: {bad: {type: 'vector', url: '/tiles/world/tiles.json'}}, layers: []}, {url: '/tiles/world/tiles.json'});
	await assert.rejects(projectNativeResources(f.ports));
	const dynamic = fixture({version: 8, sources: {}, glyphs: '/fonts/{fontstack}/{range}.pbf', layers: [
		{id: 'bad', type: 'symbol', layout: {'text-field': 'A', 'text-font': ['get', 'font']}},
	]});
	await assert.rejects(projectNativeResources(dynamic.ports));
});

test('non-session projection never creates a protected catalog or context discriminator', async () => {
	const f = fixture({version: 8, sources: {tiles: {type: 'vector', tiles: ['/tiles/world/{z}/{x}/{y}.pbf']}}, layers: []});
	const result = await projectNativeResources({...f.ports, policy: null,
		accept: async () => { throw new Error('Unexpected admission.'); },
		discriminate: () => { throw new Error('Unexpected context.'); },
	});
	assert.equal(JSON.stringify(result.style).includes('__tf_native'), false);
	assert.deepEqual(result.resources, []);
});
