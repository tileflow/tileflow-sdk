import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import {createNativeRendererOwner, type NativeRendererEvent} from '../src/native-renderer-owner';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';

test('a current style accepted while backgrounded becomes usable only after resume and a new native barrier', async () => {
	const events: NativeRendererEvent[] = [];
	let listener!: (event: NativeSurfaceEvent) => void;
	let commands = 0;
	const surface: NativeSurface = {
		id: 'surface', async expectStyle() {}, async commitLayout() { return 2; }, async requestFrame() {},
		async applyCamera(command, view) { commands++; return {command, view}; },
		async cancelCamera() { return {cancelled: true}; }, async retire() {},
	};
	const source = {status: 'ready', generation: 1, map: {name: 'main'},
		source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'},
		theme: {name: 'light', colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'},
	} as Extract<TileflowNativeSourceState, {status: 'ready'}>;
	const owner = createNativeRendererOwner('renderer', {source, style: {version: 8, sources: {}, layers: []}}, {}, {
		surfaces: {async attach(_root, notify) { listener = notify; return surface; }, async retireRoot() {}},
		emit: (event) => events.push(event), changed() {},
	});
	await owner.attach(1); await owner.whenIdle();
	owner.background();
	listener({surface: 'surface', style: owner.token, sequence: 1, layout: 1, kind: 'style'});
	listener({surface: 'surface', style: owner.token, sequence: 2, layout: 1, kind: 'render'});
	await owner.whenIdle();
	assert.equal(commands, 0);
	assert.equal(events.some((event) => event.type === 'load'), false);
	owner.resume(); await owner.whenIdle();
	assert.equal(commands, 1);
	assert.equal(events.filter((event) => event.type === 'load').length, 1);
	owner.afterCommit({}); await owner.whenIdle();
	listener({surface: 'surface', style: owner.token, sequence: 3, layout: 2, kind: 'render'});
	assert.equal(events.some((event) => event.type === 'readiness-change' && event.status === 'ready'), true);
	await owner.dispose();
});
