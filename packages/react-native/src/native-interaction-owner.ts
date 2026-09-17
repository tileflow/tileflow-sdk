import {
	reduceTileflowInteractionState,
	tileflowInteractionTargetRefsEqual,
	type TileflowInteractionContent,
	type TileflowInteractionDiagnostic,
	type TileflowInteractionEvent,
	type TileflowInteractionState,
	type TileflowInteractionTargetRef,
	type TileflowResolvedAnnotationTarget,
	type TileflowResolvedPoiFeatureTarget,
} from '@tileflow/interactions';
import {
	freezeNativeInteractionValue,
	nativeInteractionDiagnostic,
	planNativeAnnotations,
	prepareNativeInteractionInputs,
	type NativeAnnotationPlan,
	type NativeInteractionInput,
	type NativePreparedInteractions,
} from './native-interaction-input';
import {createNativePoiAdapter, nativePoiBindingMatches, type NativePoiStyleLease} from './native-interaction-poi';

export type NativeInteractionPopup = Readonly<{
	target: TileflowResolvedAnnotationTarget | TileflowResolvedPoiFeatureTarget;
	content: TileflowInteractionContent;
}>;
export type NativeInteractionSnapshot = NativePreparedInteractions & Readonly<{
	revision: number;
	plan: NativeAnnotationPlan;
	popup: NativeInteractionPopup | null;
	disposed: boolean;
}>;
export type NativeInteractionCallbacks = Readonly<{
	onInteractionEvent?(event: TileflowInteractionEvent): unknown;
	onInteractionStateChange?(state: TileflowInteractionState): unknown;
	onDiagnostic?(diagnostic: TileflowInteractionDiagnostic): unknown;
}>;

function reference(target: NativeInteractionPopup['target']): TileflowInteractionTargetRef | null {
	if (target.kind === 'annotation') return {kind: 'annotation', id: target.annotation.id};
	return target.feature.id === undefined ? null : {kind: 'semantic-feature', domain: 'poi', featureId: target.feature.id};
}
function samePopup(left: NativeInteractionPopup | null, right: NativeInteractionPopup | null): boolean {
	return left === right || (!!left && !!right && left.target.bindingId === right.target.bindingId &&
		tileflowInteractionTargetRefsEqual(reference(left.target), reference(right.target)));
}
const ignoreFailure = (work: () => unknown) => {
	try { void Promise.resolve(work()).catch(() => undefined); } catch { /* Observers do not own the interaction lifetime. */ }
};

