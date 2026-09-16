import {NativeAdmissionError} from './native-admission-owner';
import {isNativeToken} from './native-admission-url';
import {nativeAdmissionLimits, type NativeAdmissionBridge, type NativeAdmissionEvent} from './native-admission-contract';
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

function responseFromWire(reply: NativeBootstrapReply, isAborted: () => boolean, release: () => void) {
	if (!reply || !Number.isInteger(reply.status) || reply.status < 100 || reply.status > 599 ||
		typeof reply.cacheControl !== 'string' || reply.cacheControl.length > 1024) throw invalid();
	// Do not retain the wire object (and its encoded body) in header closures.
	const status = reply.status;
	const cacheControl = reply.cacheControl;
	let bytes = decodeBoundedBase64(reply.bodyBase64);
	let readerTaken = false;
	let done = false;
	const clear = () => { bytes.fill(0); bytes = new Uint8Array(0); done = true; release(); };
	const response: HostedNativeSessionFetchResponse = Object.freeze({
		status,
		headers: Object.freeze({get(name: string) { return name.toLowerCase() === 'cache-control' ? cacheControl : null; }}),
		body: Object.freeze({getReader() {
			if (readerTaken) throw invalid();
			readerTaken = true;
			return Object.freeze({
				async read(): Promise<{done: true; value?: undefined} | {done: false; value: Uint8Array}> {
					if (isAborted()) { clear(); throw cancelled(); }
					if (done) return {done: true};
					done = true;
					const value = bytes;
					bytes = new Uint8Array(0);
					release();
					return {done: false, value};
				},
				cancel: clear,
			});
		}}),
	});
	return {response, clear};
}

type ContextGate = {live: boolean; cancel: Set<() => void>};
type Installation = {id: string; contexts: Map<string, ContextGate>};

// No renderer dependency. Native validates registration and request identity;
// these gates bound bridge work and invalidate already-delivered readers.
export function createNativeAdmissionWire(
	native: NativeAdmissionNativeModule,
	listen: (listener: (event: NativeAdmissionEvent) => void) => () => void,
) {
	let installation: Installation | null = null;
	let sequence = 0;
	const reservations = new Set<string>();
	async function safe<T>(action: () => Promise<T>): Promise<T> {
		try { return await action(); } catch { throw unavailable(); }
	}
	function retireContext(context: string) {
		const gate = installation?.contexts.get(context);
		if (!gate) return;
		gate.live = false;
		for (const abort of [...gate.cancel]) abort();
		installation?.contexts.delete(context);
	}
	function retireInstallation() {
		if (!installation) return;
		for (const context of [...installation.contexts.keys()]) retireContext(context);
		installation = null;
	}
	const bridge: NativeAdmissionBridge = Object.freeze({
		subscribe(listener) {
			return listen((event) => {
				if (event && event.installation === installation?.id) {
					if (event.kind === 'retired') retireContext(event.context);
					if (event.kind === 'ownershipLost') retireInstallation();
					if (event.kind === 'lifecycle' && !event.foreground) {
						for (const gate of installation?.contexts.values() ?? []) for (const abort of [...gate.cancel]) abort();
					}
				}
				listener(event);
			});
		},
		async install() {
			const ack = await safe(() => native.install());
			if (!ack || !isNativeToken(ack.installation)) throw invalid();
			retireInstallation();
			installation = {id: ack.installation, contexts: new Map()};
			return Object.freeze({installation: ack.installation});
		},
		registerContext: (id, registration) => safe(() => native.registerContext(id, registration)),
		retireContext(id, context) {
			if (id === installation?.id) retireContext(context);
			return safe(() => native.retireContext(id, context));
		},
		completeBatch: (id, context, generation, batch, results) => safe(() => native.completeBatch(id, context, generation, batch, results)),
		remove(id) {
			if (id === installation?.id) retireInstallation();
			return safe(() => native.remove(id));
		},
	});

	function fetchForContext(context: string): HostedNativeSessionFetch {
		const installed = installation;
		if (!installed || !isNativeToken(context)) throw invalid();
		let gate = installed.contexts.get(context);
		if (!gate) {
			if (installed.contexts.size >= nativeAdmissionLimits.contexts) throw unavailable();
			gate = {live: true, cancel: new Set()};
			installed.contexts.set(context, gate);
		}
		const scope = gate;
		return (url, init) => {
			const active = () => installation === installed && scope.live && !init.signal.aborted;
			if (!active()) return Promise.reject(cancelled());
			if (reservations.size >= nativeBootstrapLimits.queueDepth) return Promise.reject(unavailable());
			const credential = init.headers['X-Tileflow-Mobile-Client'];
			if (init.method !== 'POST' || init.credentials !== 'omit' || typeof init.body !== 'string' ||
				init.body.length > nativeBootstrapLimits.requestBytes || typeof credential !== 'string' ||
				!/^tf_public_[0-9a-f]{48}$/u.test(credential) || sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(invalid());
			const request = `${installed.id}.${++sequence}`;
			reservations.add(request);
			return new Promise<HostedNativeSessionFetchResponse>((resolve, reject) => {
				let settled = false;
				let aborted = false;
				let dispatched = false;
				let nativeFinished = false;
				let bodyFinished = true;
				let clearBody: (() => void) | undefined;
				const cleanup = () => init.signal.removeEventListener('abort', abort);
				const release = () => {
					if (!nativeFinished || !bodyFinished) return;
					reservations.delete(request); scope.cancel.delete(abort); cleanup(); clearBody = undefined;
				};
				const abort = () => {
					if (aborted) return;
					aborted = true; cleanup();
					clearBody?.(); bodyFinished = true;
					if (dispatched && !nativeFinished) void safe(() => native.cancelBootstrap(installed.id, context, request)).catch(() => undefined);
					if (!settled) { settled = true; reject(cancelled()); }
					release();
				};
				scope.cancel.add(abort);
				init.signal.addEventListener('abort', abort, {once: true});
				if (!active()) { nativeFinished = true; abort(); return; }
				let pending: Promise<NativeBootstrapReply>;
				try { dispatched = true; pending = Promise.resolve(native.bootstrap(installed.id, context, request, url, credential, init.body)); }
				catch { nativeFinished = true; settled = true; cleanup(); release(); reject(unavailable()); return; }
				pending.then((reply) => {
					nativeFinished = true;
					if (settled) { release(); return; }
					if (!active()) { abort(); return; }
					settled = true; cleanup();
					try {
						const result = responseFromWire(reply, () => aborted || !active(), () => { bodyFinished = true; release(); });
						bodyFinished = false; clearBody = result.clear; resolve(result.response);
					} catch { release(); reject(invalid()); }
				}, () => {
					nativeFinished = true;
					if (!settled) { settled = true; cleanup(); reject(unavailable()); }
					release();
				});
			});
		};
	}
	return Object.freeze({bridge, fetchForContext});
}
