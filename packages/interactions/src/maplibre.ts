/**
 * Framework-neutral lifecycle primitives for the MapLibre interaction adapter.
 *
 * This module deliberately imports neither MapLibre nor a DOM implementation. A framework
 * adapter owns the concrete marker/view instances and supplies every lifecycle operation.
 */

export type TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance> = Readonly<{
  definition: TDefinition;
  instance: TInstance;
  key: TKey;
}>;

export type TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance> = Readonly<{
  context: TContext;
  create: (context: TContext, definition: TDefinition, key: TKey) => TInstance;
  getKey: (definition: TDefinition) => TKey;
  remove: (instance: TInstance, context: TContext, definition: TDefinition, key: TKey) => void;
  reorder?: (
    context: TContext,
    entries: readonly TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance>[],
    previousEntries: readonly TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance>[],
  ) => void;
  shouldUpdate?: (previous: TDefinition, next: TDefinition, key: TKey) => boolean;
  update: (
    instance: TInstance,
    context: TContext,
    next: TDefinition,
    previous: TDefinition,
    key: TKey,
  ) => (() => void) | void;
}>;

export type TileflowAnnotationRegistry<TKey, TDefinition, TInstance> = Readonly<{
  readonly size: number;
  clear: () => void;
  dispose: () => void;
  entries: () => readonly TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance>[];
  get: (key: TKey) => TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance> | undefined;
  reconcile: (definitions: readonly TDefinition[]) => void;
}>;

type MutableRegistryEntry<TKey, TDefinition, TInstance> = {
  definition: TDefinition;
  instance: TInstance;
  key: TKey;
};

type CompletedUpdate<TKey, TDefinition, TInstance> = {
  entry: MutableRegistryEntry<TKey, TDefinition, TInstance>;
  next: TDefinition;
  rollback?: () => void;
};

/**
 * Creates a keyed registry that preserves compatible annotation instances across reconciliations.
 *
 * `create` must clean up any resource it allocates before throwing. `remove` must be safe to retry:
 * failed cleanup remains pending and is attempted again by a later reconciliation or disposal.
 * An `update` callback may return an exact rollback closure. When it returns nothing, the registry
 * invokes `update` with its previous and next values reversed if a later operation fails. A failed
 * `reorder` is reversed by invoking it again with the two entry lists swapped.
 */
