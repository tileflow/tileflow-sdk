import {
	initialTileflowInteractionState,
	tileflowInteractionJsonValueSchema,
	tileflowInteractionLimits,
	tileflowInteractionStateSchema,
	validateTileflowAnnotations,
	validateTileflowInteractionBindings,
	type TileflowAnnotation,
	type TileflowInteractionBinding,
	type TileflowInteractionDiagnostic,
	type TileflowInteractionDiagnosticCode,
	type TileflowInteractionJsonValue,
	type TileflowInteractionState,
} from '@tileflow/interactions';

export type NativeInteractionInput = Readonly<{
	annotations?: unknown;
	interactions?: unknown;
	interactionState?: unknown;
	defaultInteractionState?: unknown;
}>;
export type NativePreparedInteractions = Readonly<{
	annotations: readonly TileflowAnnotation[];
	bindings: readonly TileflowInteractionBinding[];
	state: TileflowInteractionState;
	ownership: 'controlled' | 'uncontrolled';
	diagnostics: readonly TileflowInteractionDiagnostic[];
}>;

const messages: Record<TileflowInteractionDiagnosticCode, string> = {
	DUPLICATE_ANNOTATION_ID: 'Annotation IDs must be unique.',
	INVALID_FIELD: 'An interaction field is invalid.',
	INVALID_ANNOTATION: 'An annotation is invalid.',
	INVALID_DOCUMENT: 'The interaction document or state ownership is invalid.',
	LIMIT_EXCEEDED: 'The portable interaction limit was exceeded.',
	MISSING_VIEW: 'The interaction view is unavailable.',
	OVERLAY_FAILURE: 'The interaction operation failed.',
	SEMANTIC_MANIFEST_MISMATCH: 'The current style cannot provide verified semantic POI queries.',
	STALE_TARGET: 'The interaction target is no longer available.',
	UNSTABLE_FEATURE_IDENTITY: 'A stable feature ID is required for popup state.',
	UNSUPPORTED_MODE: 'This interaction input modality is unavailable.',
	UNSUPPORTED_TARGET: 'This interaction target is unavailable.',
};

export function nativeInteractionDiagnostic(code: TileflowInteractionDiagnosticCode): TileflowInteractionDiagnostic {
	return Object.freeze({
		code,
		level: code === 'STALE_TARGET' || code === 'UNSUPPORTED_TARGET' ? 'warning' : 'error',
		message: messages[code],
	});
}

/** Reads data properties only; native exceptions and accessors never become diagnostics. */
export function nativeInteractionField(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== null && prototype !== Object.prototype) throw new Error();
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!('value' in descriptor) || !descriptor.enumerable) throw new Error();
	return descriptor.value;
}

/** Copies bounded portable JSON without retaining caller objects or invoking getters/toJSON. */
export function snapshotNativeInteractionJson(input: unknown): TileflowInteractionJsonValue {
	if (!tileflowInteractionJsonValueSchema.safeParse(input).success) throw new Error();
	let nodes = 0;
	let properties = 0;
	const seen = new WeakSet<object>();
	const copy = (value: unknown, depth: number): TileflowInteractionJsonValue => {
		if (++nodes > tileflowInteractionLimits.maxDocumentNodes || depth > tileflowInteractionLimits.maxDocumentDepth) throw new Error();
		if (value === null || typeof value === 'boolean') return value;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && value.length <= tileflowInteractionLimits.maxDocumentBytes) return value;
		if (!value || typeof value !== 'object' || seen.has(value)) throw new Error();
		seen.add(value);
		const array = Array.isArray(value);
		const prototype: unknown = Object.getPrototypeOf(value);
		if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error();
		if (array) {
			const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
			if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > tileflowInteractionLimits.maxDocumentProperties - properties) throw new Error();
			properties += length;
			const result: TileflowInteractionJsonValue[] = [];
			for (let index = 0; index < length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
				if (descriptor && (!('value' in descriptor) || !descriptor.enumerable)) throw new Error();
				result.push(copy(descriptor ? descriptor.value : null, depth + 1));
			}
			return Object.freeze(result);
		}
		const keys = Reflect.ownKeys(value);
		if (keys.length > tileflowInteractionLimits.maxDocumentProperties - properties) throw new Error();
		properties += keys.length;
		const result: Record<string, TileflowInteractionJsonValue> = {};
		for (const key of keys) {
			if (typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error();
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
			result[key] = copy(descriptor.value, depth + 1);
		}
		return Object.freeze(result);
	};
	const snapshot = copy(input, 0);
	if (!tileflowInteractionJsonValueSchema.safeParse(snapshot).success) throw new Error();
	return snapshot;
}

