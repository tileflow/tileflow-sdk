import assert from 'node:assert/strict';
import test from 'node:test';
import {
	resolveTileflowRuntimeStyle,
	shouldLoadTileflowManifest,
	validateTileflowRuntimeSource,
	type TileflowRuntimeSource,
} from '../src/runtime';
import {createTileflowNativeSourceController} from '../src/native-source-controller';
import type {TileflowNativeManifestAcquire, TileflowNativeSource} from '../src/native-source-types';

const manifestUrl = 'https://maps.example.test/tileflow/manifest.json';
const manifest = {
	version: 1,
	maps: {
		main: {
			defaultTheme: 'day',
			systemThemes: {dark: 'night', light: 'day'},
			themes: {
				day: {colorScheme: 'light', styleUrl: './day.json'},
				night: {colorScheme: 'dark', styleUrl: './night.json'},
			},
		},
	},
};

function acquisition() {
	const urls: string[] = [];
	const acquire: TileflowNativeManifestAcquire = (url) => {
		urls.push(url);
		let read = false;
		const bytes = new TextEncoder().encode(JSON.stringify(manifest));
		return {
			cancel() {},
			response: Promise.resolve({url, status: 200, reader: {
				async read(maximumBytes) {
					assert.ok(bytes.length <= maximumBytes);
					if (read) return {done: true as const};
					read = true;
					return {done: false as const, value: bytes};
				},
				cancel() {},
			}}),
		};
	};
	return {urls, acquire};
}

test('browser Map sources contain only the existing map and manifest fields', () => {
	for (const source of [{map: 'main'}, {map: 'main', manifestUrl: '/custom/manifest.json'}]) {
		assert.deepEqual(validateTileflowRuntimeSource(source), {ok: true});
		assert.equal(shouldLoadTileflowManifest({source: source as TileflowRuntimeSource}), true);
		assert.equal(resolveTileflowRuntimeStyle({source: source as TileflowRuntimeSource}), null);
	}
	for (const source of [
		{kind: 'tileflow', map: 'main'},
		{kind: 'maplibre', style: '/style.json'},
		{map: 'main', style: '/style.json'},
		{map: 'main', kind: undefined},
		{map: 'Main'},
		{map: 'con'},
		{map: 'main', manifestUrl: ''},
	]) {
		assert.equal(validateTileflowRuntimeSource(source).ok, false);
		assert.throws(() => resolveTileflowRuntimeStyle({source: source as unknown as TileflowRuntimeSource}), TypeError);
	}
});

test('native source resolution retains explicit URLs and themes without renderer state', async () => {
	const fetch = acquisition();
	const controller = createTileflowNativeSourceController({acquire: fetch.acquire});
	await controller.replace({map: 'main', manifestUrl} as TileflowNativeSource, {theme: 'system', colorScheme: 'dark'});
	assert.equal(controller.state?.status, 'ready');
	const ready = controller.state;
	assert.ok(ready && ready.status === 'ready');
	assert.equal(Object.hasOwn(ready, 'kind'), false);
	assert.deepEqual(ready.source, {map: 'main', manifestUrl});
	assert.equal('theme' in ready && ready.theme.name, 'night');
	assert.equal('theme' in ready && ready.theme.styleUrl, 'https://maps.example.test/tileflow/night.json');
	assert.deepEqual(fetch.urls, [manifestUrl]);
	controller.dispose();
});

test('native legacy or direct renderer sources fail before acquisition', async () => {
	for (const source of [
		{kind: 'tileflow', map: 'main', manifestUrl},
		{kind: 'maplibre', style: 'https://maps.example.test/style.json'},
		{map: 'main', manifestUrl, style: {version: 8, sources: {}, layers: []}},
		{map: 'main', manifestUrl, kind: undefined},
		{map: 'main'},
	]) {
		const fetch = acquisition();
		const controller = createTileflowNativeSourceController({acquire: fetch.acquire});
		await controller.replace(source as unknown as TileflowNativeSource);
		assert.equal(controller.state?.status, 'error');
		assert.deepEqual(fetch.urls, []);
		controller.dispose();
	}
});
