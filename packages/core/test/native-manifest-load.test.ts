import assert from 'node:assert/strict';
import test from 'node:test';
import {
	loadTileflowNativeManifest,
	TileflowNativeSourceError,
	tileflowNativeManifestLimits,
	type TileflowNativeManifestAcquire,
	type TileflowNativeManifestResponse,
} from '../src/native';
import {bytes, deferred, manifest, manifestUrl, transport} from './native-manifest-fixture';

const options = (t: ReturnType<typeof transport>) => ({acquire: t.acquire});
function isError(code: string) {
	return (error: unknown) => {
		assert.ok(error instanceof TileflowNativeSourceError);
		assert.equal(error.code, code);
		assert.equal(error.cause, undefined);
		return true;
	};
}

test('loads the strict manifest and resolves all styles from the final approved owner', async () => {
	const input = manifest();
	const original = JSON.stringify(input);
	const t = transport(bytes(input), 'https://cdn.example.test/releases/r/manifest.json');
	const result = await loadTileflowNativeManifest(manifestUrl, options(t));
	assert.equal(result.manifestUrl, t.response.url);
	assert.equal(t.calls, 1);
	assert.equal(t.requests[0]?.maximumBytes, 1024 * 1024);
	assert.equal(result.manifest.version, 1);
	assert.equal(result.manifest.maps.streets?.themes.light?.styleUrl,
		'https://cdn.example.test/releases/r/styles/streets/light.json');
	assert.equal(result.manifest.maps.streets?.themes.dark?.revision, 'dark-v1');
	assert.deepEqual(result.manifest.maps.streets?.view, input.maps.streets.view);
	assert.equal(JSON.stringify(input), original);
	assert.equal(t.readerCancels, 0);
	assert.equal(t.operationCancels, 0);
});

test('keeps declared identity and resolves font resources from their owning style', async () => {
	const input = {...manifest(), apiUrl: 'https://api.example.test'};
	Object.assign(input.maps.streets, {mapId: 'map_123', usageMode: 'session', worldGeneration: 'v1'});
	Object.assign(input.maps.streets.themes.light, {
		styleId: 'style_123', fontFaces: [{family: 'Fixture', source: '../../fonts/fixture.ttf'}],
	});
	const t = transport(bytes(input));
	const result = await loadTileflowNativeManifest(manifestUrl, options(t));
	assert.equal(result.manifest.maps.streets?.mapId, 'map_123');
	assert.equal(result.manifest.maps.streets?.themes.light?.styleId, 'style_123');
	assert.equal(result.manifest.maps.streets?.themes.light?.fontFaces?.[0]?.source,
		'https://maps.example.test/native/fonts/fixture.ttf');
	assert.equal(t.calls, 1);
});

for (const invalid of [
	{...manifest(), extra: true}, {...manifest(), version: 2}, {version: 1, maps: {}},
	{...manifest(), maps: {streets: {...manifest().maps.streets, extra: true}}},
	{...manifest(), maps: {streets: {...manifest().maps.streets, defaultTheme: 'missing'}}},
]) {
	test('rejects noncanonical manifest input without exposing schema details', async () => {
		const t = transport(bytes(invalid));
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_INVALID'));
		assert.equal(t.readerCancels, 1);
		assert.equal(t.operationCancels, 1);
	});
}

for (const [name, body, code] of [
	['JSON', new TextEncoder().encode('{secret: "tf_live_hidden"}'), 'NATIVE_MANIFEST_JSON_INVALID'],
	['empty body', new Uint8Array(), 'NATIVE_MANIFEST_JSON_INVALID'],
	['UTF-8', Uint8Array.of(0x7b, 0xc0, 0xaf, 0x7d), 'NATIVE_MANIFEST_UTF8_INVALID'],
	['deep JSON', new TextEncoder().encode('['.repeat(65) + '0' + ']'.repeat(65)), 'NATIVE_MANIFEST_INVALID'],
] as const) {
	test(`rejects ${name}`, async () => {
		const t = transport(body);
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError(code));
		assert.equal(t.operationCancels, 1);
		assert.equal(t.readerCancels, 1);
	});
}

