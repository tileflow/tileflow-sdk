import {serializeCanonicalJson, type MapLibreStyle} from '@tileflow/core';
import {
	createTileflowNativeDiagnostic,
	TileflowNativeCompatibilityError,
	type TileflowNativeBuildRecord,
} from '@tileflow/core/native-profile';

type Changes = TileflowNativeBuildRecord['transformations'][number]['layers'];
type Json = Record<string, unknown>;
const overlayKeys = ['above-water', 'below-roads', 'above-roads', 'above-buildings', 'below-labels', 'above-labels'];
function object(value: unknown): Json {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
	return value as Json;
}

/** Rebind physical references only after the existing bounded representation lowering completes. */
export function finalizeNativeHostedProvenance(
	input: MapLibreStyle,
	lowered: MapLibreStyle,
	changes: Changes,
): MapLibreStyle {
	try {
		const result: MapLibreStyle = JSON.parse(serializeCanonicalJson(lowered));
		const originalIndexes = new Map<string, number>();
		const finalIndexes = new Map<string, number>();
		const starts = new Map<string, number>();
		const transformed = new Map(changes.map((change) => [change.layerId, change]));
		if (transformed.size !== changes.length) throw new Error();
		for (const [index, layer] of result.layers.entries()) {
			if (finalIndexes.has(layer.id)) throw new Error();
			finalIndexes.set(layer.id, index);
		}
		let offset = 0;
		for (const [index, layer] of input.layers.entries()) {
			if (originalIndexes.has(layer.id)) throw new Error();
			originalIndexes.set(layer.id, index);
			starts.set(layer.id, offset);
			const change = transformed.get(layer.id);
			if (change && (change.path !== `/layers/${index}` || layer.type !== 'line')) throw new Error();
			const count = change?.outputLayers ?? 1;
			if (!Number.isSafeInteger(count) || count < 0 || offset + count > result.layers.length) throw new Error();
			for (let branch = 0; branch < count; branch++) {
				const candidate = result.layers[offset + branch]!;
				if (!change && candidate.id !== layer.id) throw new Error();
				if (candidate.type !== layer.type ||
					('source' in candidate ? candidate.source : undefined) !== ('source' in layer ? layer.source : undefined) ||
					('source-layer' in candidate ? candidate['source-layer'] : undefined) !== ('source-layer' in layer ? layer['source-layer'] : undefined)) throw new Error();
			}
			offset += count;
		}
		if (offset !== result.layers.length || changes.some((change) => !originalIndexes.has(change.layerId))) throw new Error();
		const metadata = result.metadata === undefined ? undefined : object(result.metadata);
		const originalMetadata = input.metadata === undefined ? undefined : object(input.metadata);
		if (originalMetadata?.['tileflow:overlay-placement-manifest'] !== undefined) {
			if (!metadata) throw new Error();
			const overlay = object(originalMetadata['tileflow:overlay-placement-manifest']);
			const anchors = object(overlay.anchors);
			if (overlay.schemaVersion !== 1 || Object.keys(anchors).length !== overlayKeys.length ||
				overlayKeys.some((key) => !Object.hasOwn(anchors, key))) throw new Error();
			const updated: Record<string, string | null> = {};
			for (const key of overlayKeys) {
				const anchor = anchors[key];
				if (anchor === null) { updated[key] = null; continue; }
				if (typeof anchor !== 'string' || !starts.has(anchor)) throw new Error();
				updated[key] = result.layers[starts.get(anchor)!]?.id ?? null;
			}
			metadata['tileflow:overlay-placement-manifest'] = {...overlay, anchors: updated};
		}
		if (originalMetadata?.['tileflow:interaction-manifest'] !== undefined) {
			if (!metadata) throw new Error();
			const manifest = object(JSON.parse(serializeCanonicalJson(originalMetadata['tileflow:interaction-manifest'])));
			if (manifest.version !== 2) throw new Error();
			const domains = object(manifest.domains);
			if (domains.poi !== undefined) {
				const poi = object(domains.poi);
				if (!Array.isArray(poi.layers)) throw new Error();
				poi.layers = poi.layers.map((value) => {
					const entry = object(value);
					if (typeof entry.layerId !== 'string' || originalIndexes.get(entry.layerId) !== entry.priority ||
						!finalIndexes.has(entry.layerId) || transformed.has(entry.layerId)) throw new Error();
					return {...entry, priority: finalIndexes.get(entry.layerId)!};
				});
			}
			metadata['tileflow:interaction-manifest'] = manifest;
		}
		return result;
	} catch {
		throw new TileflowNativeCompatibilityError([
			createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE', '/metadata'),
		]);
	}
}
