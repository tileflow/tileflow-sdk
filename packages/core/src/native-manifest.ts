import {tileflowRuntimeManifestLimits, type TileflowRuntimeManifest} from './manifest-types';
import {parseTileflowRuntimeManifest} from './native-manifest-schema';
import {decodeNativeManifestUtf8, hasBoundedNativeManifestDepth, nativeManifestUtf8ByteLength} from './native-manifest-utf8';
import {NativeSourceCancellation, cancelNativeOperation} from './native-source-cancellation';
import {
	TileflowNativeSourceError,
	normalizeNativeSourceError,
	type TileflowNativeManifestAcquire,
	type TileflowNativeManifestLoadOptions,
	type TileflowNativeManifestOperation,
	type TileflowNativeManifestReader,
	type TileflowNativeManifestResponse,
	type TileflowNativeManifestResult,
} from './native-source-types';
import {freezeNativeSnapshot, nativeOwnRecord} from './native-source-utils';
import {resolveTileflowNativeManifestUrl, resolveTileflowNativeResourceUrl} from './native-urls';
import type {TileflowNativeNetworkOptions} from './native-url-policy';

export const tileflowNativeManifestLimits = Object.freeze({
	maximumBytes: tileflowRuntimeManifestLimits.maximumBytes,
	maximumChunkBytes: 64 * 1024,
	maximumDepth: 64,
});

/** Acquire only the manifest. There is no default network client, cache, retry or session. */
export async function loadTileflowNativeManifest(
	manifestUrl: string,
	options: TileflowNativeManifestLoadOptions,
): Promise<TileflowNativeManifestResult> {
	const input = nativeOwnRecord(options);
	if (!input || typeof input.acquire !== 'function') throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
	const cancellation = new NativeSourceCancellation();
	const detach = cancellation.link(input.signal as TileflowNativeManifestLoadOptions['signal']);
	try {
		return await loadNativeManifest(manifestUrl, input.acquire as TileflowNativeManifestAcquire, {
			developmentOrigin: input.developmentOrigin as string | undefined,
		}, cancellation);
	} finally { detach(); }
}