test('counts actual body bytes with absent or false Content-Length', async () => {
	const limit = tileflowNativeManifestLimits.maximumBytes;
	for (const contentLength of [undefined, '0', '3']) {
		const input = new Uint8Array(limit + 1).fill(32);
		const t = transport(input);
		Object.defineProperty(t.response, 'headers', {value: {'content-length': contentLength}});
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_TOO_LARGE'));
		assert.equal(t.readerCancels, 1);
		assert.equal(t.operationCancels, 1);
		assert.equal(t.reads.at(-1), 1);
	}
});

test('accepts exactly the byte ceiling and handles split multibyte characters and a leading BOM', async () => {
	const encoded = bytes(manifest());
	const exact = new Uint8Array(tileflowNativeManifestLimits.maximumBytes).fill(32);
	exact.set(encoded);
	const t = transport(exact);
	assert.equal((await loadTileflowNativeManifest(manifestUrl, options(t))).manifest.version, 1);
	const input = manifest();
	input.maps.streets.themes.light.revision = 'A🌍é漢';
	const raw = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(input)]);
	const split = transport(raw);
	const read = split.response.reader.read.bind(split.response.reader);
	split.response.reader.read = () => read(1);
	assert.equal((await loadTileflowNativeManifest(manifestUrl, options(split))).manifest.maps.streets?.themes.light?.revision,
		'A🌍é漢');
});

for (const [status, code] of [[401, 'NATIVE_MANIFEST_ACCESS_DENIED'], [403, 'NATIVE_MANIFEST_ACCESS_DENIED'],
	[404, 'NATIVE_MANIFEST_NOT_FOUND'], [500, 'NATIVE_MANIFEST_REQUEST_FAILED']] as const) {
	test(`treats HTTP ${status} as a terminal source failure without reading the body`, async () => {
		const t = transport(bytes(), manifestUrl, status);
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError(code));
		assert.equal(t.reads.length, 0);
		assert.equal(t.readerCancels, 1);
	});
}

test('requires a safe explicit final URL and never falls back to the requested owner', async () => {
	for (const finalUrl of ['', './other.json', 'https://user:secret@cdn.example.test/m.json', 'http://cdn.example.test/m.json']) {
		const t = transport(bytes(), finalUrl);
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_URL_INVALID'));
		assert.equal(t.reads.length, 0);
		assert.equal(t.readerCancels, 1);
	}
});

test('honors an exact development origin with the accepted URL provider', async () => {
	for (const origin of ['http://127.0.0.1:8765', 'http://10.0.2.2:8765']) {
		const url = `${origin}/generations/r/manifest.json`;
		const t = transport(bytes(), url);
		const result = await loadTileflowNativeManifest(url, {...options(t), developmentOrigin: origin});
		assert.equal(result.manifest.maps.streets?.themes.light?.styleUrl, `${origin}/generations/r/styles/streets/light.json`);
	}
});

test('pre-abort does not acquire and does not read AbortSignal.reason', async () => {
	const controller = new AbortController();
	controller.abort('secret');
	Object.defineProperty(controller.signal, 'reason', {get() { throw new Error('secret'); }});
	const t = transport();
	await assert.rejects(loadTileflowNativeManifest(manifestUrl, {...options(t), signal: controller.signal}),
		isError('NATIVE_SOURCE_ABORTED'));
	assert.equal(t.calls, 0);
});

test('abort settles even when acquisition ignores cancellation and cancels a late reader', async () => {
	const headers = deferred<TileflowNativeManifestResponse>();
	const t = transport();
	let cancels = 0;
	const acquire: TileflowNativeManifestAcquire = () => ({response: headers.promise, cancel() { cancels++; }});
	const controller = new AbortController();
	const pending = loadTileflowNativeManifest(manifestUrl, {acquire, signal: controller.signal});
	controller.abort('secret');
	await assert.rejects(pending, isError('NATIVE_SOURCE_ABORTED'));
	assert.equal(cancels, 1);
	headers.resolve(t.response);
	await headers.promise;
	assert.equal(t.readerCancels, 1);
});