/** One map owns this controller. It creates no views, native hosts, services or React state. */
export function createNativeInteractionOwner(initial: NativeInteractionInput = {}, initialCallbacks: NativeInteractionCallbacks = {}) {
	let disposed = false;
	let transaction = 0;
	let queryGeneration = 0;
	let revision = 0;
	let callbacks = initialCallbacks;
	let prepared: NativePreparedInteractions | undefined;
	let selected: NativeInteractionPopup | null = null;
	let blocked: TileflowInteractionTargetRef | null = null;
	let staleRequest: TileflowInteractionTargetRef | null = null;
	let styleDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
	let runtimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
	const subscribers = new Set<() => void>();
	const semantic = createNativePoiAdapter();
	const empty = prepareNativeInteractionInputs({});
	let snapshot: NativeInteractionSnapshot = Object.freeze({
		...empty, revision, plan: planNativeAnnotations([], []), popup: null, disposed,
	});
	const live = (version: number) => !disposed && transaction === version;
	const event = (type: TileflowInteractionEvent['type'], target: NativeInteractionPopup['target'], inputModality: 'touch' | 'programmatic') => {
		const value: TileflowInteractionEvent = freezeNativeInteractionValue({
			type, target, coordinate: target.coordinate, inputModality,
			...(target.bindingId === undefined ? {} : {bindingId: target.bindingId}),
		});
		ignoreFailure(() => callbacks.onInteractionEvent?.(value));
	};
	const resolvePopup = (state: TileflowInteractionState, data: NativePreparedInteractions, preference: NativeInteractionPopup | null): NativeInteractionPopup | null => {
		const target = state.popup;
		if (!target) return null;
		const matching = preference && tileflowInteractionTargetRefsEqual(reference(preference.target), target) ? preference : null;
		if (target.kind === 'annotation') {
			const annotation = data.annotations.find((value) => value.id === target.id);
			if (!annotation) return null;
			const binding = matching
				? data.bindings.find((value) => value.id === matching.target.bindingId)
				: data.bindings.find((value) => value.target.kind === 'annotation' && value.target.id === target.id && value.popup);
			if (matching?.target.bindingId !== undefined && (!binding || !binding.popup || binding.target.kind !== 'annotation' || binding.target.id !== target.id)) return null;
			const content = binding?.popup?.content ?? annotation.popup?.content;
			if (!content) return null;
			return freezeNativeInteractionValue({content, target: {
				kind: 'annotation', annotation, coordinate: annotation.coordinate,
				...(binding?.popup ? {bindingId: binding.id} : {}),
			}});
		}
		if (target.kind !== 'semantic-feature' || target.domain !== 'poi' || matching?.target.kind !== 'semantic-feature') return null;
		const binding = data.bindings.find((value) => value.id === matching.target.bindingId);
		if (!binding?.popup || !nativePoiBindingMatches(binding, matching.target) || !semantic.supports(matching.target)) return null;
		return freezeNativeInteractionValue({content: binding.popup.content, target: {...matching.target, bindingId: binding.id}});
	};
	const commit = (data: NativePreparedInteractions, plan: NativeAnnotationPlan, preference: NativeInteractionPopup | null, version: number, modality: 'touch' | 'programmatic') => {
		const previous = snapshot;
		const ref = data.state.popup;
		const sameBlocked = ref !== null && blocked !== null && tileflowInteractionTargetRefsEqual(blocked, ref);
		const popup = sameBlocked ? null : resolvePopup(data.state, data, preference);
		if (!live(version)) return;
		const invalidTarget = ref !== null && !popup;
		const requestClose = invalidTarget && !tileflowInteractionTargetRefsEqual(staleRequest, ref);
		const state = invalidTarget && data.ownership === 'uncontrolled'
			? freezeNativeInteractionValue(reduceTileflowInteractionState(data.state, {type: 'close-popup'})) : data.state;
		blocked = invalidTarget && data.ownership === 'controlled' ? ref : null;
		staleRequest = invalidTarget ? ref : null;
		const diagnostics: TileflowInteractionDiagnostic[] = [];
		const semanticBindings = data.bindings.some((binding) => binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi');
		const unsupported = data.bindings.some((binding) => binding.target.kind !== 'annotation' &&
			(binding.target.kind !== 'semantic-feature' || binding.target.domain !== 'poi'));
		for (const diagnostic of [
			...data.diagnostics, ...(semanticBindings ? styleDiagnostics : []), ...runtimeDiagnostics,
			...(unsupported ? [nativeInteractionDiagnostic('UNSUPPORTED_TARGET')] : []),
			...(invalidTarget ? [nativeInteractionDiagnostic('STALE_TARGET')] : []),
		]) if (!diagnostics.some((value) => value.code === diagnostic.code)) diagnostics.push(diagnostic);
		prepared = Object.freeze({...data, state});
		selected = popup ?? preference;
		snapshot = Object.freeze({...prepared, diagnostics: Object.freeze(diagnostics), revision: ++revision, plan, popup, disposed: false});
		for (const listener of [...subscribers]) {
			if (!live(version)) return;
			if (subscribers.has(listener)) ignoreFailure(listener);
		}
		if (!live(version)) return;
		if (!samePopup(previous.popup, popup)) {
			if (previous.popup) event('popup:close', previous.popup.target, modality);
			if (!live(version)) return;
			if (popup) event('popup:open', popup.target, modality);
		}
		for (const diagnostic of diagnostics) {
			if (!live(version)) return;
			if (!previous.diagnostics.some((value) => value.code === diagnostic.code)) ignoreFailure(() => callbacks.onDiagnostic?.(diagnostic));
		}
		if (live(version) && requestClose) {
			const next = freezeNativeInteractionValue(reduceTileflowInteractionState(data.state, {type: 'close-popup'}));
			ignoreFailure(() => callbacks.onInteractionStateChange?.(next));
		}
	};
	const report = (code: TileflowInteractionDiagnostic['code']) => {
		if (disposed || !prepared) return;
		const version = ++transaction;
		runtimeDiagnostics = [nativeInteractionDiagnostic(code)];
		commit(prepared, planNativeAnnotations(prepared.annotations, prepared.annotations), selected, version, 'programmatic');
	};
	const update = (input: NativeInteractionInput) => {
		if (disposed) return;
		const version = ++transaction;
		const next = prepareNativeInteractionInputs(input, prepared);
		if (!live(version)) return;
		const changed = !prepared || next.annotations !== prepared.annotations || next.bindings !== prepared.bindings || next.state !== prepared.state;
		if (changed) {
			++queryGeneration;
			semantic.cancelQueries();
			if (!live(version)) return;
		}
		runtimeDiagnostics = [];
		commit(next, planNativeAnnotations(prepared?.annotations ?? [], next.annotations), selected, version, 'programmatic');
	};
	const open = (popup: NativeInteractionPopup, version: number) => {
		if (!live(version) || !prepared) return;
		const target = reference(popup.target);
		if (!target) { report('UNSTABLE_FEATURE_IDENTITY'); return; }
		selected = popup;
		const next = freezeNativeInteractionValue(reduceTileflowInteractionState(prepared.state, {type: 'open-popup', target}));
		if (next === prepared.state) return;
		if (prepared.ownership === 'uncontrolled') {
			runtimeDiagnostics = [];
			commit(Object.freeze({...prepared, state: next}), planNativeAnnotations(prepared.annotations, prepared.annotations), popup, version, 'touch');
		}
		if (live(version)) ignoreFailure(() => callbacks.onInteractionStateChange?.(next));
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true; ++transaction; ++queryGeneration;
		semantic.dispose(); subscribers.clear(); callbacks = {};
		const plan = planNativeAnnotations(snapshot.annotations, []);
		snapshot = Object.freeze({...empty, ownership: snapshot.ownership, revision: ++revision, plan, popup: null, disposed: true});
		selected = null; blocked = null; staleRequest = null; prepared = undefined;
		styleDiagnostics = []; runtimeDiagnostics = [];
	};
	update(initial);
	return Object.freeze({
		getSnapshot: (): NativeInteractionSnapshot => snapshot,
		subscribe(listener: () => void): () => void {
			if (disposed) return () => undefined;
			if (subscribers.size >= 64) { report('LIMIT_EXCEEDED'); return () => undefined; }
			subscribers.add(listener);
			return () => { subscribers.delete(listener); };
		},
		setCallbacks(next: NativeInteractionCallbacks): void { if (!disposed) callbacks = next; },
		update,
		replaceStyle(next?: NativePoiStyleLease): void {
			if (disposed || !prepared) return;
			const version = ++transaction; ++queryGeneration;
			const diagnostics = semantic.replaceStyle(next);
			if (!live(version)) return;
			styleDiagnostics = diagnostics;
			runtimeDiagnostics = [];
			const preference = selected?.target.kind === 'semantic-feature' ? null : selected;
			commit(prepared, planNativeAnnotations(prepared.annotations, prepared.annotations), preference, version, 'programmatic');
		},
		activateAnnotation(id: string, inputModality: string): void {
			if (disposed || !prepared) return;
			if (inputModality !== 'touch') { report('UNSUPPORTED_MODE'); return; }
			const version = ++transaction; ++queryGeneration;
			semantic.cancelQueries();
			if (!live(version)) return;
			const annotation = prepared.annotations.find((value) => value.id === id);
			if (!annotation) { report('STALE_TARGET'); return; }
			const popup = resolvePopup({popup: {kind: 'annotation', id}}, prepared, null);
			const target: TileflowResolvedAnnotationTarget = popup?.target.kind === 'annotation' ? popup.target : freezeNativeInteractionValue({kind: 'annotation', annotation, coordinate: annotation.coordinate});
			event('target:activate', target, 'touch');
			if (popup && live(version)) open(popup, version);
		},
		async activateTouch(input: unknown): Promise<void> {
			if (disposed || !prepared) return;
			++transaction;
			const query = ++queryGeneration;
			const result = await semantic.queryTouch(input, prepared.bindings.filter((binding) => binding.target.kind === 'semantic-feature'));
			if (disposed || query !== queryGeneration || result.status === 'stale') return;
			if (result.status === 'error') {
				if (result.diagnostics[0]) report(result.diagnostics[0].code);
				return;
			}
			if (result.status !== 'match') return;
			const version = ++transaction;
			const {binding, target} = result.match;
			event('target:activate', target, 'touch');
			if (!live(version) || !binding.popup) return;
			if (target.feature.id === undefined) { report('UNSTABLE_FEATURE_IDENTITY'); return; }
			open(freezeNativeInteractionValue({target, content: binding.popup.content}), version);
		},
		close(): void {
			if (disposed || !prepared) return;
			const version = ++transaction; ++queryGeneration;
			semantic.cancelQueries();
			if (!live(version)) return;
			const next = freezeNativeInteractionValue(reduceTileflowInteractionState(prepared.state, {type: 'close-popup'}));
			if (next === prepared.state) return;
			if (prepared.ownership === 'uncontrolled') {
				runtimeDiagnostics = []; selected = null;
				commit(Object.freeze({...prepared, state: next}), planNativeAnnotations(prepared.annotations, prepared.annotations), null, version, 'programmatic');
			}
			if (live(version)) ignoreFailure(() => callbacks.onInteractionStateChange?.(next));
		},
		retireSource: dispose,
		dispose,
	});
}
