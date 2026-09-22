import type {
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowResolvedAnnotationTarget,
  TileflowResolvedPoiFeatureTarget,
} from '@tileflow/interactions';
import {
  freezeNativeInteractionValue,
  type NativeAnnotationPlan,
  nativeInteractionDiagnostic,
  type NativeInteractionInput,
  nativeInteractionValuesEqual,
  type NativePreparedInteractions,
  planNativeAnnotations,
  prepareNativeInteractionInputs,
} from './native-interaction-input';
import {createNativePoiAdapter, type NativePoiStyleLease} from './native-interaction-poi';

export type NativeInteractionSnapshot = NativePreparedInteractions &
  Readonly<{
    revision: number;
    plan: NativeAnnotationPlan;
    disposed: boolean;
  }>;
type NativeActivationTarget = TileflowResolvedAnnotationTarget | TileflowResolvedPoiFeatureTarget;
type NativeActivationEvent = Omit<TileflowInteractionEvent, 'target' | 'type'> & {
  target: NativeActivationTarget;
  type: 'target:activate';
};

export type NativeInteractionCallbacks = Readonly<{
  onInteractionEvent?(event: NativeActivationEvent): unknown;
  onDiagnostic?(diagnostic: TileflowInteractionDiagnostic): unknown;
}>;

const ignoreFailure = (work: () => unknown) => {
  try {
    void Promise.resolve(work()).catch(() => undefined);
  } catch {
    /* Observers do not own the interaction lifetime. */
  }
};

