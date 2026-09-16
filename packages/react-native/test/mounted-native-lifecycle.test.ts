import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountedMapOwner, type MountedMapPorts} from '../src/mounted-map-owner';
import type {NativeMapAdmission} from '../src/native-admission-owner';
import type {NativeSurfaceEvent} from '../src/native-surface-contract';

test('a late native foreground event retries only the live Map without rebuilding its context', async () => {
	let foreground = false;
	let opens = 0;
	let styles = 0;
	const ports: MountedMapPorts = {
		documents: {acquire(url) {
			const document = url.endsWith('manifest.json') ? {version: 1, maps: {main: {defaultTheme: 'light', themes: {
				light: {styleUrl: './light.json', colorScheme: 'light'},
			}}}} : {version: 8, sources: {}, layers: []};
			if (!url.endsWith('manifest.json')) styles++;
			const bytes = new TextEncoder().encode(JSON.stringify(document)); let read = false;
			return {response: Promise.resolve({url, status: 200, reader: {
				async read() { if (read) return {done: true}; read = true; return {done: false, value: bytes}; }, cancel() {},
			}}), cancel() {}};
		}},
		createBinding: () => ({async replace() { return {kind: 'direct'}; }, dispose() {}}),
		appearance: () => () => undefined,
		installation: {open() {
			opens++;
			const map: NativeMapAdmission = {context: 'context', generation: 1, scope: {context: 'context', installation: 'installation'},
				state: {status: 'active', context: 'context'}, async prepare() { if (!foreground) throw new Error('Not resumed.'); return null; },
				discriminate: (url) => url, discriminateForTest: (url) => url, async extendResources() { return {resources: 0}; },
				async retire() { return {retired: true}; }};
			return {ready: Promise.resolve(map), async retire() {}};
		}, async retryRetirements() {}},
		surfaces: {available() {}, async attach() { throw new Error('Preparation only.'); }, async retireRoot() {}},
		now: () => new Date('2026-09-01T00:00:00.000Z'),
	};
	const owner = createMountedMapOwner(ports);
	owner.update({source: {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'}});
	await owner.whenIdle();
	assert.equal(owner.getSnapshot().renderer, undefined);
	foreground = true;
	owner.nativeLifecycle(true);
	await owner.whenIdle();
	assert.ok(owner.getSnapshot().renderer);
	assert.equal(opens, 1); assert.equal(styles, 1);
	await owner.dispose();
	owner.nativeLifecycle(true);
	assert.equal(opens, 1);
});

test('a theme resolved while backgrounded resumes on the existing committed context', async () => {
	let opens = 0;
	let sequence = 0;
	let token = '';
	let notify: ((event: NativeSurfaceEvent) => void) | undefined;
	const styleReads: string[] = [];
	const manifest = {version: 1, maps: {main: {defaultTheme: 'light', themes: {
		light: {styleUrl: './light.json', colorScheme: 'light'},
		dark: {styleUrl: './dark.json', colorScheme: 'dark'},
	}}}};
	const ports: MountedMapPorts = {
		documents: {acquire(url) {
			const document = url.endsWith('manifest.json') ? manifest : {version: 8, sources: {}, layers: []};
			if (!url.endsWith('manifest.json')) styleReads.push(url);
			const bytes = new TextEncoder().encode(JSON.stringify(document));
			let read = false;
			return {response: Promise.resolve({url, status: 200, reader: {
				async read() { if (read) return {done: true}; read = true; return {done: false, value: bytes}; }, cancel() {},
			}}), cancel() {}};
		}},
		createBinding: () => ({async replace() { return {kind: 'direct'}; }, dispose() {}}),
		appearance: () => () => undefined,
		installation: {open() {
			opens++;
			const context = `context_${opens}`;
			const map: NativeMapAdmission = {context, generation: 1, scope: {context, installation: 'installation'},
				state: {status: 'active', context}, async prepare() { return null; },
				discriminate: (url) => url, discriminateForTest: (url) => url, async extendResources() { return {resources: 0}; },
				async retire() { return {retired: true}; }};
			return {ready: Promise.resolve(map), async retire() {}};
		}, async retryRetirements() {}},
		surfaces: {available() {}, async attach(_root, listener) {
			notify = listener;
			return {id: 'surface', async expectStyle(style) { token = style; }, async commitLayout() { return 1; },
				async requestFrame() {}, async applyCamera(command, view) { return {command, view}; },
				async cancelCamera() { return {cancelled: true}; }, async retire() {}};
		}, async retireRoot() {}},
		now: () => new Date('2026-09-01T00:00:00.000Z'),
	};
	const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
	const owner = createMountedMapOwner(ports);
	owner.update({source});
	await owner.whenIdle();
	const first = owner.getSnapshot().renderer;
	assert.ok(first);
	owner.rootMounted(first.key, 1);
	owner.nativeStyleLoaded(first.key, 1);
	await owner.whenIdle();
	assert.ok(notify); assert.notEqual(token, '');
	notify({surface: 'surface', style: token, sequence: ++sequence, layout: 1, kind: 'style'});
	await owner.whenIdle();
	owner.update({source});
	await owner.whenIdle();
	notify({surface: 'surface', style: token, sequence: ++sequence, layout: 1, kind: 'render'});
	assert.equal(styleReads.filter((url) => url.endsWith('/light.json')).length, 1);

	owner.nativeLifecycle(false);
	owner.update({source, theme: 'dark'});
	await owner.whenIdle();
	assert.equal(styleReads.filter((url) => url.endsWith('/dark.json')).length, 0);
	owner.nativeLifecycle(true);
	await owner.whenIdle();
	assert.equal(styleReads.filter((url) => url.endsWith('/dark.json')).length, 1);
	assert.equal(owner.getSnapshot().renderer?.key, first.key);
	assert.equal(opens, 1);
	await owner.dispose();
});
