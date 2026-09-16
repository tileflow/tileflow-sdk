import type {NativeAdmissionResource} from './native-admission-contract';
import {NativeAdmissionError} from './native-admission-owner';
import {discriminateNativeResourceForTest, normalizeNativeResources} from './native-admission-url';
import {matchNativeResource} from './native-resource-template';

/** The native receipt commits new resources; failed or retired work never expands JS authority. */
export function createNativeAdmissionCatalog(
	initial: readonly NativeAdmissionResource[],
	context: string,
	extendNative: (resources: readonly NativeAdmissionResource[]) => Promise<Readonly<{resources: number}>>,
) {
	let resources = normalizeNativeResources(initial);
	let live = true;
	let pending: {cancel(): void} | undefined;
	const invalid = () => new NativeAdmissionError('NATIVE_ADMISSION_INVALID');
	const cancelled = () => new NativeAdmissionError('NATIVE_ADMISSION_CANCELLED');
	return Object.freeze({
		match(url: string): NativeAdmissionResource | undefined {
			if (!live) return undefined;
			return matchNativeResource(resources, url);
		},
		discriminate(url: string): string {
			try {
				if (!live || (!resources.some((item) => item.url === url) && !matchNativeResource(resources, url))) throw invalid();
				return discriminateNativeResourceForTest(url, context);
			} catch {
				throw invalid();
			}
		},
		extend(input: readonly NativeAdmissionResource[]): Promise<Readonly<{resources: number}>> {
			if (!live) return Promise.reject(cancelled());
			if (pending) return Promise.reject(new NativeAdmissionError('NATIVE_ADMISSION_UNAVAILABLE'));
			let next: readonly NativeAdmissionResource[];
			let additions: readonly NativeAdmissionResource[];
			try {
				additions = normalizeNativeResources(input);
				const merged = new Map(resources.map((entry) => [entry.url, entry]));
				for (const entry of additions) {
					const previous = merged.get(entry.url);
					if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw invalid();
					merged.set(entry.url, entry);
				}
				next = normalizeNativeResources([...merged.values()]);
			} catch {
				return Promise.reject(invalid());
			}
			let resolve!: (ack: Readonly<{resources: number}>) => void;
			let reject!: (error: NativeAdmissionError) => void;
			const result = new Promise<Readonly<{resources: number}>>((yes, no) => { resolve = yes; reject = no; });
			void result.catch(() => undefined);
			const operation = {cancel: () => reject(cancelled())};
			pending = operation;
			void Promise.resolve().then(() => {
				if (!live || pending !== operation) throw cancelled();
				return extendNative(additions);
			}).then((ack) => {
				if (!live || pending !== operation) return;
				if (!ack || ack.resources !== next.length) throw invalid();
				resources = next;
				pending = undefined;
				resolve(Object.freeze({resources: resources.length}));
			}).catch(() => {
				if (!live || pending !== operation) return;
				pending = undefined;
				reject(new NativeAdmissionError('NATIVE_ADMISSION_UNAVAILABLE'));
			});
			return result;
		},
		retire(): void {
			if (!live) return;
			live = false;
			pending?.cancel();
			pending = undefined;
			resources = Object.freeze([]);
		},
	});
}
