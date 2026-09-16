import {NativeAdmissionError} from './native-admission-owner';
import {isNativeToken} from './native-admission-url';
import type {NativeAdmissionBridge, NativeAdmissionEvent} from './native-admission-contract';
import {nativeBootstrapLimits, type NativeAdmissionNativeModule, type NativeBootstrapReply} from './native-bootstrap-contract';
import type {HostedNativeSessionFetch, HostedNativeSessionFetchResponse} from './session-controller';

const unavailable = () => new NativeAdmissionError('NATIVE_ADMISSION_UNAVAILABLE');
const invalid = () => new NativeAdmissionError('NATIVE_ADMISSION_INVALID');
const cancelled = () => new NativeAdmissionError('NATIVE_ADMISSION_CANCELLED');

function decodeBoundedBase64(value: unknown): Uint8Array {
	if (typeof value !== 'string' || value.length > Math.ceil(nativeBootstrapLimits.responseBytes / 3) * 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw invalid();
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const length = value.length / 4 * 3 - padding;
	if (length > nativeBootstrapLimits.responseBytes) throw invalid();
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (let index = 0; index < value.length; index += 4) {
		const a = alphabet.indexOf(value[index]);
		const b = alphabet.indexOf(value[index + 1]);
		const c = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2]);
		const d = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3]);
		if (index + 4 === value.length && ((padding === 2 && (b & 15) !== 0) || (padding === 1 && (c & 3) !== 0))) throw invalid();
		const word = a * 262144 + b * 4096 + c * 64 + d;
		if (offset < length) bytes[offset++] = (word >>> 16) & 255;
		if (offset < length) bytes[offset++] = (word >>> 8) & 255;
		if (offset < length) bytes[offset++] = word & 255;
	}
	return bytes;
}

function responseFromWire(reply: NativeBootstrapReply, isAborted: () => boolean): HostedNativeSessionFetchResponse {
	if (!reply || !Number.isInteger(reply.status) || reply.status < 100 || reply.status > 599 ||
		typeof reply.cacheControl !== 'string' || reply.cacheControl.length > 1024) throw invalid();
	let bytes = decodeBoundedBase64(reply.bodyBase64);
	let readerTaken = false;
	return Object.freeze({
		status: reply.status,
		headers: Object.freeze({get(name: string) { return name.toLowerCase() === 'cache-control' ? reply.cacheControl : null; }}),
		body: Object.freeze({getReader() {
			if (readerTaken) throw invalid();
			readerTaken = true;
			let done = false;
			return Object.freeze({
				async read(): Promise<{done: true; value?: undefined} | {done: false; value: Uint8Array}> {
					if (isAborted()) { bytes = new Uint8Array(0); throw cancelled(); }
					if (done) return {done: true};
					done = true;
					const value = bytes;
					bytes = new Uint8Array(0);
					return {done: false, value};
				},
				cancel() { done = true; bytes = new Uint8Array(0); },
			});
		}}),
	});
}

// No React Native import here: deterministic tests exercise the exact wire
// adapter independently of the renderer and platform module loader.
export function createNativeAdmissionWire(
	native: NativeAdmissionNativeModule,
	listen: (listener: (event: NativeAdmissionEvent) => void) => () => void,
) {
	let installation: string | null = null;
	let sequence = 0;
	async function safe<T>(action: () => Promise<T>): Promise<T> {
		try { return await action(); } catch { throw unavailable(); }
	}
	const bridge: NativeAdmissionBridge = Object.freeze({
		subscribe: listen,
		async install() {
			const ack = await safe(() => native.install());
			if (!ack || !isNativeToken(ack.installation)) throw invalid();
			installation = ack.installation;
			return Object.freeze({installation});
		},
		registerContext: (id, registration) => safe(() => native.registerContext(id, registration)),
		retireContext: (id, context) => safe(() => native.retireContext(id, context)),
		completeBatch: (id, context, generation, batch, results) => safe(() => native.completeBatch(id, context, generation, batch, results)),
		async remove(id) {
			if (id === installation) installation = null;
			return safe(() => native.remove(id));
		},
	});

	function fetchForContext(context: string): HostedNativeSessionFetch {
		const installed = installation;
		if (!installed || !isNativeToken(context)) throw invalid();
		return (url, init) => {
			if (installation !== installed || init.signal.aborted) return Promise.reject(cancelled());
			const credential = init.headers['X-Tileflow-Mobile-Client'];
			if (init.method !== 'POST' || init.credentials !== 'omit' || typeof init.body !== 'string' ||
				init.body.length > nativeBootstrapLimits.requestBytes || typeof credential !== 'string' ||
				!/^tf_public_[0-9a-f]{48}$/u.test(credential) || sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(invalid());
			const request = `${installed}.${++sequence}`;
			return new Promise<HostedNativeSessionFetchResponse>((resolve, reject) => {
				let settled = false;
				const cleanup = () => init.signal.removeEventListener('abort', abort);
				const abort = () => {
					if (settled) return;
					settled = true;
					cleanup();
					void safe(() => native.cancelBootstrap(installed, context, request)).catch(() => undefined);
					reject(cancelled());
				};
				init.signal.addEventListener('abort', abort, {once: true});
				if (init.signal.aborted) { abort(); return; }
				let pending: Promise<NativeBootstrapReply>;
				try { pending = Promise.resolve(native.bootstrap(installed, context, request, url, credential, init.body)); }
				catch { settled = true; cleanup(); reject(unavailable()); return; }
				pending.then((reply) => {
					if (settled) return;
					settled = true; cleanup();
					if (init.signal.aborted || installation !== installed) { reject(cancelled()); return; }
					try { resolve(responseFromWire(reply, () => init.signal.aborted)); }
					catch { reject(invalid()); }
				}, () => {
					if (settled) return;
					settled = true; cleanup(); reject(unavailable());
				});
			});
		};
	}
	return Object.freeze({bridge, fetchForContext});
}
