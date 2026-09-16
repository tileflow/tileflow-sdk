import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeSourceState} from '@tileflow/core/native';
import type {MapCameraProps} from '../src/contract';
import type {NativeSurface, NativeSurfaceEvent} from '../src/native-surface-contract';
import {createNativeRendererOwner} from '../src/native-renderer-owner';

function target(name: string, generation: number) {
	const map = {name: 'main', defaultTheme: 'light', themes: {light: {colorScheme: 'light', styleUrl: 'https://maps.example.test/light.json'}}};
	return {
		source: {status: 'ready', generation, source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'}, map,
			manifest: {version: 1, maps: {main: map}}, manifestUrl: 'https://maps.example.test/manifest.json',
			theme: {name, colorScheme: name === 'dark' ? 'dark' : 'light', styleUrl: `https://maps.example.test/${name}.json`},
		} as Extract<TileflowNativeSourceState, {status: 'ready'}>,
		style: {version: 8, sources: {}, layers: []},
	};
}
function fixture(props: MapCameraProps = {}) {
	const events: Array<{type: string; [key: string]: unknown}> = [];
	const commands: unknown[] = [];
	let native: (event: NativeSurfaceEvent) => void = () => undefined;
	let sequence = 0;
	let detach = 0;
	const surface: NativeSurface = {
		id: 'surface', async expectStyle() {}, async commitLayout() { return 1; }, async requestFrame() {},
		async applyCamera(command, view) { commands.push(view); return {command, view}; },
		async cancelCamera() { return {cancelled: true}; }, async retire() { detach++; },
	};
	const owner = createNativeRendererOwner('renderer', target('light', 1), props, {
		surfaces: {async attach(_root, notify) { native = notify; return surface; }, async retireRoot() {}},
		emit: (event) => events.push(event), changed() {},
	});
	return {owner, events, commands, detach: () => detach,
		emit(kind: NativeSurfaceEvent['kind'], extra: Record<string, unknown> = {}) {
			native({surface: 'surface', style: owner.token, sequence: ++sequence, layout: 1, kind, ...extra} as NativeSurfaceEvent);
		},
		async ready() {
			await owner.attach(1); await owner.whenIdle();
			this.emit('style'); await owner.whenIdle();
			owner.afterCommit(props); await owner.whenIdle();
			this.emit('render');
		},
	};
}

test('source preparation and a style-loaded event alone cannot establish rendered readiness', async () => {
	const f = fixture();
	await f.owner.attach(1); await f.owner.whenIdle();
	f.emit('render');
	assert.equal(f.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'), false);
	f.emit('style'); await f.owner.whenIdle();
	assert.equal(f.events.filter((event) => event.type === 'load').length, 1);
	f.emit('render');
	assert.equal(f.events.some((event) => event.type === 'readiness-change' && event.status === 'ready'), false);
	f.owner.afterCommit({}); await f.owner.whenIdle();
	f.emit('render');
	assert.equal(f.events.filter((event) => event.type === 'readiness-change' && event.status === 'ready').length, 1);
	await f.owner.dispose();
});

test('theme transactions and rollback keep the same native surface and last live camera', async () => {
	const f = fixture(); await f.ready();
	const firstKey = f.owner.snapshot.key;
	f.owner.preload(2);
	f.owner.setTarget(target('dark', 2)); await f.owner.whenIdle();
	const darkToken = f.owner.token;
	f.emit('error'); await f.owner.whenIdle();
	assert.notEqual(f.owner.token, darkToken);
	f.emit('style'); await f.owner.whenIdle();
	f.owner.afterCommit({}); await f.owner.whenIdle(); f.emit('render');
	assert.equal(f.owner.snapshot.key, firstKey);
	assert.equal(f.detach(), 0);
	assert.equal(f.events.some((event) => event.type === 'theme-change' && event.phase === 'ready' && event.generation === 2), false);
	assert.equal(f.events.some((event) => event.type === 'theme-change' && event.phase === 'error' && event.generation === 2), true);
	assert.equal(f.events.at(-1)!.status, 'ready');
	await f.owner.dispose(); assert.equal(f.detach(), 1);
});

test('controlled gestures settle only after committed props and do not echo prop commands', async () => {
	const initial = {center: [1, 2] as const, zoom: 3, bearing: 4, pitch: 5};
	const final = {...initial, zoom: 6};
	const observed: unknown[] = [];
	const props: MapCameraProps = {view: initial, onViewChange: (event) => observed.push(event)};
	const f = fixture(props); await f.ready();
	const before = f.commands.length;
	f.emit('gesture-start', {gesture: 1, view: initial});
	f.emit('gesture-change', {gesture: 1, view: final});
	f.emit('gesture-end', {gesture: 1, view: final});
	await f.owner.whenIdle();
	assert.equal(f.commands.length, before);
	f.owner.afterCommit({view: final, onViewChange: props.onViewChange}); await f.owner.whenIdle();
	assert.equal(f.commands.length, before);
	assert.equal(observed.length, 1);
	f.owner.afterCommit({...props, view: {...final, zoom: 7}}); await f.owner.whenIdle();
	assert.equal(f.commands.length, before + 1);
	assert.equal(observed.length, 1);
	await f.owner.dispose();
});

test('background stale events layout loss and teardown never restore readiness', async () => {
	const f = fixture(); await f.ready();
	f.owner.background(); f.emit('render');
	assert.equal(f.events.at(-1)!.status, 'loading');
	f.owner.resume(); await f.owner.whenIdle();
	f.owner.afterCommit({}); await f.owner.whenIdle(); f.emit('render');
	assert.equal(f.events.at(-1)!.status, 'ready');
	const count = f.events.length;
	await f.owner.dispose(); await f.owner.dispose(); f.emit('error'); f.emit('render');
	assert.equal(f.events.length, count); assert.equal(f.detach(), 1);
});