/** One map owns activation and query lifetime; the application owns selection. */
export function createNativeInteractionOwner(
  initial: NativeInteractionInput = {},
  initialCallbacks: NativeInteractionCallbacks = {},
) {
  let disposed = false;
  let transaction = 0;
  let queryGeneration = 0;
  let revision = 0;
  let callbacks = initialCallbacks;
  let prepared: NativePreparedInteractions | undefined;
  let styleLease: NativePoiStyleLease | undefined;
  let styleDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  let runtimeDiagnostics: readonly TileflowInteractionDiagnostic[] = [];
  const subscribers = new Set<() => void>();
  const semantic = createNativePoiAdapter();
  const empty = prepareNativeInteractionInputs({});
  let snapshot: NativeInteractionSnapshot = Object.freeze({
    ...empty,
    revision,
    plan: planNativeAnnotations([], []),
    disposed,
  });
  const live = (version: number) => !disposed && transaction === version;
  const activate = (target: NativeActivationTarget) => {
    const value: NativeActivationEvent = freezeNativeInteractionValue({
      type: 'target:activate',
      target,
      coordinate: target.coordinate,
      inputModality: 'touch',
      ...(target.bindingId === undefined ? {} : {bindingId: target.bindingId}),
    });
    ignoreFailure(() => callbacks.onInteractionEvent?.(value));
  };
  const commit = (
    data: NativePreparedInteractions,
    plan: NativeAnnotationPlan,
    version: number,
  ) => {
    if (!live(version)) return;
    const previous = snapshot;
    const diagnostics: TileflowInteractionDiagnostic[] = [];
    const semanticBindings = data.bindings.some(
      (binding) => binding.target.kind === 'semantic-feature' && binding.target.domain === 'poi',
    );
    const unsupported = data.bindings.some(
      (binding) =>
        binding.target.kind !== 'annotation' &&
        (binding.target.kind !== 'semantic-feature' || binding.target.domain !== 'poi'),
    );
    for (const diagnostic of [
      ...data.diagnostics,
      ...(semanticBindings ? styleDiagnostics : []),
      ...runtimeDiagnostics,
      ...(unsupported ? [nativeInteractionDiagnostic('UNSUPPORTED_TARGET')] : []),
    ])
      if (!diagnostics.some((value) => value.code === diagnostic.code))
        diagnostics.push(diagnostic);
    prepared = data;
    if (
      previous.annotations === data.annotations &&
      previous.bindings === data.bindings &&
      nativeInteractionValuesEqual(previous.diagnostics, diagnostics)
    )
      return;
    snapshot = Object.freeze({
      ...data,
      diagnostics: Object.freeze(diagnostics),
      revision: ++revision,
      plan,
      disposed: false,
    });
    for (const listener of [...subscribers]) {
      if (!live(version)) return;
      if (subscribers.has(listener)) ignoreFailure(listener);
    }
    for (const diagnostic of diagnostics) {
      if (!live(version)) return;
      if (!previous.diagnostics.some((value) => value.code === diagnostic.code))
        ignoreFailure(() => callbacks.onDiagnostic?.(diagnostic));
    }
  };
  const report = (code: TileflowInteractionDiagnostic['code']) => {
    if (disposed || !prepared) return;
    const version = ++transaction;
    runtimeDiagnostics = [nativeInteractionDiagnostic(code)];
    commit(prepared, planNativeAnnotations(prepared.annotations, prepared.annotations), version);
  };
  const update = (input: NativeInteractionInput) => {
    if (disposed) return;
    const inspected = transaction;
    const next = prepareNativeInteractionInputs(input, prepared);
    if (!live(inspected)) return;
    const changed =
      !prepared || next.annotations !== prepared.annotations || next.bindings !== prepared.bindings;
    const same =
      !changed &&
      !runtimeDiagnostics.length &&
      nativeInteractionValuesEqual(next.diagnostics, prepared?.diagnostics);
    if (same) return;
    const version = ++transaction;
    if (changed) {
      ++queryGeneration;
      semantic.cancelQueries();
      if (!live(version)) return;
    }
    runtimeDiagnostics = [];
    commit(next, planNativeAnnotations(prepared?.annotations ?? [], next.annotations), version);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ++transaction;
    ++queryGeneration;
    styleLease = undefined;
    semantic.dispose();
    subscribers.clear();
    callbacks = {};
    snapshot = Object.freeze({
      ...empty,
      revision: ++revision,
      plan: planNativeAnnotations(snapshot.annotations, []),
      disposed: true,
    });
    prepared = undefined;
    styleDiagnostics = [];
    runtimeDiagnostics = [];
  };
  update(initial);
  return Object.freeze({
    getSnapshot: (): NativeInteractionSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      if (disposed) return () => undefined;
      if (subscribers.size >= 64) {
        report('LIMIT_EXCEEDED');
        return () => undefined;
      }
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    setCallbacks(next: NativeInteractionCallbacks): void {
      if (!disposed) callbacks = next;
    },
    update,
    replaceStyle(next?: NativePoiStyleLease): void {
      if (disposed || !prepared) return;
      const version = ++transaction;
      ++queryGeneration;
      styleLease = next;
      styleDiagnostics = semantic.replaceStyle(next);
      if (!live(version)) return;
      runtimeDiagnostics = [];
      commit(prepared, planNativeAnnotations(prepared.annotations, prepared.annotations), version);
    },
    /** Rotate touch authority only while both leases prove the same still-owned style. */
    renewTouchLease(next: NativePoiStyleLease): boolean {
      if (disposed || !prepared) return false;
      const inspected = transaction;
      const previous = styleLease;
      try {
        if (
          !previous ||
          previous.style !== next.style ||
          !previous.isCurrent() ||
          !next.isCurrent()
        )
          return false;
      } catch {
        return false;
      }
      if (!live(inspected) || styleLease !== previous) return false;
      const version = ++transaction;
      ++queryGeneration;
      styleLease = next;
      styleDiagnostics = semantic.replaceStyle(next);
      if (!live(version)) return false;
      commit(prepared, planNativeAnnotations(prepared.annotations, prepared.annotations), version);
      return live(version) && styleLease === next;
    },
    activateAnnotation(id: string, inputModality: string): void {
      if (disposed || !prepared) return;
      if (inputModality !== 'touch') {
        report('UNSUPPORTED_MODE');
        return;
      }
      const version = ++transaction;
      ++queryGeneration;
      semantic.cancelQueries();
      if (!live(version)) return;
      const annotation = prepared.annotations.find((value) => value.id === id);
      if (!annotation) {
        report('STALE_TARGET');
        return;
      }
      const binding = prepared.bindings.find(
        (value) => value.target.kind === 'annotation' && value.target.id === id,
      );
      const target: TileflowResolvedAnnotationTarget = freezeNativeInteractionValue({
        kind: 'annotation',
        annotation,
        coordinate: annotation.coordinate,
        ...(binding ? {bindingId: binding.id} : {}),
      });
      activate(target);
    },
    async activateTouch(input: unknown): Promise<void> {
      if (disposed || !prepared) return;
      const version = ++transaction;
      const query = ++queryGeneration;
      const result = await semantic.queryTouch(
        input,
        prepared.bindings.filter((binding) => binding.target.kind === 'semantic-feature'),
      );
      if (!live(version) || query !== queryGeneration || result.status === 'stale') return;
      if (result.status === 'error') {
        if (result.diagnostics[0]) report(result.diagnostics[0].code);
        return;
      }
      if (result.status === 'match') activate(result.match.target);
    },
    /** Retires only touch intent; application selection remains untouched. */
    cancelTouch(): void {
      if (disposed) return;
      ++transaction;
      ++queryGeneration;
      semantic.cancelQueries();
    },
    retireSource: dispose,
    dispose,
  });
}
