import type {TileflowNativeManifestAcquire, TileflowNativeManifestOperation} from '@tileflow/core/native';
import {NativePreparationError} from './native-style-document';

type Cached = Readonly<{key: string; url: string; status: number; bytes: Uint8Array}>;
const maximum = 1_048_576;

/** Theme selection can reuse bytes, not a Core controller or an acquisition cursor. */
export function createNativeManifestCache(acquire: TileflowNativeManifestAcquire) {
	let cached: Cached | undefined;
	let active: TileflowNativeManifestOperation | undefined;
	let epoch = 0;
	const clear = () => {
		epoch++;
		cached?.bytes.fill(0); cached = undefined;
		const previous = active; active = undefined;
		try { void Promise.resolve(previous?.cancel()).catch(() => undefined); } catch { /* The owning document pool retries cleanup. */ }
	};
	const fromCache = (value: Cached): TileflowNativeManifestOperation => {
		let cancelled = false;
		let offset = 0;
		const generation = epoch;
		const cancel = () => { cancelled = true; };
		return {
			response: Promise.resolve({url: value.url, status: value.status, reader: {
				async read(bound) {
					if (cancelled || generation !== epoch || !Number.isSafeInteger(bound) || bound < 1 || bound > 65536) throw new NativePreparationError();
					if (offset === value.bytes.length) return {done: true};
					const bytes = value.bytes.slice(offset, offset + bound); offset += bytes.length;
					return {done: false, value: bytes};
				},
				cancel,
			}}),
			cancel,
		};
	};
	const load: TileflowNativeManifestAcquire = (url, options) => {
		if (options.maximumBytes !== maximum) throw new NativePreparationError();
		if (cached?.key === url) return fromCache(cached);
		clear();
		const generation = epoch;
		const request = acquire(url, options);
		let live = true;
		let completed = false;
		let offset = 0;
		let buffer = new Uint8Array(maximum);
		const cancel = () => {
			live = false;
			buffer.fill(0); buffer = new Uint8Array(0);
			return request.cancel();
		};
		const operation: TileflowNativeManifestOperation = {
			cancel,
			response: request.response.then((response) => {
				if (!live || generation !== epoch) throw new NativePreparationError();
				return {url: response.url, status: response.status, reader: {
					async read(bound) {
						if (!live || generation !== epoch || !Number.isSafeInteger(bound) || bound < 1 || bound > 65536) throw new NativePreparationError();
						if (completed) return {done: true};
						const next = await response.reader.read(bound);
						if (!live || generation !== epoch) throw new NativePreparationError();
						if (next.done === true) {
							completed = true;
							if (response.status === 200) cached = {key: url, url: response.url, status: response.status, bytes: buffer.slice(0, offset)};
							buffer.fill(0); buffer = new Uint8Array(0);
							if (active === operation) active = undefined;
							return {done: true};
						}
						if (next.done !== false || !(next.value instanceof Uint8Array) || !next.value.length || next.value.length > bound || offset + next.value.length > maximum) throw new NativePreparationError();
						buffer.set(next.value, offset); offset += next.value.length;
						return {done: false, value: next.value.slice()};
					},
					cancel,
				}};
			}),
		};
		void operation.response.catch(() => undefined);
		active = operation;
		return operation;
	};
	return Object.freeze({acquire: load, clear});
}
