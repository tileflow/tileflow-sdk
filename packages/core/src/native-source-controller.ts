import {isTileflowPortableId} from './portable-identity-rules';
import {resolveTileflowRuntimeTheme, validateTileflowThemeSelection, type TileflowRuntimeManifestMap} from './runtime';
import {loadNativeManifest} from './native-manifest';
import {NativeSourceCancellation} from './native-source-cancellation';
import {
	TileflowNativeSourceError,
	normalizeNativeSourceError,
	type TileflowNativeManifestAcquire,
	type TileflowNativeSource,
	type TileflowNativeSourceOptions,
	type TileflowNativeSourceController,
	type TileflowNativeSourceState,
} from './native-source-types';
import {freezeNativeSnapshot, nativeOwnRecord} from './native-source-utils';

/** A renderer-neutral, manifest-only source lifecycle. No I/O until replace() is called. */
export function createTileflowNativeSourceController(
	options: {acquire: TileflowNativeManifestAcquire},
): TileflowNativeSourceController {
	const input = nativeOwnRecord(options);
	if (!input || typeof input.acquire !== 'function') throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
	const acquire = input.acquire as TileflowNativeManifestAcquire;
	const listeners = new Set<(state: TileflowNativeSourceState) => void>();
	let state: TileflowNativeSourceState | undefined;
	let generation = 0;
	let disposed = false;
	let active: {generation: number; cancellation: NativeSourceCancellation} | undefined;

	const notify = (listener: (value: TileflowNativeSourceState) => void, value: TileflowNativeSourceState) => {
		// Observer failures are not acquisition failures and cannot stop retirement/cleanup.
		try { void Promise.resolve(listener(value)).catch(() => undefined); } catch { /* Isolate caller callbacks. */ }
	};
	const publish = (next: TileflowNativeSourceState) => {
		if (disposed || next.generation !== generation) return;
		state = freezeNativeSnapshot(next);
		for (const listener of [...listeners]) {
			if (disposed || state !== next || generation !== next.generation) break;
			if (listeners.has(listener)) notify(listener, next);
		}
	};

	return {
		get state() { return state; },
		subscribe(listener) {
			if (typeof listener !== 'function') throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
			if (disposed) return () => undefined;
			listeners.add(listener);
			if (state) notify(listener, state);
			return () => { listeners.delete(listener); };
		},
		async replace(source: TileflowNativeSource, options: TileflowNativeSourceOptions = {}) {
			if (disposed) throw new TileflowNativeSourceError('NATIVE_SOURCE_DISPOSED', 'source');
			if (generation >= Number.MAX_SAFE_INTEGER) throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
			// Copy before invoking an observer or a transport cleanup that might reenter the controller.
			const sourceInput = nativeOwnRecord(source);
			const selection = nativeOwnRecord(options);
			const own = {generation: ++generation, cancellation: new NativeSourceCancellation()};
			const previous = active;
			active = own;
			previous?.cancellation.cancel();
			const current = () => !disposed && generation === own.generation;
			let detach = () => undefined as void;
			try {
				if (!current()) return;
				publish({status: 'loading', generation: own.generation});
				if (!current()) return;
				if (!sourceInput || sourceInput.kind !== 'tileflow' || !isTileflowPortableId(sourceInput.map) || !selection) {
					throw new TileflowNativeSourceError('NATIVE_SOURCE_INVALID', 'source');
				}
				if ((selection.theme !== undefined && !validateTileflowThemeSelection(selection.theme)) ||
					(selection.colorScheme !== undefined && selection.colorScheme !== 'light' && selection.colorScheme !== 'dark')) {
					throw new TileflowNativeSourceError('NATIVE_THEME_INVALID', 'theme');
				}
				const selectedSource: TileflowNativeSource = {
					kind: 'tileflow', map: sourceInput.map, manifestUrl: sourceInput.manifestUrl as string,
				};
				detach = own.cancellation.link(selection.signal as TileflowNativeSourceOptions['signal']);
				const result = await loadNativeManifest(selectedSource.manifestUrl, acquire, {
					developmentOrigin: selection.developmentOrigin as string | undefined,
				}, own.cancellation);
				if (!current()) return;
				if (!Object.hasOwn(result.manifest.maps, selectedSource.map)) {
					throw new TileflowNativeSourceError('NATIVE_MAP_NOT_FOUND', 'map');
				}
				const entry = result.manifest.maps[selectedSource.map]!;
				// Preserve declared identity; do not infer Hosted identities or create authorization.
				const apiUrl = entry.apiUrl ?? result.manifest.apiUrl;
				const map: TileflowRuntimeManifestMap = {
					...entry, name: selectedSource.map,
					...(apiUrl === undefined ? {} : {apiUrl}),
				};
				let theme;
				try {
					theme = resolveTileflowRuntimeTheme(map, selection.theme as string | undefined,
						selection.colorScheme as 'dark' | 'light' | undefined);
				} catch { throw new TileflowNativeSourceError('NATIVE_THEME_INVALID', 'theme'); }
				publish({status: 'ready', generation: own.generation, source: selectedSource, ...result, map, theme});
			} catch (error) {
				if (current()) publish({status: 'error', generation: own.generation, error: normalizeNativeSourceError(error)});
			} finally {
				detach();
				if (active === own) active = undefined;
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			const previous = active;
			active = undefined;
			previous?.cancellation.cancel();
		},
	};
}
