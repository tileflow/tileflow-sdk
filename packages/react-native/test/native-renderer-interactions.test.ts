import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner} from '../src/native-renderer-owner';
import type {NativeSurfaceEvent} from '../src/native-surface-contract';

function target(name = 'light', generation = 1) {
	const map = {name: 'main', defaultTheme: 'light', themes: {
		light: {colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
	}};
	return {
		source: {
			status: 'ready', generation, map,
			source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
			manifest: {version: 1, maps: {main: map}},
			manifestUrl: 'https://maps.example.test/manifest.json',
			theme: {name, colorScheme: 'light', styleUrl: `https://maps.example.test/${name}.json`},
		} as Extract<TileflowNativeSourceState, {status: 'ready'}>,
		style: {version: 8, sources: {}, layers: []},
	};
}
function fixture() {
	let receive: (event: NativeSurfaceEvent) => void = () => undefined;
	let sequence = 0;
	const owner = createNativeRendererOwner('map', target(), {}, {
		emit() {}, changed() {}, interactionsChanged() {},
		surfaces: {
			async attach(_root, notify) {
				receive = notify;
				return {
					id: 'surface', async expectStyle() {}, async commitLayout() { return 1; },
					async requestFrame() {}, async applyCamera(command, view) { return {command, view}; },
					async cancelCamera() { return {cancelled: true as const}; }, async retire() {},
				};
			},
			async retireRoot() {},
		},
	});
	return {owner, emit(style = owner.token, surface = 'surface') {
		receive({kind: 'style', style, surface, sequence: ++sequence, layout: 1});
	}};
}

test('JS mounting and mismatched native receipts never publish an exact-style proof', async () => {
	const f = fixture();
	assert.equal(f.owner.getInteractionStyle(), undefined);
	await f.owner.attach(1);
	await f.owner.whenIdle();
	assert.equal(f.owner.getInteractionStyle(), undefined);
	f.emit('wrong-style');
	f.emit(f.owner.token, 'wrong-map');
	assert.equal(f.owner.getInteractionStyle(), undefined);
	f.emit();
	const proof = f.owner.getInteractionStyle()!;
	assert.equal(proof.style, f.owner.snapshot.style);
	assert.equal(proof.token, f.owner.token);
	assert.equal(proof.isCurrent(), true);
	await f.owner.dispose();
	assert.equal(proof.isCurrent(), false);
});

test('theme replacement, background and unmount permanently retire old proofs', async () => {
	const f = fixture();
	await f.owner.attach(1);
	await f.owner.whenIdle();
	f.emit();
	await f.owner.whenIdle();
	const first = f.owner.getInteractionStyle()!;
	f.owner.preload(2);
	assert.equal(first.isCurrent(), false);
	assert.equal(f.owner.getInteractionStyle(), undefined);
	f.owner.setTarget(target('other', 2));
	await f.owner.whenIdle();
	f.emit();
	await f.owner.whenIdle();
	const second = f.owner.getInteractionStyle()!;
	assert.equal(second.key, first.key);
	assert.notEqual(second.token, first.token);
	f.owner.background();
	assert.equal(second.isCurrent(), false);
	f.owner.resume();
	await f.owner.whenIdle();
	assert.equal(second.isCurrent(), false);
	const resumed = f.owner.getInteractionStyle()!;
	assert.equal(resumed.isCurrent(), true);
	await f.owner.dispose();
	assert.equal(resumed.isCurrent(), false);
});
