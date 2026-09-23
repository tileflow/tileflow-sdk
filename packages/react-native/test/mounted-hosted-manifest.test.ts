import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowNativeManifestOperation, TileflowNativeManifestResponse} from '@tileflow/core/native';
import {createHostedNativeBindingResolver} from '../src/hosted-binding';
import {snapshotMobileConfiguration} from '../src/mobile-configuration';
import {createMountedMapOwner, type MountedMapPorts} from '../src/mounted-map-owner';
import type {NativeMapAdmission} from '../src/native-admission-owner';
import {createHostedNativeSessionController, type HostedNativeSessionController} from '../src/session-controller';
import {hostedSourceFixture} from './hosted-source-fixture';
import {apiOrigin, credential, createClock, deferred, grant, mapId, response, success} from './session-fixture';

type Document = {url: string; status: number; value: unknown};
function fixture(options: {
	manifest?(index: number): ReturnType<typeof hostedSourceFixture>;
	style?(url: string, index: number): Document | Promise<Document>;
} = {}) {
	const clock = createClock();
	const calls: Array<{url: string; context?: string}> = [];
	const cancelled: string[] = [];
	const bootstrap: Array<{url: string; credential: string | undefined}> = [];
	const controllers = new Map<string, HostedNativeSessionController>();
	const contexts: NativeMapAdmission[] = [];
	const catalogs = new Map<string, Set<string>>();
	const surfaceRoots: number[] = [];
	const styleTokens: string[] = [];
	const errors: unknown[] = [];
	let manifests = 0;
	let styles = 0;
	let configurationReads = 0;
	let sessionIds = 0;
	const source = hostedSourceFixture({apiOrigin, mapId}).source;
	const prepareStyle = (url: string): Document => {
		const version = Number(/\/native\/v([1-9][0-9]*)\//u.exec(url)?.[1]);
		return {url, status: 200, value: {version: 8, sources: {}, layers: [], metadata: {
			'tileflow:mapId': mapId, 'tileflow:theme': 'light',
			'tileflow:deploymentVersion': version, 'tileflow:nativeStyleSha256': 'a'.repeat(64),
		}}};
	};
	const ports: MountedMapPorts = {
		createBinding: () => createHostedNativeBindingResolver(async () => {
			configurationReads++;
			return snapshotMobileConfiguration({apiOrigin, credential});
		}),
		now: clock.now,
		appearance() { return () => undefined; },
		surfaces: {
			async attach(root) {
				surfaceRoots.push(root);
				let retired = false;
				return {
					id: `surface_${root}`,
					async expectStyle(style) {
						assert.equal(retired, false);
						styleTokens.push(style);
					},
					async commitLayout() { return 1; },
					async requestFrame() {},
					async applyCamera(command, view) { return {command, view}; },
					async cancelCamera() { return {cancelled: true as const}; },
					async retire() { retired = true; },
				};
			},
			async retireRoot() {},
		},
		installation: {
			async retryRetirements() {},
			open(input) {
				const id = `context_${contexts.length + 1}`;
				const catalog = new Set<string>();
				catalogs.set(id, catalog);
				const controller = createHostedNativeSessionController({
					binding: input.binding, now: input.now,
					sessionIdFactory: () => `ses_hosted_${++sessionIds}`,
					fetch: async (url, init) => {
						bootstrap.push({url, credential: init.headers['X-Tileflow-Mobile-Client']});
						const body = JSON.parse(init.body) as {mapId: string; sessionId: string; surfaceId: string};
						return response(200, success(body));
					},
				});
				controllers.set(id, controller);
				let active = true;
				const map: NativeMapAdmission = {
					context: id, generation: 1, scope: {installation: 'installation', context: id},
					get state() { return {context: id, status: active ? 'active' : 'retired'}; },
					prepare: () => controller.prepare!(),
					discriminate: (url) => url, discriminateForTest: (url) => url,
					async extendResources(resources) {
						for (const resource of resources) catalog.add(resource.url);
						return {resources: catalog.size};
					},
					async retire() { active = false; controller.dispose(); return {retired: true}; },
				};
				contexts.push(map);
				return {ready: Promise.resolve(map), async retire() { await map.retire(); }};
			},
		},
		documents: {
			acquire(url, _bounds, scope): TileflowNativeManifestOperation {
				calls.push({url, ...(scope ? {context: scope.context} : {})});
				let live = true;
				const stop = deferred<never>();
				void stop.promise.catch(() => undefined);
				const cancel = () => {
					if (!live) return;
					live = false;
					cancelled.push(url);
					stop.reject(new Error('Retired document.'));
				};
				const pending = Promise.resolve().then(async (): Promise<TileflowNativeManifestResponse> => {
					let document: Document;
					if (url === source.manifestUrl) {
						assert.equal(scope, undefined, 'Public metadata has no admission context.');
						const index = manifests++;
						const current = options.manifest?.(index) ?? hostedSourceFixture({apiOrigin, mapId});
						document = {url: current.manifestUrl, status: 200, value: current.manifest};
					} else {
						assert.ok(scope, 'Protected styles require the existing context.');
						assert.ok(catalogs.get(scope.context)?.has(url), 'The exact style is admitted before acquisition.');
						const authority = await controllers.get(scope.context)!.acquire();
						assert.equal(authority?.grant, grant);
						const index = styles++;
						document = await (options.style?.(url, index) ?? prepareStyle(url));
					}
					if (!live) throw new Error('Retired document.');
					const bytes = new TextEncoder().encode(JSON.stringify(document.value));
					let offset = 0;
					return {url: document.url, status: document.status, reader: {
						async read(bound) {
							if (!live) throw new Error('Retired document.');
							if (offset === bytes.length) return {done: true};
							const value = bytes.slice(offset, offset + bound);
							offset += value.length;
							return {done: false, value};
						}, cancel,
					}};
				});
				const result = Promise.race([pending, stop.promise]);
				void result.catch(() => undefined);
				return {response: result, cancel};
			},
		},
	};
	const owner = createMountedMapOwner(ports);
	return {owner, source, calls, cancelled, bootstrap, contexts, surfaceRoots, styleTokens, errors, prepareStyle,
		configurationReads: () => configurationReads, sessionIds: () => sessionIds,
		start() { owner.update({source, onError: (error) => errors.push(error)}); },
		async mount() {
			const renderer = owner.getSnapshot().renderer;
			assert.ok(renderer, 'Only a successfully prepared source can create a renderer.');
			owner.rootMounted(renderer.key, 1);
			owner.nativeStyleLoaded(renderer.key, 1);
			await owner.whenIdle();
			assert.deepEqual(surfaceRoots, [1]);
			assert.deepEqual(styleTokens, ['style_1']);
			return owner.getSnapshot().renderer!.style;
		},
	};
}

test('cold start reads public metadata then bootstraps one session before its protected style', async () => {
	const f = fixture();
	try {
		f.start();
		await f.owner.whenIdle();
		assert.ok(f.owner.getSnapshot().renderer);
		assert.deepEqual(f.surfaceRoots, [], 'Preparation does not attach a native view.');
		const style = await f.mount();
		assert.deepEqual(style.metadata, (f.prepareStyle(`${apiOrigin}/maps/${mapId}/native/v7/light.json`).value as {metadata: unknown}).metadata);
		assert.doesNotMatch(JSON.stringify(style), /tf_public_|tf_native_/u);
		assert.equal(f.contexts.length, 1);
		assert.equal(f.sessionIds(), 1);
		assert.equal(f.configurationReads(), 1);
		assert.deepEqual(f.bootstrap, [{url: `${apiOrigin}/v1/sessions/start`, credential}]);
		assert.deepEqual(f.calls.map(({context}) => context), [undefined, 'context_1']);
		assert.deepEqual(f.errors, []);
	} finally { await f.owner.dispose(); }
});

test('a stale public manifest is reloaded once without replacing the session or context', async () => {
	const f = fixture({
		manifest: (index) => hostedSourceFixture({apiOrigin, mapId, version: index ? 8 : 7}),
		style: (url, index) => index === 0
			? {url, status: 409, value: {error: 'Superseded deployment.'}}
			: f.prepareStyle(url),
	});
	try {
		f.start();
		await f.owner.whenIdle();
		assert.ok(f.owner.getSnapshot().renderer);
		const style = await f.mount();
		assert.equal((style.metadata as Record<string, unknown>)['tileflow:deploymentVersion'], 8);
		assert.equal(f.contexts.length, 1);
		assert.equal(f.sessionIds(), 1);
		assert.equal(f.bootstrap.length, 1);
		assert.equal(f.configurationReads(), 1);
		assert.deepEqual(f.calls.map(({url}) => url), [
			f.source.manifestUrl, `${apiOrigin}/maps/${mapId}/native/v7/light.json`,
			f.source.manifestUrl, `${apiOrigin}/maps/${mapId}/native/v8/light.json`,
		]);
		assert.deepEqual(f.errors, []);
	} finally { await f.owner.dispose(); }
});

test('wrong protected identity never reaches the renderer and cannot cause an unbounded reload', async () => {
	for (const kind of ['hash', 'url', 'map', 'version', 'theme'] as const) {
		const f = fixture({style: (url) => {
			const doc = f.prepareStyle(url);
			const value = doc.value as {metadata: Record<string, unknown>};
			if (kind === 'hash') value.metadata['tileflow:nativeStyleSha256'] = 'b'.repeat(64);
			if (kind === 'map') value.metadata['tileflow:mapId'] = 'map_ponmlkjihgfedcba';
			if (kind === 'version') value.metadata['tileflow:deploymentVersion'] = 99;
			if (kind === 'theme') value.metadata['tileflow:theme'] = 'dark';
			if (kind === 'url') doc.url = 'https://untrusted.example/style.json';
			return doc;
		}});
		try {
			f.start();
			await f.owner.whenIdle();
			assert.equal(f.owner.getSnapshot().renderer, undefined);
			assert.deepEqual(f.surfaceRoots, []);
			assert.deepEqual(f.styleTokens, []);
			assert.equal(f.calls.filter(({context}) => context === undefined).length, 2);
			assert.equal(f.calls.filter(({context}) => context !== undefined).length, 2);
			assert.equal(f.contexts.length, 1);
			assert.equal(f.bootstrap.length, 1);
			assert.equal(f.errors.length, 1);
			assert.doesNotMatch(JSON.stringify(f.errors), /https:|tf_public_|tf_native_/u);
		} finally { await f.owner.dispose(); }
	}
});

test('incomplete Hosted metadata fails before configuration, session or protected style acquisition', async () => {
	const f = fixture({manifest: () => {
		const input = hostedSourceFixture({apiOrigin, mapId});
		delete input.manifest.maps.streets!.worldGeneration;
		return input;
	}});
	try {
		f.start();
		await f.owner.whenIdle();
		assert.equal(f.owner.getSourceState()?.status, 'error');
		assert.equal(f.owner.getSnapshot().renderer, undefined);
		assert.equal(f.configurationReads(), 0);
		assert.equal(f.contexts.length, 0);
		assert.deepEqual(f.bootstrap, []);
		assert.deepEqual(f.calls, [{url: f.source.manifestUrl}]);
		assert.equal(f.errors.length, 1);
	} finally { await f.owner.dispose(); }
});

test('a stale reload cannot change Map, origin, delivery mode or move backwards', async () => {
	for (const drift of ['map', 'origin', 'mode', 'version'] as const) {
		const f = fixture({
			manifest(index) {
				const input = hostedSourceFixture({
					apiOrigin: index && drift === 'origin' ? 'https://untrusted.example' : apiOrigin,
					mapId: index && drift === 'map' ? 'map_ponmlkjihgfedcba' : mapId,
					version: index && drift === 'version' ? 6 : 7,
				});
				if (index && drift === 'mode') {
					delete input.manifest.maps.streets!.usageMode;
					delete input.manifest.maps.streets!.worldGeneration;
				}
				return input;
			},
			style: (url) => ({url, status: 404, value: {error: 'Superseded deployment.'}}),
		});
		try {
			f.start();
			await f.owner.whenIdle();
			assert.equal(f.owner.getSnapshot().renderer, undefined);
			assert.equal(f.calls.filter(({context}) => context === undefined).length, 2);
			assert.equal(f.calls.filter(({context}) => context !== undefined).length, 1);
			assert.deepEqual(f.bootstrap, [{url: `${apiOrigin}/v1/sessions/start`, credential}]);
			assert.equal(f.configurationReads(), 1);
			assert.equal(f.contexts.length, 1);
			assert.equal(f.errors.length, 1);
			assert.deepEqual(f.surfaceRoots, []);
		} finally { await f.owner.dispose(); }
	}
});

test('retirement cancels a pending protected style without refetching metadata or affecting another Map', async () => {
	const entered = deferred<void>();
	const late = deferred<Document>();
	const first = fixture({style: () => { entered.resolve(); return late.promise; }});
	const second = fixture();
	try {
		first.start();
		// A terminal preparation failure must fail this assertion, not wait forever for an unreachable request.
		assert.equal(await Promise.race([
			entered.promise.then(() => true), first.owner.whenIdle().then(() => false),
		]), true, 'Preparation ended before the protected style request.');
		await first.owner.dispose();
		await first.owner.whenIdle();
		assert.ok(first.cancelled.includes(`${apiOrigin}/maps/${mapId}/native/v7/light.json`));
		assert.equal(first.contexts[0]!.state.status, 'retired');
		second.start();
		await second.owner.whenIdle();
		await second.mount();
		late.resolve({url: 'https://untrusted.example/late.json', status: 200, value: {}});
		await late.promise;
		await first.owner.whenIdle();
		assert.equal(first.calls.length, 2);
		assert.equal(first.owner.getSnapshot().renderer, undefined);
		assert.deepEqual(first.surfaceRoots, []);
		assert.deepEqual(first.errors, []);
		assert.ok(second.owner.getSnapshot().renderer);
		assert.equal(second.contexts.length, 1);
		assert.equal(second.contexts[0]!.state.status, 'active');
		assert.deepEqual(second.errors, []);
	} finally {
		late.resolve({url: '', status: 500, value: {}});
		await Promise.all([first.owner.dispose(), second.owner.dispose()]);
	}
});
