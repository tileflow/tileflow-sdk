/**
 * Option diffing for the map controller. Each pass recomputes derived values only when their inputs
 * changed and reruns side effects only when theirs did, the way a component framework re-renders:
 * an adapter can hand over all of its props on every render and the map does only the work the
 * change asks for.
 */

type MemoSlot = {deps: readonly unknown[]; value: unknown};
type EffectSlot = {cleanup?: (() => void) | undefined; deps: readonly unknown[]};
type PendingEffect = {key: string; run: () => void | (() => void)};

export type TileflowReconciler = Readonly<{
  /** Runs effect cleanups of a pass, then their bodies, in the order they were declared. */
  commit(): void;
  /** Runs every effect cleanup, last declared first, and forgets every value. */
  dispose(): void;
  /** Declares a side effect that runs on `commit` when its dependencies changed. */
  effect(key: string, deps: readonly unknown[], run: () => void | (() => void)): void;
  /** Returns the value computed for `deps`, computing it again only when they changed. */
  memo<T>(key: string, deps: readonly unknown[], compute: () => T): T;
  /** Returns the previous value while the new one is structurally equal to it. */
  stable<T>(key: string, value: T): T;
}>;

export function createTileflowReconciler(): TileflowReconciler {
  const memos = new Map<string, MemoSlot>();
  const effects = new Map<string, EffectSlot>();
  const stableValues = new Map<string, unknown>();
  let pending: PendingEffect[] = [];

  return {
    commit() {
      const batch = pending;
      pending = [];
      const errors: unknown[] = [];
      for (const {key} of batch) {
        const slot = effects.get(key);
        const cleanup = slot?.cleanup;
        if (slot) slot.cleanup = undefined;
        if (!cleanup) continue;
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      for (const {key, run} of batch) {
        const slot = effects.get(key);
        if (!slot) continue;
        try {
          const cleanup = run();
          slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        } catch (error) {
          errors.push(error);
        }
      }
      throwCollected(errors, 'Tileflow map update failed.');
    },
    dispose() {
      pending = [];
      const cleanups = [...effects.values()]
        .map((slot) => slot.cleanup)
        .filter((cleanup): cleanup is () => void => cleanup !== undefined)
        .reverse();
      effects.clear();
      memos.clear();
      stableValues.clear();
      runTileflowCleanups(cleanups);
    },
    effect(key, deps, run) {
      const slot = effects.get(key);
      if (slot && sameDependencies(slot.deps, deps)) return;
      if (slot) slot.deps = deps;
      else effects.set(key, {deps});
      pending = pending.filter((entry) => entry.key !== key);
      pending.push({key, run});
    },
    memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
      const slot = memos.get(key);
      if (slot && sameDependencies(slot.deps, deps)) return slot.value as T;
      const value = compute();
      memos.set(key, {deps, value});
      return value;
    },
    stable<T>(key: string, value: T): T {
      if (stableValues.has(key)) {
        const previous = stableValues.get(key) as T;
        if (areEquivalentTileflowOptionValues(previous, value)) return previous;
      }
      stableValues.set(key, value);
      return value;
    },
  };
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

/** Plain objects and arrays compare by contents; functions, class instances and the rest by identity. */
export function areEquivalentTileflowOptionValues(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  const seenRight = seen.get(left);
  if (seenRight) return seenRight === right;
  seen.set(left, right);

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areEquivalentTileflowOptionValues(value, right[index], seen))
    );
  }

  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && areEquivalentTileflowOptionValues(left[key], right[key], seen),
    )
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Runs every cleanup even when one throws, then rethrows what failed. */
export function runTileflowCleanups(cleanups: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollected(errors, 'Tileflow map cleanup failed.');
}

function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
