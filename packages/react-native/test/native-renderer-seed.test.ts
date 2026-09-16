import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner} from '../src/native-renderer-owner';

const source = {
	status: 'ready', generation: 1, source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
	map: {name: 'main', view: {center: [12, 34], zoom: 6, bearing: 7, pitch: 8}},
	theme: {name: 'light', colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
} as Extract<TileflowNativeSourceState, {status: 'ready'}>;

test('the native camera seed is immutable and mount-stable across later initial props', async () => {
	const owner = createNativeRendererOwner('renderer', {source, style: {version: 8, sources: {}, layers: []}}, {initialView: {zoom: 9}}, {
		surfaces: {async attach() { throw new Error('Not attached.'); }, async retireRoot() {}}, emit() {}, changed() {},
	});
	const seed = owner.initialView;
	assert.deepEqual(seed, {center: [12, 34], zoom: 9, bearing: 7, pitch: 8});
	assert.ok(Object.isFrozen(seed)); assert.ok(Object.isFrozen(seed.center));
	owner.afterCommit({initialView: {zoom: 13}});
	assert.equal(owner.initialView, seed);
	assert.deepEqual(owner.snapshot.style.sources, {});
	await owner.dispose();
});
