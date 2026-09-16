import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountedMapOwner, type MountedMapPorts} from '../src/mounted-map-owner';
import type {NativeMapAdmission} from '../src/native-admission-owner';

test('a late native foreground event retries only the live Map without rebuilding its context', async () => {
	let foreground = false;
	let opens = 0;
	let styles = 0;
	const ports: MountedMapPorts = {
		documents: {acquire(url) {
			const document = url.endsWith('manifest.json') ? {version: 1, maps: {main: {defaultTheme: 'light', themes: {
				light: {styleUrl: 'light.json', colorScheme: 'light'},
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