export function createTileflowAnnotationRegistry<TContext, TKey, TDefinition, TInstance>(
  adapter: TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance>,
): TileflowAnnotationRegistry<TKey, TDefinition, TInstance> {
  let currentEntries: Array<MutableRegistryEntry<TKey, TDefinition, TInstance>> = [];
  let currentEntriesByKey = new Map<TKey, MutableRegistryEntry<TKey, TDefinition, TInstance>>();
  const retiredEntries = new Set<MutableRegistryEntry<TKey, TDefinition, TInstance>>();
  let disposed = false;
  let mutating = false;

  const publicEntries = () => snapshotEntries(currentEntries);

  const reconcile = (definitions: readonly TDefinition[]) => {
    assertRegistryCanMutate(disposed, mutating);
    mutating = true;

    try {
      const requested = collectRequestedDefinitions(definitions, adapter.getKey);
      const previousEntries = currentEntries;
      const nextEntries: Array<MutableRegistryEntry<TKey, TDefinition, TInstance>> = [];
      const nextEntriesByKey = new Map<TKey, MutableRegistryEntry<TKey, TDefinition, TInstance>>();
      const createdEntries: Array<MutableRegistryEntry<TKey, TDefinition, TInstance>> = [];
      const completedUpdates: Array<CompletedUpdate<TKey, TDefinition, TInstance>> = [];
      let failureAlreadyRolledBack = false;

      try {
        for (const {definition, key} of requested) {
          const previous = currentEntriesByKey.get(key);

          if (previous) {
            const next = {definition, instance: previous.instance, key};
            nextEntries.push(next);
            nextEntriesByKey.set(key, next);
            continue;
          }

          const instance = adapter.create(adapter.context, definition, key);
          const next = {definition, instance, key};
          createdEntries.push(next);
          nextEntries.push(next);
          nextEntriesByKey.set(key, next);
        }

        for (const entry of nextEntries) {
          const previous = currentEntriesByKey.get(entry.key);
          if (
            !previous ||
            !shouldUpdateDefinition(adapter, previous.definition, entry.definition, entry.key)
          ) {
            continue;
          }

          const completed: CompletedUpdate<TKey, TDefinition, TInstance> = {
            entry: previous,
            next: entry.definition,
          };
          completedUpdates.push(completed);
          completed.rollback =
            adapter.update(
              previous.instance,
              adapter.context,
              entry.definition,
              previous.definition,
              entry.key,
            ) ?? undefined;
        }

        if (adapter.reorder && !haveSameKeyOrder(previousEntries, nextEntries)) {
          const nextSnapshot = snapshotEntries(nextEntries);
          const previousSnapshot = snapshotEntries(previousEntries);

          try {
            adapter.reorder(adapter.context, nextSnapshot, previousSnapshot);
          } catch (error) {
            const rollbackErrors = safelyRun(() =>
              adapter.reorder?.(adapter.context, previousSnapshot, nextSnapshot),
            );
            rollbackErrors.push(...rollbackCompletedUpdates(adapter, completedUpdates));
            rollbackErrors.push(...retireAndClean(adapter, retiredEntries, createdEntries));
            failureAlreadyRolledBack = true;
            throwRollbackFailure(error, rollbackErrors);
          }
        }
      } catch (error) {
        if (failureAlreadyRolledBack) throw error;

        const rollbackErrors = rollbackCompletedUpdates(adapter, completedUpdates);
        rollbackErrors.push(...retireAndClean(adapter, retiredEntries, createdEntries));
        throwRollbackFailure(error, rollbackErrors);
      }

      currentEntries = nextEntries;
      currentEntriesByKey = nextEntriesByKey;

      for (const entry of previousEntries) {
        if (!nextEntriesByKey.has(entry.key)) retiredEntries.add(entry);
      }

      throwCleanupFailures(cleanRetiredEntries(adapter, retiredEntries));
    } finally {
      mutating = false;
    }
  };

  const dispose = () => {
    if (mutating) {
      throw new Error('Tileflow annotation registry mutation is already in progress.');
    }
    if (disposed && retiredEntries.size === 0) return;

    mutating = true;
    try {
      if (!disposed) {
        disposed = true;
        for (const entry of currentEntries) retiredEntries.add(entry);
        currentEntries = [];
        currentEntriesByKey = new Map();
      }
      throwCleanupFailures(cleanRetiredEntries(adapter, retiredEntries));
    } finally {
      mutating = false;
    }
  };

  return {
    get size() {
      return currentEntries.length;
    },
    clear() {
      if (disposed) return;
      reconcile([]);
    },
    dispose,
    entries: publicEntries,
    get(key) {
      const entry = currentEntriesByKey.get(key);
      return entry ? freezeEntry(entry) : undefined;
    },
    reconcile,
  };
}

function collectRequestedDefinitions<TKey, TDefinition>(
  definitions: readonly TDefinition[],
  getKey: (definition: TDefinition) => TKey,
): Array<{definition: TDefinition; key: TKey}> {
  const keys = new Set<TKey>();
  const requested: Array<{definition: TDefinition; key: TKey}> = [];

  for (const definition of definitions) {
    const key = getKey(definition);
    if (keys.has(key)) {
      throw new TypeError('Duplicate Tileflow annotation key.');
    }
    keys.add(key);
    requested.push({definition, key});
  }

  return requested;
}

function shouldUpdateDefinition<TContext, TKey, TDefinition, TInstance>(
  adapter: TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance>,
  previous: TDefinition,
  next: TDefinition,
  key: TKey,
): boolean {
  return adapter.shouldUpdate?.(previous, next, key) ?? !Object.is(previous, next);
}

function rollbackCompletedUpdates<TContext, TKey, TDefinition, TInstance>(
  adapter: TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance>,
  updates: readonly CompletedUpdate<TKey, TDefinition, TInstance>[],
): unknown[] {
  const errors: unknown[] = [];

  for (const update of [...updates].reverse()) {
    errors.push(
      ...safelyRun(() => {
        if (update.rollback) {
          update.rollback();
          return;
        }
        adapter.update(
          update.entry.instance,
          adapter.context,
          update.entry.definition,
          update.next,
          update.entry.key,
        );
      }),
    );
  }

  return errors;
}

