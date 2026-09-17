import {
	tileflowInteractionLimits,
	tileflowPoiCategories,
	type TileflowInteractionBinding,
	type TileflowInteractionCoordinate,
	type TileflowInteractionDiagnostic,
	type TileflowInteractionJsonValue,
	type TileflowPoiCategory,
	type TileflowPoiProperties,
	type TileflowResolvedPoiFeatureTarget,
} from '@tileflow/interactions';
import {
	freezeNativeInteractionValue,
	nativeInteractionDiagnostic,
	nativeInteractionField as field,
	prepareNativeInteractionInputs,
	snapshotNativeInteractionJson,
} from './native-interaction-input';

export const nativePoiQueryLimit = 512;
export type NativePoiQueryRequest = Readonly<{
	point: readonly [number, number];
	layers: readonly string[];
	limit: number;
}>;
export type NativePoiQueryOperation = Readonly<{
	result: Promise<unknown>;
	cancel(): void;
}>;
/**
 * A private port scoped to one finalized native style on one map. isCurrent must verify that
 * exact ownership, not merely equal style JSON. Each result echoes the identical request object
 * in {request, features}; the platform port may do so only after checking its native ownership.
 * No native handle crosses this renderer-neutral boundary.
 */
export type NativePoiStyleLease = Readonly<{
	style: unknown;
	isCurrent(): boolean;
	query(request: NativePoiQueryRequest): NativePoiQueryOperation;
}>;
export type NativePoiMatch = Readonly<{
	binding: TileflowInteractionBinding;
	target: TileflowResolvedPoiFeatureTarget;
}>;
export type NativePoiQueryResult =
	| Readonly<{status: 'match'; match: NativePoiMatch; diagnostics: readonly TileflowInteractionDiagnostic[]}>
	| Readonly<{status: 'miss' | 'stale' | 'error'; diagnostics: readonly TileflowInteractionDiagnostic[]}>;

type Representation = 'combined' | 'icon' | 'label' | 'marker';
type Layer = Readonly<{
	layerId: string; source: string; sourceLayer?: string;
	category: TileflowPoiCategory; representation: Representation; priority: number;
}>;
type Fields = Readonly<Record<'category' | 'filterRank' | 'icon' | 'name' | 'sizeRank' | 'type', string>>;
type Manifest = Readonly<{layers: readonly Layer[]; fields: Fields; representationPriority: readonly Representation[]}>;
const emptyDiagnostics = Object.freeze([]);
const stale: NativePoiQueryResult = Object.freeze({status: 'stale', diagnostics: emptyDiagnostics});
const miss: NativePoiQueryResult = Object.freeze({status: 'miss', diagnostics: emptyDiagnostics});
const failure = (code: TileflowInteractionDiagnostic['code'] = 'SEMANTIC_MANIFEST_MISMATCH'): NativePoiQueryResult =>
	Object.freeze({status: 'error', diagnostics: Object.freeze([nativeInteractionDiagnostic(code)])});

