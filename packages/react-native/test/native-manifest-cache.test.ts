import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowNativeSourceController} from '@tileflow/core/native';
import {createNativeManifestCache} from '../src/native-manifest-cache';
import type {TileflowNativeManifestAcquire} from '@tileflow/core/native';

function fixture() {
	let calls = 0;
	const body = new TextEncoder().encode(JSON.stringify({version: 1, maps: {main: {
		defaultTheme: 'light', systemThemes: {light: 'light', dark: 'dark'},
		themes: {light: {colorScheme: 'light', styleUrl: './light.json'}, dark: {colorScheme: 'dark', styleUrl: './dark.json'}},
	}}}));
	const acquire: TileflowNativeManifestAcquire = (url) => {
		calls++;
		let offset = 0;
		let cancelled = false;
		return {
			response: Promise.resolve({url, status: 200, reader: {
				async read(maximumBytes) {
					if (cancelled) throw new Error('Cancelled.');
					if (offset === body.length) return {done: true};
					const value = body.slice(offset, offset + maximumBytes); offset += value.length;
					return {done: false, value};
				},
				cancel() { cancelled = true; },
			}}),
			cancel() { cancelled = true; },
		};
	};
	return {acquire, calls: () => calls};
}

test('real Core theme and system selection reuse a complete manifest only within one Map', async () => {
	const f = fixture();
	const cache = createNativeManifestCache(f.acquire);
	const controller = createTileflowNativeSourceController({acquire: cache.acquire});
	const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
	await controller.replace(source);
	await controller.replace(source, {theme: 'dark'});
	await controller.replace(source, {theme: 'system', colorScheme: 'light'});
	assert.equal(controller.state?.status, 'ready');
	assert.equal(f.calls(), 1);
	const other = createTileflowNativeSourceController({acquire: createNativeManifestCache(f.acquire).acquire});
	await other.replace(source);
	assert.equal(f.calls(), 2);
	cache.clear();
	await controller.replace(source);
	assert.equal(f.calls(), 3);
	controller.dispose(); other.dispose(); cache.clear();
});

test('changing the manifest identity drops cached bytes and retired readers cannot populate it', async () => {
	const f = fixture();
	const cache = createNativeManifestCache(f.acquire);
	const first = cache.acquire('https://maps.example.test/one.json', {maximumBytes: 1048576});
	const response = await first.response;
	await first.cancel();
	await assert.rejects(response.reader.read(64));
	const controller = createTileflowNativeSourceController({acquire: cache.acquire});
	await controller.replace({map: 'main', manifestUrl: 'https://maps.example.test/one.json'});
	await controller.replace({map: 'main', manifestUrl: 'https://maps.example.test/two.json'});
	assert.equal(f.calls(), 3);
	controller.dispose(); cache.clear();
});