export async function loadNativeManifest(
	manifestUrl: string,
	acquire: TileflowNativeManifestAcquire,
	network: TileflowNativeNetworkOptions,
	cancellation: NativeSourceCancellation,
): Promise<{manifestUrl: string; manifest: TileflowRuntimeManifest}> {
	cancellation.check();
	let requestUrl: string;
	try { requestUrl = resolveTileflowNativeManifestUrl(manifestUrl, network); }
	catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_URL_INVALID', 'manifestUrl'); }

	let operation: TileflowNativeManifestOperation | undefined;
	try {
		operation = acquire(requestUrl, Object.freeze({maximumBytes: tileflowNativeManifestLimits.maximumBytes}));
		if (!operation || typeof operation.cancel !== 'function' || !operation.response || typeof operation.response.then !== 'function') {
			throw new Error();
		}
	} catch {
		if (operation) cancelNativeOperation(() => operation!.cancel());
		throw new TileflowNativeSourceError('NATIVE_MANIFEST_REQUEST_FAILED', 'response');
	}

	let reader: TileflowNativeManifestReader | undefined;
	let readerCancelled = false;
	let operationCancelled = false;
	const cancelReader = () => {
		if (!reader || readerCancelled) return;
		readerCancelled = true;
		cancelNativeOperation(() => reader!.cancel());
	};
	const cleanup = () => {
		if (!operationCancelled) {
			operationCancelled = true;
			cancelNativeOperation(() => operation!.cancel());
		}
		cancelReader();
	};
	const unlisten = cancellation.onCancel(cleanup);
	try {
		const headers = Promise.resolve(operation!.response).then((response) => {
			try {
				if (!response || !response.reader || typeof response.reader.read !== 'function' || typeof response.reader.cancel !== 'function') {
					throw new Error();
				}
				reader = response.reader;
			} catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response'); }
			if (cancellation.aborted) cancelReader();
			cancellation.check();
			return response;
		}, () => { throw new TileflowNativeSourceError('NATIVE_MANIFEST_REQUEST_FAILED', 'response'); });
		const response: TileflowNativeManifestResponse = await cancellation.race(headers);
		cancellation.check();
		let finalUrl: string;
		try { finalUrl = resolveTileflowNativeManifestUrl(response.url, network); }
		catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_URL_INVALID', 'manifestUrl'); }
		if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
			throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
		}
		if (response.status === 401 || response.status === 403) throw new TileflowNativeSourceError('NATIVE_MANIFEST_ACCESS_DENIED', 'response');
		if (response.status === 404) throw new TileflowNativeSourceError('NATIVE_MANIFEST_NOT_FOUND', 'response');
		if (response.status < 200 || response.status >= 300) throw new TileflowNativeSourceError('NATIVE_MANIFEST_REQUEST_FAILED', 'response');

		// One bounded allocation. Chunks are measured and copied before another read can mutate them.
		const buffer = new Uint8Array(tileflowNativeManifestLimits.maximumBytes);
		let length = 0;
		while (true) {
			cancellation.check();
			const allowance = Math.min(tileflowNativeManifestLimits.maximumChunkBytes, buffer.byteLength - length + 1);
			let next: Awaited<ReturnType<TileflowNativeManifestReader['read']>>;
			try {
				const pending = Promise.resolve(reader!.read(allowance)).catch(() => {
					throw new TileflowNativeSourceError('NATIVE_MANIFEST_REQUEST_FAILED', 'response');
				});
				next = await cancellation.race(pending);
			} catch {
				cancellation.check();
				throw new TileflowNativeSourceError('NATIVE_MANIFEST_REQUEST_FAILED', 'response');
			}
			cancellation.check();
			if (!next || typeof next.done !== 'boolean') throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
			if (next.done) {
				if (next.value !== undefined) throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
				break;
			}
			if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0) throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
			if (next.value.byteLength > buffer.byteLength - length) throw new TileflowNativeSourceError('NATIVE_MANIFEST_TOO_LARGE', 'body');
			if (next.value.byteLength > allowance) throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESPONSE_INVALID', 'response');
			buffer.set(next.value, length);
			length += next.value.byteLength;
		}
		let text: string;
		try { text = decodeNativeManifestUtf8(buffer.subarray(0, length)); }
		catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_UTF8_INVALID', 'body'); }
		if (!hasBoundedNativeManifestDepth(text, tileflowNativeManifestLimits.maximumDepth)) {
			throw new TileflowNativeSourceError('NATIVE_MANIFEST_INVALID', 'body');
		}
		let json: unknown;
		try { json = JSON.parse(text); }
		catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_JSON_INVALID', 'body'); }
		let manifest: TileflowRuntimeManifest;
		try { manifest = parseTileflowRuntimeManifest(json); }
		catch { throw new TileflowNativeSourceError('NATIVE_MANIFEST_INVALID', 'body'); }
		let resolvedBytes = nativeManifestUtf8ByteLength(JSON.stringify(manifest));
		const resolveResource = (value: string, owner: string) => {
			const resolved = resolveTileflowNativeResourceUrl(value, {documentUrl: owner, ...network});
			resolvedBytes += nativeManifestUtf8ByteLength(JSON.stringify(resolved)) - nativeManifestUtf8ByteLength(JSON.stringify(value));
			if (resolvedBytes > tileflowNativeManifestLimits.maximumBytes) {
				throw new TileflowNativeSourceError('NATIVE_MANIFEST_TOO_LARGE', 'body');
			}
			return resolved;
		};
		try {
			for (const name of Object.keys(manifest.maps).sort()) {
				const map = manifest.maps[name]!;
				for (const themeName of Object.keys(map.themes).sort()) {
					const theme = map.themes[themeName]!;
					theme.styleUrl = resolveResource(theme.styleUrl, finalUrl);
					for (const face of theme.fontFaces ?? []) {
						face.source = resolveResource(face.source, theme.styleUrl);
					}
				}
			}
		} catch (error) {
			if (error instanceof TileflowNativeSourceError) throw normalizeNativeSourceError(error);
			throw new TileflowNativeSourceError('NATIVE_MANIFEST_RESOURCE_INVALID', 'body');
		}
		cancellation.check();
		return freezeNativeSnapshot({manifestUrl: finalUrl, manifest});
	} catch (error) {
		cleanup();
		cancellation.check();
		throw normalizeNativeSourceError(error);
	} finally { unlisten(); }
}
