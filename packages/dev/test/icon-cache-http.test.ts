import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTileflowIconSetArtifact} from '../src/icon-cache';
import {renderedIcon, setFixture, withIconSetFixture} from './icon-set-fixtures';

test('decoded artifact bytes are verified when a CDN applies HTTP content encoding', async () => {
	await withIconSetFixture(async (cacheRoot) => {
		const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [20, 30, 40, 255])]);
		let calls = 0;
		const fetch: typeof globalThis.fetch = async (url, options) => {
			calls += 1;
			assert.equal(new Headers(options?.headers).get('accept-encoding'), 'identity');
			const file = artifact.files.find((candidate) => String(url).endsWith(`/${candidate.fileName}`))!;
			// Fetch exposes decoded bytes; Content-Length may still describe the compressed transfer.
			return new Response(new Uint8Array(file.source).buffer, {headers: {
				'Content-Type': file.contentType,
				'Content-Encoding': 'gzip',
				'Content-Length': String(file.source.byteLength + 17),
			}});
		};
		assert.equal((await loadTileflowIconSetArtifact(pin, {cacheRoot, fetch})).package.contentHash, artifact.contentHash);
		assert.equal(calls, 4);
	});
});

test('HTTP encoding never bypasses exact decoded-body bounds', async () => {
	await withIconSetFixture(async (cacheRoot) => {
		const {pin, artifact} = await setFixture(1, [renderedIcon('marker', [20, 30, 40, 255])]);
		const fetch: typeof globalThis.fetch = async () => new Response(new Uint8Array(artifact.files[0]!.source.byteLength + 1), {
			headers: {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': '1'},
		});
		await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, fetch}), {code: 'ICON_DOWNLOAD_FAILED'});
		await assert.rejects(loadTileflowIconSetArtifact(pin, {cacheRoot, offline: true}), {code: 'ICON_CACHE_MISS'});
	});
});
