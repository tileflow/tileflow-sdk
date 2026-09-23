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
	const bootstrap: Array<{url: string; credential: string | undefined}> = [];
	const controllers = new Map<string, HostedNativeSessionController>();
	const contexts: NativeMapAdmission[] = [];
	const catalog = new Set<string>();
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
			async attach() { throw new Error('The fixture observes preparation, not a native view.'); },
			async retireRoot() {},
		},
		installation: {
			async retryRetirements() {},
			open(input) {
				const id = `context_${contexts.length + 1}`;
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
				const cancel = () => { live = false; stop.reject(new Error('Retired document.')); };
				const pending = Promise.resolve().then(async (): Promise<TileflowNativeManifestResponse> => {
					let document: Document;
					if (url === source.manifestUrl) {
						assert.equal(scope, undefined, 'Public metadata has no admission context.');
						const current = options.manifest?.(manifests++) ?? hostedSourceFixture({apiOrigin, mapId});
						document = {url: current.manifestUrl, status: 200, value: current.manifest};
					} else {
						assert.ok(scope, 'Protected styles require the existing context.');
						assert.ok(catalog.has(url), 'The exact style is admitted before acquisition.');
						const authority = await controllers.get(scope.context)!.acquire();
						assert.equal(authority?.grant, grant);
						document = await (options.style?.(url, styles++) ?? prepareStyle(url));
					}
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
	return {owner, source, calls, bootstrap, contexts, errors, prepareStyle,
		configurationReads: () => configurationReads, sessionIds: () => sessionIds,
		start() { owner.update({source, onError: (error) => errors.push(error)}); },
	};
}

test('cold start reads public metadata then bootstraps one session before its protected style', async () => {
	const f = fixture();
	try {
		f.start();
		await f.owner.whenIdle();
		assert.ok(f.owner.getSnapshot().renderer);
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
	for (const kind of ['hash', 'url', 'map', 'version'] as const) {
		const f = fixture({style: (url) => {
			const doc = f.prepareStyle(url);
			const value = doc.value as {metadata: Record<string, unknown>};
			if (kind === 'hash') value.metadata['tileflow:nativeStyleSha256'] = 'b'.repeat(64);
			if (kind === 'map') value.metadata['tileflow:mapId'] = 'map_ponmlkjihgfedcba';
			if (kind === 'version') value.metadata['tileflow:deploymentVersion'] = 99;
			if (kind === 'url') doc.url = 'https://untrusted.example/style.json';
			return doc;
		}});
		try {
			f.start();
			await f.owner.whenIdle();
			assert.equal(f.owner.getSnapshot().renderer, undefined);
			assert.equal(f.calls.filter(({context}) => context === undefined).length, 2);
			assert.equal(f.bootstrap.length, 1);
			assert.equal(f.errors.length, 1);
			assert.doesNotMatch(JSON.stringify(f.errors), /https:|tf_public_|tf_native_/u);
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
		await entered.promise;
		await first.owner.dispose();
		second.start();
		await second.owner.whenIdle();
		late.resolve({url: 'https://untrusted.example/late.json', status: 200, value: {}});
		await first.owner.whenIdle();
		assert.equal(first.calls.length, 2);
		assert.equal(first.owner.getSnapshot().renderer, undefined);
		assert.ok(second.owner.getSnapshot().renderer);
		assert.equal(second.contexts.length, 1);
	} finally {
		late.resolve({url: '', status: 500, value: {}});
		await Promise.all([first.owner.dispose(), second.owner.dispose()]);
	}
});