function array(value: unknown, maximum: number): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
	const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
	if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum) throw new Error();
	const result: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
		result.push(descriptor.value);
	}
	return result;
}
function name(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
		value !== '__proto__' && value !== 'constructor' && value !== 'prototype' &&
		!Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
}
function category(value: unknown): value is TileflowPoiCategory {
	return typeof value === 'string' && tileflowPoiCategories.some((candidate) => candidate === value);
}
function representation(value: unknown): value is Representation {
	return value === 'combined' || value === 'icon' || value === 'label' || value === 'marker';
}
function parseManifest(style: unknown): Manifest {
	if (field(style, 'version') !== 8) throw new Error();
	const metadata = field(style, 'metadata');
	const artifact = snapshotNativeInteractionJson(field(metadata, 'tileflow:interaction-manifest'));
	if (field(artifact, 'version') !== 2) throw new Error();
	const poi = field(field(artifact, 'domains'), 'poi');
	if (field(poi, 'identity') !== 'maplibre-feature-id-if-present') throw new Error();
	const hitTesting = field(poi, 'hitTesting');
	// This is the version-2 artifact vocabulary, not a native hover scheduling contract.
	if (field(hitTesting, 'order') !== 'rendered-topmost' || field(hitTesting, 'frequency') !== 'animation-frame') throw new Error();
	const deduplication = field(poi, 'deduplication');
	const identity = array(field(deduplication, 'identity'), 3);
	if (identity.length !== 3 || identity[0] !== 'source' || identity[1] !== 'source-layer' || identity[2] !== 'feature-id') throw new Error();
	const priorityInput = array(field(deduplication, 'representationPriority'), 4);
	if (priorityInput.length !== 4 || !priorityInput.every(representation) || new Set(priorityInput).size !== 4) throw new Error();
	const fieldsInput = field(poi, 'fields');
	const readField = (key: keyof Fields): string => {
		const value = field(fieldsInput, key);
		if (!name(value)) throw new Error();
		return value;
	};
	const fields: Fields = Object.freeze({
		category: readField('category'), filterRank: readField('filterRank'), icon: readField('icon'),
		name: readField('name'), sizeRank: readField('sizeRank'), type: readField('type'),
	});
	const physical = new Map<string, unknown>();
	for (const layer of array(field(style, 'layers'), 4096)) {
		const id = field(layer, 'id');
		if (!name(id) || physical.has(id)) throw new Error();
		physical.set(id, layer);
	}
	const sources = field(style, 'sources');
	const inputs = array(field(poi, 'layers'), 256);
	if (!inputs.length) throw new Error();
	const layers: Layer[] = [];
	const ids = new Set<string>();
	let namespace: Layer | undefined;
	for (const input of inputs) {
		const layerId = field(input, 'layerId');
		const source = field(input, 'source');
		const sourceLayer = field(input, 'sourceLayer');
		const layerCategory = field(input, 'category');
		const kind = field(input, 'representation');
		const priority = field(input, 'priority');
		if (!name(layerId) || !name(source) || (sourceLayer !== undefined && !name(sourceLayer)) ||
			!category(layerCategory) || !representation(kind) || typeof priority !== 'number' ||
			!Number.isSafeInteger(priority) || priority < 0 || priority > 100_000 || ids.has(layerId) ||
			field(input, 'anchor') !== 'pointer-coordinate') throw new Error();
		const actual = physical.get(layerId);
		if (!actual || field(actual, 'source') !== source || field(actual, 'source-layer') !== sourceLayer) throw new Error();
		const sourceDefinition = field(sources, source);
		if (!sourceDefinition || typeof sourceDefinition !== 'object' || Array.isArray(sourceDefinition)) throw new Error();
		if (namespace && (namespace.source !== source || namespace.sourceLayer !== sourceLayer)) throw new Error();
		const layer: Layer = Object.freeze({layerId, source, ...(sourceLayer === undefined ? {} : {sourceLayer}), category: layerCategory, representation: kind, priority});
		namespace = layer; ids.add(layerId); layers.push(layer);
	}
	return Object.freeze({layers: Object.freeze(layers.sort((left, right) => right.priority - left.priority)), fields, representationPriority: Object.freeze(priorityInput)});
}