function retireAndClean<TContext, TKey, TDefinition, TInstance>(
  adapter: TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance>,
  retiredEntries: Set<MutableRegistryEntry<TKey, TDefinition, TInstance>>,
  entries: readonly MutableRegistryEntry<TKey, TDefinition, TInstance>[],
): unknown[] {
  for (const entry of entries) retiredEntries.add(entry);
  return cleanRetiredEntries(adapter, retiredEntries);
}

function cleanRetiredEntries<TContext, TKey, TDefinition, TInstance>(
  adapter: TileflowAnnotationRegistryAdapter<TContext, TKey, TDefinition, TInstance>,
  retiredEntries: Set<MutableRegistryEntry<TKey, TDefinition, TInstance>>,
): unknown[] {
  const errors: unknown[] = [];

  for (const entry of retiredEntries) {
    try {
      adapter.remove(entry.instance, adapter.context, entry.definition, entry.key);
      retiredEntries.delete(entry);
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}

function haveSameKeyOrder<TKey, TDefinition, TInstance>(
  previous: readonly MutableRegistryEntry<TKey, TDefinition, TInstance>[],
  next: readonly MutableRegistryEntry<TKey, TDefinition, TInstance>[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((entry, index) => sameValueZero(entry.key, next[index]?.key))
  );
}

function sameValueZero(left: unknown, right: unknown): boolean {
  return left === right || (left !== left && right !== right);
}

function snapshotEntries<TKey, TDefinition, TInstance>(
  entries: readonly MutableRegistryEntry<TKey, TDefinition, TInstance>[],
): readonly TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance>[] {
  return Object.freeze(entries.map(freezeEntry));
}

function freezeEntry<TKey, TDefinition, TInstance>(
  entry: MutableRegistryEntry<TKey, TDefinition, TInstance>,
): TileflowAnnotationRegistryEntry<TKey, TDefinition, TInstance> {
  return Object.freeze({
    definition: entry.definition,
    instance: entry.instance,
    key: entry.key,
  });
}

function assertRegistryCanMutate(disposed: boolean, mutating: boolean): void {
  if (disposed) throw new Error('Tileflow annotation registry is disposed.');
  if (mutating) throw new Error('Tileflow annotation registry mutation is already in progress.');
}

function throwRollbackFailure(error: unknown, rollbackErrors: readonly unknown[]): never {
  if (rollbackErrors.length === 0) throw error;
  throw new AggregateError(
    [error, ...rollbackErrors],
    'Tileflow annotation reconciliation failed and rollback reported additional errors.',
    {cause: error},
  );
}

function throwCleanupFailures(errors: readonly unknown[]): void {
  if (errors.length === 0) return;
  throw new AggregateError(errors, 'Unable to remove one or more Tileflow annotation instances.');
}

function safelyRun(operation: () => unknown): unknown[] {
  try {
    operation();
    return [];
  } catch (error) {
    return [error];
  }
}

export type TileflowOverlayState<TTarget> = Readonly<{
  popup: TTarget | null;
  tooltip: TTarget | null;
}>;

export type TileflowOverlayStateChangeReason =
  | 'dispose'
  | 'popup:close'
  | 'popup:open'
  | 'target:remove'
  | 'targets:reconcile'
  | 'tooltip:close'
  | 'tooltip:open';

export type TileflowOverlayStateListener<TTarget> = (
  state: TileflowOverlayState<TTarget>,
  previous: TileflowOverlayState<TTarget>,
  reason: TileflowOverlayStateChangeReason,
) => void;

export type TileflowOverlayStateController<TTarget> = Readonly<{
  clearTarget: (target: TTarget) => boolean;
  dispose: () => void;
  getState: () => TileflowOverlayState<TTarget>;
  reconcileTargets: (isAvailable: (target: TTarget) => boolean) => boolean;
  setPopup: (target: TTarget | null) => boolean;
  setTooltip: (target: TTarget | null) => boolean;
  subscribe: (listener: TileflowOverlayStateListener<TTarget>) => () => void;
}>;

/**
 * Owns transient tooltip state and one active popup without knowing the target representation.
 * Full serializable target references can be used by supplying semantic equality.
 */
export function createTileflowOverlayStateController<TTarget>(
  options: {
    areTargetsEqual?: (left: TTarget, right: TTarget) => boolean;
    initialPopup?: TTarget | null;
    initialTooltip?: TTarget | null;
    onChange?: TileflowOverlayStateListener<TTarget>;
  } = {},
): TileflowOverlayStateController<TTarget> {
  const areTargetsEqual = options.areTargetsEqual ?? Object.is;
  const listeners = new Set<TileflowOverlayStateListener<TTarget>>();
  if (options.onChange) listeners.add(options.onChange);
  const initialPopup: TTarget | null =
    options.initialPopup === undefined ? null : options.initialPopup;
  let initialTooltip: TTarget | null =
    options.initialTooltip === undefined ? null : options.initialTooltip;
  if (
    initialPopup !== null &&
    initialTooltip !== null &&
    areTargetsEqual(initialPopup, initialTooltip)
  ) {
    initialTooltip = null;
  }
  let state: TileflowOverlayState<TTarget> = overlayState(initialPopup, initialTooltip);
  let disposed = false;

  const commit = (
    popup: TTarget | null,
    tooltip: TTarget | null,
    reason: TileflowOverlayStateChangeReason,
  ) => {
    if (
      disposed ||
      (sameTarget(state.popup, popup, areTargetsEqual) &&
        sameTarget(state.tooltip, tooltip, areTargetsEqual))
    ) {
      return false;
    }

    const previous = state;
    state = overlayState(popup, tooltip);
    notifyOverlayListeners(listeners, state, previous, reason);
    return true;
  };

  return {
    clearTarget(target) {
      const popup = targetMatches(state.popup, target, areTargetsEqual) ? null : state.popup;
      const tooltip = targetMatches(state.tooltip, target, areTargetsEqual) ? null : state.tooltip;
      return commit(popup, tooltip, 'target:remove');
    },
    dispose() {
      if (disposed) return;
      const previous = state;
      disposed = true;
      state = overlayState<TTarget>(null, null);
      try {
        if (previous.popup !== null || previous.tooltip !== null) {
          notifyOverlayListeners(listeners, state, previous, 'dispose');
        }
      } finally {
        listeners.clear();
      }
    },
    getState() {
      return state;
    },
    reconcileTargets(isAvailable) {
      if (disposed) return false;
      const popup = state.popup !== null && !isAvailable(state.popup) ? null : state.popup;
      const tooltip = state.tooltip !== null && !isAvailable(state.tooltip) ? null : state.tooltip;
      return commit(popup, tooltip, 'targets:reconcile');
    },
    setPopup(target) {
      const tooltip =
        target !== null && targetMatches(state.tooltip, target, areTargetsEqual)
          ? null
          : state.tooltip;
      return commit(target, tooltip, target === null ? 'popup:close' : 'popup:open');
    },
    setTooltip(target) {
      if (target !== null && targetMatches(state.popup, target, areTargetsEqual)) return false;
      return commit(state.popup, target, target === null ? 'tooltip:close' : 'tooltip:open');
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
  };
}

function overlayState<TTarget>(
  popup: TTarget | null,
  tooltip: TTarget | null,
): TileflowOverlayState<TTarget> {
  return Object.freeze({popup, tooltip});
}

function targetMatches<TTarget>(
  current: TTarget | null,
  target: TTarget,
  areTargetsEqual: (left: TTarget, right: TTarget) => boolean,
): boolean {
  return current !== null && areTargetsEqual(current, target);
}

function sameTarget<TTarget>(
  left: TTarget | null,
  right: TTarget | null,
  areTargetsEqual: (left: TTarget, right: TTarget) => boolean,
): boolean {
  if (left === null || right === null) return left === right;
  return areTargetsEqual(left, right);
}

function notifyOverlayListeners<TTarget>(
  listeners: ReadonlySet<TileflowOverlayStateListener<TTarget>>,
  state: TileflowOverlayState<TTarget>,
  previous: TileflowOverlayState<TTarget>,
  reason: TileflowOverlayStateChangeReason,
): void {
  const errors: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener(state, previous, reason);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Tileflow overlay state listeners failed.');
  }
}
