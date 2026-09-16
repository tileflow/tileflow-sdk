import type {NativeAdmissionResource} from './native-admission-contract';
import {NativeAdmissionError} from './native-admission-owner';
import {discriminateNativeResourceForTest, normalizeNativeResources} from './native-admission-url';
import {matchNativeResource} from './native-resource-template';

function mergeGlyphResource(
	previous: NativeAdmissionResource,
	next: NativeAdmissionResource,
): NativeAdmissionResource | undefined {
	if (
		previous.scope !== 'glyph' ||
		next.scope !== 'glyph' ||
		previous.template !== 'glyphs' ||
		next.template !== 'glyphs' ||
		previous.tilesetId !== next.tilesetId ||
		!previous.fontStacks ||
		!next.fontStacks
	) return undefined;
	const fontStacks = [...new Set([...previous.fontStacks, ...next.fontStacks])].sort();
	if (fontStacks.length > 16) return undefined;
	return normalizeNativeResources([{...previous, fontStacks}])[0];
}

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
				const requested = normalizeNativeResources(input);
				const merged = new Map(resources.map((entry) => [entry.url, entry]));
				const nativeUpdates: NativeAdmissionResource[] = [];
				for (const entry of requested) {
					const previous = merged.get(entry.url);
					if (!previous) {
						merged.set(entry.url, entry);
						nativeUpdates.push(entry);
						continue;
					}
					if (JSON.stringify(previous) === JSON.stringify(entry)) continue;
					const union = mergeGlyphResource(previous, entry);
					if (!union) throw invalid();
					merged.set(entry.url, union);
					nativeUpdates.push(union);
				}
				next = normalizeNativeResources([...merged.values()]);
				additions = Object.freeze(nativeUpdates);
			} catch {
				return Promise.reject(invalid());
			}
			if (additions.length === 0) return Promise.resolve(Object.freeze({resources: next.length}));
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
