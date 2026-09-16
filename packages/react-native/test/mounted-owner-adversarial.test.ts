import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeManifestOperation} from '@tileflow/core/native';
import {createMountedMapOwner, type MountedMapPorts} from '../src/mounted-map-owner';
import type {NativeMapAdmission} from '../src/native-admission-owner';
import {deferred} from './session-fixture';

function fixture() {
	let owner: ReturnType<typeof createMountedMapOwner>;
	let onReady: (() => void) | undefined;
	let holdDark: Promise<void> | undefined;
	const darkEntered = deferred<void>();
	const darkCancelled = deferred<void>();
	let opens = 0;
	let darkReads = 0;
	let darkCancels = 0;
	const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
	const manifest = {version: 1, maps: {main: {defaultTheme: 'light', themes: {
		light: {styleUrl: './light.json', colorScheme: 'light'}, dark: {styleUrl: './dark.json', colorScheme: 'dark'},
	}}}};
	const ports: MountedMapPorts = {
		documents: {acquire(url): TileflowNativeManifestOperation {
			let cancelled = false;
			const dark = url.endsWith('dark.json');
			if (dark) { darkReads++; darkEntered.resolve(); }
			const bytes = new TextEncoder().encode(JSON.stringify(url.endsWith('manifest.json') ? manifest : {version: 8, sources: {}, layers: []}));
			let offset = 0;
			const gate = dark ? holdDark : undefined;
			const cancel = () => {
				if (cancelled) return;
				cancelled = true;
				if (dark) { darkCancels++; darkCancelled.resolve(); }
			};
			return {response: Promise.resolve(gate).then(() => ({url, status: 200, reader: {
				async read(maximumBytes) {
					if (cancelled) throw new Error('Cancelled.');
					if (offset === bytes.length) return {done: true};
					const value = bytes.slice(offset, offset + maximumBytes); offset += value.length;
					return {done: false, value};
				}, cancel,
			}})), async cancel() { cancel(); }};
		}},
		createBinding: () => ({async replace() { return {kind: 'direct'}; }, dispose() {}}),
		appearance() { return () => undefined; },
		installation: {
			open() {
				const context = `context_${++opens}`;
				const map: NativeMapAdmission = {context, generation: 1, scope: {installation: 'installation', context},
					state: {status: 'active', context}, async prepare() { return null; },
					discriminate: (url) => url, discriminateForTest: (url) => url,
					async extendResources() { return {resources: 0}; }, async retire() { return {retired: true}; }};
				return {ready: Promise.resolve(map), async retire() {}};
			}, async retryRetirements() {},
		},
		surfaces: {available() {}, async attach() { throw new Error('Preparation only.'); }, async retireRoot() {}},
		now: () => new Date('2026-09-01T00:00:00.000Z'),
	};
	owner = createMountedMapOwner(ports);
	owner.subscribe(() => { if (owner.getSourceState()?.status === 'ready') onReady?.(); });
	return {owner, source, darkEntered, darkCancelled, opens: () => opens, darkReads: () => darkReads,
		darkCancels: () => darkCancels, onReady(callback: () => void) { onReady = callback; },
		holdDark(value: Promise<void> | undefined) { holdDark = value; }};
}

test('replacement from a ready-source subscriber cannot make a retired context await itself', async () => {
	const f = fixture();
	let replaced = false;
	f.onReady(() => {
		if (replaced) return;
		replaced = true;
		f.owner.update({source: {...f.source, map: 'missing'}});
	});
	f.owner.update({source: f.source});
	await f.owner.whenIdle();
	assert.equal(f.owner.getSourceState()?.status, 'error');
	assert.equal(f.opens(), 0);
	await f.owner.dispose();
});

test('background interruption reselects the requested concrete theme instead of retaining a cancelled job', async () => {
	const f = fixture();
	f.owner.update({source: f.source}); await f.owner.whenIdle();
	const first = f.owner.getSnapshot().renderer?.key;
	assert.ok(first);
	const dark = deferred<void>(); f.holdDark(dark.promise);
	f.owner.update({source: f.source, theme: 'dark'});
	await f.darkEntered.promise;
	assert.equal(f.darkReads(), 1);
	f.owner.background();
	await f.darkCancelled.promise;
	await f.owner.whenIdle();
	assert.equal(f.darkCancels(), 1);
	// The cancelled adapter response may arrive later; it cannot retain or resurrect the retired job.
	dark.resolve(); await dark.promise;
	f.holdDark(undefined);
	f.owner.resume(); await f.owner.whenIdle();
	assert.equal(f.darkReads(), 2);
	assert.equal(f.owner.getSnapshot().renderer?.key, first);
	assert.equal(f.opens(), 1);
	await f.owner.dispose();
});

test('immediate disposal before queued context preparation never opens a native context', async () => {
	const f = fixture();
	f.owner.update({source: f.source});
	await f.owner.dispose();
	await f.owner.whenIdle();
	assert.equal(f.opens(), 0);
	assert.equal(f.owner.getSnapshot().renderer, undefined);
});