test('abort of a hanging read cancels both handles without awaiting their cleanup', async () => {
	const t = transport();
	const reading = deferred<void>();
	const ignored = deferred<{done: true}>();
	t.response.reader.read = () => { reading.resolve(); return ignored.promise; };
	const controller = new AbortController();
	const pending = loadTileflowNativeManifest(manifestUrl, {...options(t), signal: controller.signal});
	await reading.promise;
	controller.abort(new Error('credentials'));
	await assert.rejects(pending, isError('NATIVE_SOURCE_ABORTED'));
	assert.equal(t.readerCancels, 1);
	assert.equal(t.operationCancels, 1);
	ignored.reject(new Error('late reader exception'));
});

test('sanitizes acquisition/read/cleanup exceptions and malformed chunks', async () => {
	const secret = 'https://user:secret@example.test/?token=tf_live_hidden';
	const acquire: TileflowNativeManifestAcquire = () => { throw new Error(secret); };
	await assert.rejects(loadTileflowNativeManifest(manifestUrl, {acquire}), (error: unknown) => {
		assert.ok(error instanceof TileflowNativeSourceError);
		assert.equal(error.code, 'NATIVE_MANIFEST_REQUEST_FAILED');
		assert.equal(error.cause, undefined);
		assert.equal(JSON.stringify(error).includes('secret'), false);
		assert.equal(String(error).includes(secret), false);
		return true;
	});
	for (const chunk of [new Uint8Array(), 'text', new Uint8Array(65_537)]) {
		const t = transport();
		t.response.reader.read = async () => ({done: false, value: chunk as Uint8Array});
		t.response.reader.cancel = () => { throw new Error(secret); };
		await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_RESPONSE_INVALID'));
		assert.equal(t.operationCancels, 1);
	}
});

test('bounds resolved URL expansion as well as the original body', async () => {
	const maps = Object.fromEntries(Array.from({length: 800}, (_, index) => [
		`map-${index}`, {defaultTheme: 'light', themes: {light: {colorScheme: 'light', styleUrl: './style.json'}}},
	]));
	const body = bytes({version: 1, maps});
	assert.ok(body.byteLength < tileflowNativeManifestLimits.maximumBytes);
	const t = transport(body, `https://maps.example.test/${'a'.repeat(1500)}/manifest.json`);
	await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_TOO_LARGE'));
	assert.equal(t.readerCancels, 1);
	assert.equal(t.operationCancels, 1);
});

test('an oversized chunk is rejected before retaining it and cleanup may never settle', async () => {
	const t = transport();
	t.response.reader.read = async () => ({done: false, value: new Uint8Array(tileflowNativeManifestLimits.maximumBytes + 1)});
	const never = deferred<void>();
	t.response.reader.cancel = () => never.promise;
	await assert.rejects(loadTileflowNativeManifest(manifestUrl, options(t)), isError('NATIVE_MANIFEST_TOO_LARGE'));
	assert.equal(t.operationCancels, 1);
});

test('success and abort detach the external signal listener without reading its reason', async () => {
	let listening = 0;
	const callbacks = new Set<EventListenerOrEventListenerObject>();
	const signal = {
		aborted: false,
		addEventListener(_name: string, listener: EventListenerOrEventListenerObject | null) { if (listener) { callbacks.add(listener); listening++; } },
		removeEventListener(_name: string, listener: EventListenerOrEventListenerObject | null) { if (listener && callbacks.delete(listener)) listening--; },
	};
	const t = transport();
	await loadTileflowNativeManifest(manifestUrl, {...options(t), signal});
	assert.equal(listening, 0);
});