function featureId(value: unknown): number | string | undefined {
	if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
	return typeof value === 'string' && value.length > 0 && value.length <= tileflowInteractionLimits.maxFeatureIdLength ? value : undefined;
}
function properties(input: unknown, fields: Fields): TileflowPoiProperties {
	const read = (key: keyof Fields): unknown => {
		try { return field(input, fields[key]); } catch { return undefined; }
	};
	const result: Record<string, TileflowInteractionJsonValue> = {};
	const c = read('category');
	if (category(c)) result.category = c;
	for (const [key, output, max] of [['filterRank', 'filter_rank', 5], ['sizeRank', 'size_rank', 16]] as const) {
		const value = read(key);
		if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max) result[output] = value;
	}
	for (const key of ['name', 'type', 'icon'] as const) {
		const value = read(key);
		if (typeof value === 'string' && value.length <= tileflowInteractionLimits.maxContentTextLength &&
			(key === 'name' || /^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(value))) result[key] = value;
	}
	return Object.freeze(result);
}
export function nativePoiBindingMatches(binding: TileflowInteractionBinding, target: TileflowResolvedPoiFeatureTarget): boolean {
	const selector = binding.target;
	return selector.kind === 'semantic-feature' && selector.domain === 'poi' &&
		(!selector.categories || selector.categories.includes(target.feature.category));
}
function choose(features: unknown[], manifest: Manifest, bindings: readonly TileflowInteractionBinding[], coordinate: TileflowInteractionCoordinate, queried: readonly string[]): NativePoiMatch | undefined {
	type Candidate = {match: NativePoiMatch; layer: Layer; renderedIndex: number};
	const candidates: Candidate[] = [];
	const byIdentity = new Map<string, number>();
	const allowed = new Set(queried);
	for (const [renderedIndex, feature] of features.entries()) {
		const id = field(field(feature, 'layer'), 'id');
		const layer = manifest.layers.find((value) => value.layerId === id);
		if (!layer || !allowed.has(layer.layerId)) continue;
		if (field(feature, 'source') !== layer.source || field(feature, 'sourceLayer') !== layer.sourceLayer) throw new Error();
		const binding = bindings.find((value) => value.target.kind === 'semantic-feature' && value.target.domain === 'poi' &&
			(!value.target.categories || value.target.categories.includes(layer.category)));
		if (!binding) continue;
		const stable = featureId(field(feature, 'id'));
		const target: TileflowResolvedPoiFeatureTarget = freezeNativeInteractionValue({
			kind: 'semantic-feature', domain: 'poi', coordinate, bindingId: binding.id,
			feature: {category: layer.category, ...(stable === undefined ? {} : {id: stable}), properties: properties(field(feature, 'properties'), manifest.fields)},
		});
		const candidate: Candidate = {layer, renderedIndex, match: Object.freeze({binding, target})};
		const identity = stable === undefined ? undefined : `${typeof stable}:${String(stable)}`;
		const existingIndex = identity === undefined ? undefined : byIdentity.get(identity);
		if (existingIndex === undefined) {
			if (identity !== undefined) byIdentity.set(identity, candidates.length);
			candidates.push(candidate);
		} else {
			const existing = candidates[existingIndex]!;
			const nextPriority = manifest.representationPriority.indexOf(layer.representation);
			const oldPriority = manifest.representationPriority.indexOf(existing.layer.representation);
			if (nextPriority < oldPriority || (nextPriority === oldPriority && layer.priority > existing.layer.priority))
				candidates[existingIndex] = {...candidate, renderedIndex: Math.min(existing.renderedIndex, renderedIndex)};
		}
	}
	return candidates.sort((a, b) => a.renderedIndex - b.renderedIndex || b.layer.priority - a.layer.priority)[0]?.match;
}