/** Only called with schema output whose JSON data has already been detached from its caller. */
export function freezeNativeInteractionValue<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeNativeInteractionValue(child);
		Object.freeze(value);
	}
	return value;
}

export function nativeInteractionValuesEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const a = Object.keys(left).sort();
	const b = Object.keys(right).sort();
	return a.length === b.length && a.every((key, index) => key === b[index] && nativeInteractionValuesEqual(
		Object.getOwnPropertyDescriptor(left, key)?.value,
		Object.getOwnPropertyDescriptor(right, key)?.value,
	));
}

export function prepareNativeInteractionInputs(
	input: NativeInteractionInput,
	previous?: NativePreparedInteractions,
): NativePreparedInteractions {
	let annotations = previous?.annotations ?? Object.freeze([]);
	let bindings = previous?.bindings ?? Object.freeze([]);
	let state = previous?.state ?? initialTileflowInteractionState;
	let ownership = previous?.ownership ?? 'uncontrolled';
	const diagnostics: TileflowInteractionDiagnostic[] = [];
	const report = (code: TileflowInteractionDiagnosticCode) => {
		if (!diagnostics.some((value) => value.code === code)) diagnostics.push(nativeInteractionDiagnostic(code));
	};
	try {
		const raw = nativeInteractionField(input, 'annotations');
		let result = validateTileflowAnnotations(raw === undefined ? [] : raw);
		if (result.ok) result = validateTileflowAnnotations(snapshotNativeInteractionJson(result.annotations));
		if (result.ok) {
			if (!nativeInteractionValuesEqual(annotations, result.annotations)) annotations = freezeNativeInteractionValue(result.annotations);
		} else for (const diagnostic of result.diagnostics) report(diagnostic.code);
	} catch { report('INVALID_DOCUMENT'); }
	try {
		const raw = nativeInteractionField(input, 'interactions');
		let result = validateTileflowInteractionBindings(raw === undefined ? [] : raw);
		if (result.ok) result = validateTileflowInteractionBindings(snapshotNativeInteractionJson(result.bindings));
		if (result.ok) {
			if (!nativeInteractionValuesEqual(bindings, result.bindings)) bindings = freezeNativeInteractionValue(result.bindings);
		} else for (const diagnostic of result.diagnostics) report(diagnostic.code);
	} catch { report('INVALID_DOCUMENT'); }
	try {
		const controlled = nativeInteractionField(input, 'interactionState');
		const initial = nativeInteractionField(input, 'defaultInteractionState');
		const requested = controlled !== undefined ? 'controlled' : 'uncontrolled';
		if (!previous) ownership = requested;
		if ((controlled !== undefined && initial !== undefined) || ownership !== requested) throw new Error();
		const value = controlled !== undefined ? controlled : initial;
		if (value !== undefined) {
			const parsed = tileflowInteractionStateSchema.safeParse(snapshotNativeInteractionJson(value));
			if (!parsed.success) throw new Error();
			if ((!previous || ownership === 'controlled') && !nativeInteractionValuesEqual(state, parsed.data)) state = freezeNativeInteractionValue(parsed.data);
		}
	} catch { report('INVALID_DOCUMENT'); }
	return Object.freeze({annotations, bindings, state, ownership, diagnostics: Object.freeze(diagnostics)});
}

export type NativeAnnotationPlan = Readonly<{
	create: readonly TileflowAnnotation[];
	update: readonly Readonly<{id: string; previous: TileflowAnnotation; annotation: TileflowAnnotation}>[];
	retain: readonly string[];
	remove: readonly string[];
	order: readonly string[];
}>;

/** Plans only validated documents. A stable marker ID retains its future native host. */
export function planNativeAnnotations(
	previous: readonly TileflowAnnotation[],
	next: readonly TileflowAnnotation[],
): NativeAnnotationPlan {
	const before = new Map(previous.map((annotation) => [annotation.id, annotation]));
	const after = new Set(next.map((annotation) => annotation.id));
	const create: TileflowAnnotation[] = [];
	const update: Array<{id: string; previous: TileflowAnnotation; annotation: TileflowAnnotation}> = [];
	const retain: string[] = [];
	for (const annotation of next) {
		const old = before.get(annotation.id);
		if (!old) create.push(annotation);
		else if (nativeInteractionValuesEqual(old, annotation)) retain.push(annotation.id);
		else update.push(Object.freeze({id: annotation.id, previous: old, annotation}));
	}
	return Object.freeze({
		create: Object.freeze(create), update: Object.freeze(update), retain: Object.freeze(retain),
		remove: Object.freeze(previous.filter((annotation) => !after.has(annotation.id)).map((annotation) => annotation.id)),
		order: Object.freeze(next.map((annotation) => annotation.id)),
	});
}
