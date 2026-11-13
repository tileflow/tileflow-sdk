import {runTileflowCleanups} from './reconcile';

/**
 * What a mount acquired, released together. Releasing runs every cleanup, last added first, even
 * when one throws, and happens once. Anything added after the release is released at once, so an
 * operation that finishes after its mount was cancelled cannot leave a resource behind.
 */
export type TileflowResourceScope = Readonly<{
  add(cleanup: () => void): void;
  /** A scope released before this one, which this one releases too. */
  child(): TileflowResourceScope;
  dispose(): void;
  readonly disposed: boolean;
}>;

export function createTileflowResourceScope(): TileflowResourceScope {
  const cleanups: (() => void)[] = [];
  let disposed = false;

  const scope: TileflowResourceScope = {
    add(cleanup) {
      if (disposed) runTileflowCleanups([cleanup]);
      else cleanups.push(cleanup);
    },
    child() {
      const child = createTileflowResourceScope();
      scope.add(() => child.dispose());
      return child;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runTileflowCleanups(cleanups.splice(0).reverse());
    },
    get disposed() {
      return disposed;
    },
  };
  return scope;
}