export function createNativePoiAdapter() {
	let disposed = false;
	let generation = 0;
	let intent = 0;
	let lease: NativePoiStyleLease | undefined;
	let manifest: Manifest | undefined;
	type Pending = {live: boolean; resolve(result: NativePoiQueryResult): void; cancel?: () => void};
	let pending: Pending | undefined;
	const inspect = (candidate: NativePoiStyleLease | undefined, expected: number): 'current' | 'stale' | 'error' => {
		const live = () => !disposed && generation === expected && lease === candidate;
		if (!live()) return 'stale';
		try {
			const owned = candidate?.isCurrent() === true;
			return live() && owned ? 'current' : 'stale';
		} catch { return live() ? 'error' : 'stale'; }
	};
	const stopPending = () => {
		const job = pending; pending = undefined;
		if (!job) return;
		job.live = false; job.resolve(stale);
		try { job.cancel?.(); } catch { /* Cancellation cannot transfer style ownership. */ }
	};
	const cancelQueries = () => { ++intent; stopPending(); };
	return Object.freeze({
		get available() {
			const parsed = manifest;
			return !!parsed && inspect(lease, generation) === 'current' && manifest === parsed;
		},
		supports(target: TileflowResolvedPoiFeatureTarget): boolean {
			const parsed = manifest;
			return !!parsed && inspect(lease, generation) === 'current' && manifest === parsed &&
				parsed.layers.some((layer) => layer.category === target.feature.category);
		},
		replaceStyle(next?: NativePoiStyleLease): readonly TileflowInteractionDiagnostic[] {
			if (disposed) return emptyDiagnostics;
			const expected = ++generation;
			manifest = undefined; lease = next;
			cancelQueries();
			if (!next || inspect(next, expected) !== 'current') return next && generation === expected ? failure().diagnostics : emptyDiagnostics;
			try {
				const parsed = parseManifest(next.style);
				if (inspect(next, expected) === 'current') { manifest = parsed; return emptyDiagnostics; }
			} catch { /* Only fixed portable diagnostics leave the native boundary. */ }
			return generation === expected ? failure().diagnostics : emptyDiagnostics;
		},
		cancelQueries,
		queryTouch(input: unknown, bindingsInput: readonly TileflowInteractionBinding[]): Promise<NativePoiQueryResult> {
			const ticket = ++intent;
			const expected = generation;
			const invocationIsLive = () => !disposed && intent === ticket && generation === expected;
			const answer = (value: NativePoiQueryResult) => Promise.resolve(invocationIsLive() ? value : stale);
			stopPending();
			if (!invocationIsLive()) return Promise.resolve(stale);
			const owner = lease;
			const selected = manifest;
			let point: readonly [number, number];
			let coordinate: TileflowInteractionCoordinate;
			try {
				if (field(input, 'inputModality') !== 'touch') return answer(failure('UNSUPPORTED_MODE'));
				const p = array(field(input, 'point'), 2);
				const c = array(field(input, 'coordinate'), 2);
				if (p.length !== 2 || c.length !== 2 || !p.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000) ||
					!c.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
					typeof p[0] !== 'number' || typeof p[1] !== 'number' || typeof c[0] !== 'number' || typeof c[1] !== 'number' ||
					c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) throw new Error();
				point = Object.freeze([p[0], p[1]] as const); coordinate = Object.freeze([c[0], c[1]] as const);
			} catch { return answer(failure('INVALID_DOCUMENT')); }
			const prepared = prepareNativeInteractionInputs({interactions: bindingsInput});
			if (prepared.diagnostics.length) return answer(Object.freeze({status: 'error', diagnostics: prepared.diagnostics}));
			const bindings = prepared.bindings.filter((binding) => binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi');
			if (!bindings.length) return answer(prepared.bindings.length ? failure('UNSUPPORTED_TARGET') : miss);
			if (!owner || !selected) return answer(failure());
			const ownership = inspect(owner, expected);
			if (ownership !== 'current') return answer(ownership === 'error' ? failure() : stale);
			const layers = selected.layers.filter((layer) => bindings.some((binding) => binding.target.kind === 'semantic-feature' &&
				(!binding.target.categories || binding.target.categories.includes(layer.category)))).map((layer) => layer.layerId);
			if (!layers.length) return answer(miss);
			if (!invocationIsLive()) return Promise.resolve(stale);
			const request: NativePoiQueryRequest = Object.freeze({point, layers: Object.freeze(layers), limit: nativePoiQueryLimit});
			let resolve!: (value: NativePoiQueryResult) => void;
			const result = new Promise<NativePoiQueryResult>((yes) => { resolve = yes; });
			const job: Pending = {live: true, resolve}; pending = job;
			const finish = (value: NativePoiQueryResult) => {
				if (!job.live || pending !== job) return;
				const ownership = inspect(owner, expected);
				if (!job.live || pending !== job) return;
				pending = undefined; job.live = false;
				resolve(ownership === 'error' ? failure() : ownership === 'current' && invocationIsLive() ? value : stale);
			};
			try {
				const operation = owner.query(request);
				const cancel = operation.cancel;
				if (typeof cancel !== 'function') throw new Error();
				let cancelled = false;
				job.cancel = () => { if (!cancelled) { cancelled = true; cancel.call(operation); } };
				void Promise.resolve(operation.result).then((value) => {
					if (!job.live || pending !== job) return;
					try {
						const ownership = inspect(owner, expected);
						if (ownership !== 'current') { finish(ownership === 'error' ? failure() : stale); return; }
						if (field(value, 'request') !== request) throw new Error();
						const raw = field(value, 'features');
						const length = Array.isArray(raw) ? Object.getOwnPropertyDescriptor(raw, 'length')?.value as unknown : undefined;
						if (typeof length === 'number' && length > nativePoiQueryLimit) { finish(failure('LIMIT_EXCEEDED')); return; }
						const match = choose(array(raw, nativePoiQueryLimit), selected, bindings, coordinate, layers);
						finish(match ? Object.freeze({status: 'match', match, diagnostics: emptyDiagnostics}) : miss);
					} catch { finish(failure()); }
				}, () => finish(failure()));
				if (!job.live || pending !== job || inspect(owner, expected) !== 'current') {
					if (pending === job) cancelQueries();
					else { try { job.cancel(); } catch { /* A retired query has no observers. */ } }
				}
			} catch { finish(failure()); }
			return result;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true; ++generation; lease = undefined; manifest = undefined;
			cancelQueries();
		},
	});
}
