import {nativeInteractionField as field} from './native-interaction-input';
import {
	nativePoiQueryLimit,
	type NativePoiQueryOperation,
	type NativePoiQueryRequest,
	type NativePoiStyleLease,
} from './native-interaction-poi';

/** Private structural subset of the pinned MapRef; never returned to application code. */
export type NativeInteractionQuery = (
	point: [number, number],
	options: {layers: string[]},
) => Promise<unknown>;

type PhysicalLayer = Readonly<{id: string; source: string; sourceLayer?: string; index: number}>;

function length(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
	const size: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > maximum)
		throw new Error();
	return size;
}
function item(value: unknown, index: number): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
	return descriptor.value;
}
function array(value: unknown, maximum: number): unknown[] {
	const count = length(value, maximum);
	return Array.from({length: count}, (_, index) => item(value, index));
}
function name(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** The Stage A adapter validates the entire manifest before this private port is called. */
function requestedLayers(style: unknown, request: NativePoiQueryRequest): PhysicalLayer[] {
	if (field(style, 'version') !== 8 || request.limit !== nativePoiQueryLimit) throw new Error();
	const point = array(request.point, 2);
	if (point.length !== 2 || !point.every((value) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000))
		throw new Error();
	const requested = array(request.layers, 256);
	if (!requested.length || new Set(requested).size !== requested.length) throw new Error();
	const physical = array(field(style, 'layers'), 4096);
	const sources = field(style, 'sources');
	const artifact = field(field(style, 'metadata'), 'tileflow:interaction-manifest');
	if (field(artifact, 'version') !== 2) throw new Error();
	const semantic = array(field(field(field(artifact, 'domains'), 'poi'), 'layers'), 256);
	let previous = physical.length;
	return requested.map((id) => {
		if (!name(id)) throw new Error();
		const indices = physical.flatMap((layer, index) => field(layer, 'id') === id ? [index] : []);
		const declared = semantic.filter((layer) => field(layer, 'layerId') === id);
		if (indices.length !== 1 || declared.length !== 1) throw new Error();
		const index = indices[0]!;
		const layer = physical[index];
		const source = field(layer, 'source');
		const sourceLayer = field(layer, 'source-layer');
		if (
			index >= previous || field(declared[0], 'priority') !== index ||
			!name(source) || (sourceLayer !== undefined && !name(sourceLayer)) ||
			field(declared[0], 'source') !== source ||
			field(declared[0], 'sourceLayer') !== sourceLayer
		) throw new Error();
		const definition = field(sources, source);
		if (field(definition, 'type') !== 'vector' && field(definition, 'type') !== 'geojson')
			throw new Error();
		previous = index;
		return Object.freeze({id, source, ...(sourceLayer === undefined ? {} : {sourceLayer}), index});
	});
}

/**
 * Single-layer filters recover provenance lost by the pinned native serializers. The physical
 * lookup is tied to the exact finalized style, not layer names inferred from feature properties.
 * The caller supplies a proof backed by the Tileflow native-surface style token and map owner.
 */
export function createNativeInteractionQuery(
	style: unknown,
	current: () => boolean,
	query: NativeInteractionQuery,
) {
	let retired = false;
	let pending: {cancel(): void} | undefined;
	const isCurrent = () => !retired && current();
	const stop = () => {
		const previous = pending;
		pending = undefined;
		previous?.cancel();
	};
	const lease: NativePoiStyleLease = Object.freeze({
		style,
		isCurrent,
		query(request: NativePoiQueryRequest): NativePoiQueryOperation {
			stop();
			let live = true;
			let resolve!: (value: unknown) => void;
			let reject!: (error: Error) => void;
			const result = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
			const cancel = () => {
				if (!live) return;
				live = false;
				if (pending === job) pending = undefined;
				reject(new Error('Native interaction query is no longer current.'));
			};
			const job = {cancel};
			pending = job;
			const owns = () => live && pending === job && isCurrent();
			void Promise.resolve().then(async () => {
				if (!owns()) { cancel(); return; }
				// Validate every layer before issuing even the first native query.
				const layers = requestedLayers(style, request);
				const features: unknown[] = [];
				for (const layer of layers) {
					if (!owns()) { cancel(); return; }
					const hits = await query([request.point[0], request.point[1]], {layers: [layer.id]});
					if (!owns()) { cancel(); return; }
					const count = length(hits);
					// A 513th actual hit is an overflow witness, never a successful truncated result.
					// Stage A rejects this envelope with its existing LIMIT_EXCEEDED diagnostic.
					const read = Math.min(count, nativePoiQueryLimit + 1 - features.length);
					for (let index = 0; index < read; index++) {
						const feature = item(hits, index);
						if (field(feature, 'type') !== 'Feature') throw new Error();
						features.push(Object.freeze({
							id: field(feature, 'id'),
							properties: field(feature, 'properties'),
							layer: Object.freeze({id: layer.id}),
							source: layer.source,
							...(layer.sourceLayer === undefined ? {} : {sourceLayer: layer.sourceLayer}),
						}));
					}
					if (features.length > nativePoiQueryLimit) break;
				}
				if (!owns()) { cancel(); return; }
				pending = undefined;
				live = false;
				resolve(Object.freeze({request, features: Object.freeze(features)}));
			}).catch(() => {
				if (!live) return;
				live = false;
				if (pending === job) pending = undefined;
				reject(new Error('Native interaction query failed.'));
			});
			return Object.freeze({result, cancel});
		},
	});
	return Object.freeze({
		lease,
		cancel: stop,
		retire(): void {
			retired = true;
			stop();
		},
	});
}
