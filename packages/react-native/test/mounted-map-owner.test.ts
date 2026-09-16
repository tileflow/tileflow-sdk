import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeManifestOperation, TileflowNativeSourceState} from '@tileflow/core/native';
import type {NativeMapAdmission, NativeMapAdmissionInput} from '../src/native-admission-owner';
import {createMountedMapOwner} from '../src/mounted-map-owner';
import {deferred} from './session-fixture';

function fixture() {
	const calls: string[] = [];
	const events: Array<{type: string; [key: string]: unknown}> = [];
	const contexts: NativeMapAdmission[] = [];
	let configurationReads = 0;
	let appearanceReads = 0;
	let retired = 0;
	let registrations: Promise<void> | undefined;
	const manifest = {version: 1, maps: {main: {defaultTheme: 'light', systemThemes: {light: 'light', dark: 'dark'}, themes: {
		light: {colorScheme: 'light', styleUrl: './light.json'}, dark: {colorScheme: 'dark', styleUrl: './dark.json'},
	}}}};
	const documents: Record<string, unknown> = {
		'https://maps.example.test/manifest.json': manifest,
		'https://maps.example.test/other.json': manifest,
		'https://maps.example.test/light.json': {version: 8, sources: {}, layers: []},
		'https://maps.example.test/dark.json': {version: 8, sources: {}, layers: []},
	};
	const ports = {
		documents: {acquire(url: string): TileflowNativeManifestOperation {
			calls.push(url);
			const bytes = new TextEncoder().encode(JSON.stringify(documents[url]));
			let offset = 0; let cancelled = false;
			return {response: Promise.resolve({url, status: 200, reader: {
				async read(maximum: number) {
					if (cancelled) throw new Error('Cancelled.');
					if (offset === bytes.length) return {done: true};
					const value = bytes.slice(offset, offset + maximum); offset += value.length;
					return {done: false, value};
				}, cancel() { cancelled = true; },
			}}), async cancel() { cancelled = true; }};
		}},
		createBinding() { return {async replace(source: TileflowNativeSourceState) {
			if (source.status === 'ready' && source.map.usageMode === 'session') configurationReads++;
			return {kind: 'direct' as const};
		}, dispose() {}}; },
		appearance(_selection: unknown, listener: (value: {status: 'available'; colorScheme: 'light'}) => void) {
			appearanceReads++; listener({status: 'available', colorScheme: 'light'}); return () => undefined;
		},
		installation: {
			open(_input: NativeMapAdmissionInput) {
				let live = true;
				const index = contexts.length;
				const map: NativeMapAdmission = {
					context: `context_${index}`, generation: 1, scope: {installation: 'installation', context: `context_${index}`},
					get state() { return {context: this.context, status: live ? 'active' : 'retired'}; },
					async prepare() { return null; }, discriminate(url) { return url; }, discriminateForTest(url) { return url; },
					async extendResources() { assert.fail('Unexpected non-session catalog.'); },
					async retire() { live = false; return {retired: true}; },
				};
				contexts.push(map);
				const ready = Promise.resolve(registrations).then(() => map);
				return {ready, async retire() { await ready; await map.retire(); retired++; }};
			},
			async retryRetirements() {},
		},
		surfaces: {available() {}, async attach() { throw new Error('The test drives preparation only.'); }, async retireRoot() {}},
		now: () => new Date('2026-09-01T00:00:00.000Z'),
	};
	const owner = createMountedMapOwner(ports);
	const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
	const update = (extras: Record<string, unknown> = {}) => owner.update({source, onError: (event) => events.push(event), ...extras});
	return {owner, ports, update, source, calls, contexts, events, configurationReads: () => configurationReads, appearanceReads: () => appearanceReads, retired: () => retired,
		holdRegistrations(value: Promise<void>) { registrations = value; }};
}

test('does not mount before context acknowledgement; direct delivery never reads configuration or authority', async () => {
	const f = fixture(); const registration = deferred<void>();
	f.holdRegistrations(registration.promise);
	f.update();
	assert.equal(f.owner.getSnapshot().renderer, undefined);
	registration.resolve(); await f.owner.whenIdle();
	assert.ok(f.owner.getSnapshot().renderer);
	assert.equal(f.configurationReads(), 0); assert.equal(f.appearanceReads(), 0);
	assert.equal(f.owner.getSourceState()?.status, 'ready');
	await f.owner.dispose();
});

test('ordinary callbacks presentation and children never recreate semantic source or native ownership', async () => {
	const f = fixture(); f.update(); await f.owner.whenIdle();
	const renderer = f.owner.getSnapshot().renderer;
	const state = f.owner.getSourceState();
	for (let index = 0; index < 10; index++) f.update({onLoad() {}, testID: `map-${index}`, style: {flex: 1}, children: null});
	await f.owner.whenIdle();
	assert.equal(f.owner.getSnapshot().renderer?.key, renderer?.key);
	assert.equal(f.owner.getSourceState(), state);
	assert.equal(f.contexts.length, 1); assert.equal(f.calls.length, 2);
	await f.owner.dispose();
});

test('theme selection preserves context and source replacement retires it before opening another', async () => {
	const f = fixture(); f.update(); await f.owner.whenIdle();
	const first = f.owner.getSnapshot().renderer!.key;
	f.update({theme: 'dark'}); await f.owner.whenIdle();
	assert.equal(f.owner.getSnapshot().renderer!.key, first);
	assert.equal(f.contexts.length, 1);
	assert.equal(f.calls.filter((url) => url.endsWith('manifest.json')).length, 1);
	f.owner.update({source: {...f.source, manifestUrl: 'https://maps.example.test/other.json'}});
	await f.owner.whenIdle();
	assert.notEqual(f.owner.getSnapshot().renderer!.key, first);
	assert.equal(f.contexts.length, 2); assert.equal(f.retired(), 1);
	await f.owner.dispose();
});

test('disposed preparation and its late registration cannot update a replacement owner', async () => {
	const f = fixture(); const gate = deferred<void>(); f.holdRegistrations(gate.promise);
	f.update();
	const retired = f.owner.dispose(); gate.resolve(); await retired;
	assert.equal(f.owner.getSnapshot().renderer, undefined);
	const next = createMountedMapOwner(f.ports); next.update({source: f.source}); await next.whenIdle();
	assert.ok(next.getSnapshot().renderer); await next.dispose();
});

test('forged owned map options never reach the native renderer or leak their values', async () => {
	const f = fixture();
	f.update({mapOptions: {mapStyle: 'private-value'}}); await f.owner.whenIdle();
	assert.equal(f.owner.getSnapshot().renderer, undefined);
	assert.equal(f.calls.length, 0);
	assert.equal(JSON.stringify(f.events).includes('private-value'), false);
	assert.equal(f.events[0]?.type, 'renderer-error');
	await f.owner.dispose();
});
